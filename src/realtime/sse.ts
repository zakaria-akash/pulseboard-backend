/**
 * src/realtime/sse.ts — SSE Incident Stream Handler
 *
 * Provides `incidentSSE(req, res)` — an Express handler that opens a
 * Server-Sent Events stream for a tenant's incident feed.
 *
 * ── Protocol ──────────────────────────────────────────────────────────────────
 *   Each SSE message is formatted as:
 *     data: <JSON>\n\n
 *
 *   A keep-alive comment is sent every 20 s to prevent proxy / load-balancer
 *   idle-connection timeouts from silently closing the stream:
 *     :\n\n    (SSE comment — browsers ignore it)
 *
 * ── Auth ──────────────────────────────────────────────────────────────────────
 *   No authentication — designed for a public status page. The tenant is
 *   identified by the mandatory `?tenantId=` query parameter. Route-level auth
 *   can be added by placing `authGuard()` before this handler if needed.
 *
 * ── Backpressure ──────────────────────────────────────────────────────────────
 *   `res.flushHeaders()` is called before subscribing to pubsub so the browser
 *   receives the 200 + headers immediately and knows the stream is open.
 *   The compression middleware buffers output; calling the `flush()` shim
 *   (added by `compression`) after each write ensures events reach the client
 *   without batching delay.
 *   A `res.writableEnded` guard in the heartbeat and handler prevents writes
 *   to a socket that is already being torn down.
 *
 * ── Cleanup ───────────────────────────────────────────────────────────────────
 *   When the client disconnects (tab closed, navigation away, network drop)
 *   the `req` 'close' event fires. The handler clears the heartbeat interval
 *   and unsubscribes from the pubsub channel to prevent memory leaks.
 *
 * ── Graceful shutdown ─────────────────────────────────────────────────────────
 *   All active SSE responses are tracked in `activeSseConnections`. During
 *   application shutdown, `terminateAllSse()` calls `res.end()` on every open
 *   connection so `http.Server.close()` can drain without hanging.
 */

import type { Request, Response } from 'express';
import { subscribe, unsubscribe, type PubSubHandler } from './pubsub';
import logger from '../config/logger';

const HEARTBEAT_INTERVAL_MS = 20_000;

// ── Active connection registry ─────────────────────────────────────────────────
// Tracks every open SSE response so that `terminateAllSse()` can end them all
// during graceful shutdown, allowing `server.close()` to drain promptly.
const activeSseConnections = new Set<Response>();

/**
 * Ends every active SSE connection.
 * Call this during graceful shutdown before `server.close()` so that
 * long-lived SSE sockets do not prevent the HTTP server from draining.
 */
export function terminateAllSse(): void {
  for (const res of activeSseConnections) {
    if (!res.writableEnded) res.end();
  }
  activeSseConnections.clear();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Writes one SSE data event and flushes compression buffering. */
function sseWrite(res: Response, data: unknown): void {
  if (res.writableEnded) return;
  res.write(`data: ${JSON.stringify(data)}\n\n`);
  // The `compression` middleware adds a `.flush()` method.
  if (typeof (res as { flush?: () => void }).flush === 'function') {
    (res as { flush: () => void }).flush();
  }
}

/** Writes a keep-alive SSE comment (browsers silently ignore comments). */
function sseKeepAlive(res: Response): void {
  if (res.writableEnded) return;
  res.write(':\n\n');
  if (typeof (res as { flush?: () => void }).flush === 'function') {
    (res as { flush: () => void }).flush();
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * Express handler: opens an SSE stream for all incident lifecycle events
 * belonging to the tenant identified by `?tenantId=`.
 *
 * Usage in routes:
 *   router.get('/stream', incidentSSE);
 */
export function incidentSSE(req: Request, res: Response): void {
  const tenantId = (req.query as Record<string, string>).tenantId;

  if (!tenantId) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'tenantId query parameter is required' },
    });
    return;
  }

  // Establish the SSE connection before subscribing.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable Nginx proxy buffering
  res.flushHeaders();

  // Register in the active-connection set for graceful shutdown.
  activeSseConnections.add(res);

  logger.debug({ tenantId }, '[SSE] Client connected');

  const channel = `incidents:${tenantId}`;

  const handler: PubSubHandler = (payload) => {
    sseWrite(res, payload);
  };

  subscribe(channel, handler);

  // Periodic keep-alive to prevent idle-connection timeout.
  // The writableEnded guard inside sseKeepAlive prevents writes after shutdown.
  const heartbeat = setInterval(() => {
    if (res.writableEnded) {
      clearInterval(heartbeat);
      return;
    }
    sseKeepAlive(res);
  }, HEARTBEAT_INTERVAL_MS);

  req.on('close', () => {
    clearInterval(heartbeat);
    activeSseConnections.delete(res);
    unsubscribe(channel, handler);
    if (!res.writableEnded) res.end();
    logger.debug({ tenantId }, '[SSE] Client disconnected');
  });
}
