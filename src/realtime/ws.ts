/**
 * src/realtime/ws.ts — WebSocket Server (stub)
 *
 * Full implementation is in Phase 11. This stub exports the `attachWS`
 * function signature so that `server.ts` can import and call it from
 * Phase 3 onwards. The returned `WsController` interface is also used by
 * the graceful-shutdown handler to close all WebSocket connections before
 * the process exits.
 *
 * ── Phase 11 will implement ───────────────────────────────────────────────
 *   - Tenant-scoped rooms via `Map<tenantId, Set<WebSocket>>`
 *   - Ping/pong heartbeat every 30 s to detect dead connections
 *   - Subscribe to `incidents:{tenantId}` pubsub channel and forward events
 *     to every WebSocket in the corresponding room
 *   - `broadcast(tenantId, payload)` for pushing incident updates to clients
 */

import type { Server } from 'http';

/**
 * Handle returned by `attachWS`. Provides the two operations `server.ts`
 * needs without exposing the raw `WebSocketServer` instance:
 *
 *  - `broadcast`  — push a JSON payload to all clients in a tenant room.
 *  - `close`      — gracefully close the WS server (sends close frames to
 *                   all connected clients before resolving).
 */
export interface WsController {
  broadcast: (tenantId: string, payload: unknown) => void;
  close: () => void;
}

/**
 * Attaches a WebSocket server to an existing `http.Server` instance so that
 * both HTTP and WS traffic share a single TCP port.
 *
 * Called in `server.ts` immediately after `server.listen()` resolves.
 *
 * @param _httpServer  The Node.js HTTP server created by `http.createServer(app)`.
 * @returns            A `WsController` with `broadcast` and `close` methods.
 *
 * @todo Phase 11 — replace stub body with full `ws` implementation.
 */
export function attachWS(_httpServer: Server): WsController {
  // Phase 11: initialise `new WebSocketServer({ server: _httpServer })` here.
  return {
    broadcast: () => {
      /* Phase 11 */
    },
    close: () => {
      /* Phase 11 */
    },
  };
}
