/**
 * src/realtime/ws.ts — WebSocket Server
 *
 * Attaches a WebSocket server to the existing http.Server so that HTTP and WS
 * traffic share a single TCP port. Clients connect with:
 *
 *   ws://host:port/ws?tenantId=<objectId>
 *
 * ── Rooms ─────────────────────────────────────────────────────────────────────
 *   Each tenant has a "room" — a `Set<WebSocket>` stored in a `Map` keyed by
 *   tenantId. Incoming incident lifecycle events are broadcast to every client
 *   in the corresponding room.
 *
 * ── Ping / pong heartbeat ─────────────────────────────────────────────────────
 *   TCP connections can silently drop (NAT timeout, proxy idle timeout, mobile
 *   network switch). The server sends a `ping` frame every 30 s. If a client
 *   has not replied with a `pong` before the next ping cycle it is considered
 *   dead and terminated. This prevents rooms from accumulating zombie sockets.
 *
 *   Each socket gets an `isAlive` flag. The heartbeat sets it to false then
 *   pings; if still false on the next cycle the socket is terminated.
 *
 * ── Pub/sub integration ───────────────────────────────────────────────────────
 *   The first client to join a tenant room creates a pubsub subscription on
 *   `incidents:{tenantId}`. The subscription is torn down when the last client
 *   in the room disconnects, preventing memory leaks.
 *
 * ── Graceful shutdown ─────────────────────────────────────────────────────────
 *   `WsController.close()` terminates all sockets, clears the heartbeat
 *   interval, removes all pubsub subscriptions, and closes the WS server.
 *
 * ── Security note ─────────────────────────────────────────────────────────────
 *   `tenantId` is taken from the URL query string without JWT verification.
 *   For production, add token verification in the `upgrade` event handler.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { subscribe, unsubscribe, type PubSubHandler } from './pubsub';
import logger from '../config/logger';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Handle returned by `attachWS`. Exposes the two operations `server.ts` needs:
 *  - `broadcast` — push a JSON payload to all clients in a tenant room.
 *  - `close`     — gracefully shut down the WS server.
 */
export interface WsController {
  broadcast: (tenantId: string, payload: unknown) => void;
  close: () => void;
}

/** WebSocket extended with our liveness flag. */
type LiveSocket = WebSocket & { isAlive: boolean };

const PING_INTERVAL_MS = 30_000;

/**
 * Maximum number of bytes allowed to sit in a socket's send buffer before we
 * start dropping outbound messages for that client. A client that isn't reading
 * fast enough (slow connection, suspended tab) would otherwise cause us to
 * queue an unbounded amount of data in memory.
 *
 * 64 KiB is a reasonable ceiling: large enough to absorb a burst of events
 * during a degraded connection, small enough to prevent memory exhaustion when
 * dozens of slow clients are connected simultaneously.
 */
const WS_BUFFER_LIMIT = 64 * 1024; // 64 KiB

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Attaches a WebSocket server to `httpServer` and returns a `WsController`.
 * Must be called after `server.listen()` so the underlying TCP socket exists.
 */
export function attachWS(httpServer: Server): WsController {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  // tenantId → connected sockets
  const rooms = new Map<string, Set<LiveSocket>>();
  // tenantId → pubsub handler registered for that room
  const roomHandlers = new Map<string, PubSubHandler>();

  // ── Helpers ──────────────────────────────────────────────────────────────

  function broadcastToRoom(tenantId: string, payload: unknown): void {
    const room = rooms.get(tenantId);
    if (!room) return;
    const message = JSON.stringify(payload);
    for (const socket of room) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      // Backpressure guard: if the client's send buffer is too full, drop the
      // message for this socket rather than queuing more data in memory.
      if (socket.bufferedAmount > WS_BUFFER_LIMIT) {
        logger.warn({ tenantId }, '[WS] Socket backpressure — dropping message for slow client');
        continue;
      }
      socket.send(message);
    }
  }

  function removeFromRoom(tenantId: string, socket: LiveSocket): void {
    const room = rooms.get(tenantId);
    if (!room) return;
    room.delete(socket);

    if (room.size === 0) {
      rooms.delete(tenantId);
      const handler = roomHandlers.get(tenantId);
      if (handler) {
        unsubscribe(`incidents:${tenantId}`, handler);
        roomHandlers.delete(tenantId);
        logger.debug({ tenantId }, '[WS] Room empty — pubsub unsubscribed');
      }
    }
  }

  function ensureRoomSubscription(tenantId: string): void {
    if (roomHandlers.has(tenantId)) return;
    const handler: PubSubHandler = (payload) => {
      broadcastToRoom(tenantId, payload);
    };
    subscribe(`incidents:${tenantId}`, handler);
    roomHandlers.set(tenantId, handler);
    logger.debug({ tenantId }, '[WS] Room created — pubsub subscribed');
  }

  // ── Connection handler ────────────────────────────────────────────────────

  wss.on('connection', (rawSocket, req) => {
    const socket = rawSocket as LiveSocket;
    socket.isAlive = true;

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const tenantId = url.searchParams.get('tenantId');

    if (!tenantId) {
      socket.close(1008, 'tenantId query parameter is required');
      return;
    }

    if (!rooms.has(tenantId)) rooms.set(tenantId, new Set());
    const room = rooms.get(tenantId) as Set<LiveSocket>;
    room.add(socket);
    ensureRoomSubscription(tenantId);

    logger.debug({ tenantId, clients: room.size }, '[WS] Client connected');

    socket.on('pong', () => {
      socket.isAlive = true;
    });

    socket.on('close', () => {
      removeFromRoom(tenantId, socket);
      logger.debug({ tenantId }, '[WS] Client disconnected');
    });

    socket.on('error', (err) => {
      logger.warn({ err, tenantId }, '[WS] Socket error');
      removeFromRoom(tenantId, socket);
    });
  });

  wss.on('error', (err) => {
    logger.error({ err }, '[WS] WebSocketServer error');
  });

  // ── Ping / pong heartbeat ─────────────────────────────────────────────────

  const heartbeat = setInterval(() => {
    for (const room of rooms.values()) {
      for (const socket of room) {
        if (!socket.isAlive) {
          socket.terminate();
          continue;
        }
        socket.isAlive = false;
        socket.ping();
      }
    }
  }, PING_INTERVAL_MS);

  heartbeat.unref(); // don't block process exit

  // ── Controller ────────────────────────────────────────────────────────────

  return {
    broadcast: broadcastToRoom,

    close(): void {
      clearInterval(heartbeat);

      for (const [tenantId, handler] of roomHandlers.entries()) {
        unsubscribe(`incidents:${tenantId}`, handler);
      }
      roomHandlers.clear();

      for (const room of rooms.values()) {
        for (const socket of room) socket.terminate();
      }
      rooms.clear();

      wss.close(() => {
        logger.info('[WS] Server closed');
      });
    },
  };
}
