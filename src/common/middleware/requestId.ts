/**
 * src/common/middleware/requestId.ts — Request ID Middleware
 *
 * Assigns a unique identifier to every inbound HTTP request and propagates it
 * through the response headers. The ID is then available as `req.requestId`
 * throughout the request lifecycle so it can be included in log lines, error
 * responses, and child loggers for end-to-end tracing.
 *
 * ── How the ID is sourced ─────────────────────────────────────────────────────
 *   1. If the inbound request already carries an `X-Request-Id` header (e.g.
 *      forwarded by a load balancer, API gateway, or upstream service), that
 *      value is reused unchanged. This preserves distributed trace IDs across
 *      service boundaries.
 *   2. Otherwise a new UUID v4 is generated — guaranteed globally unique with
 *      negligible collision probability (~5.3 × 10⁻³⁶).
 *
 * ── Why the response header matters ──────────────────────────────────────────
 *   Setting `X-Request-Id` on the response lets browser devtools and API
 *   clients correlate a slow or failed response with the corresponding log
 *   entry in Kibana / Loki / CloudWatch without needing a separate lookup.
 *
 * ── Usage (mounting in app.ts) ────────────────────────────────────────────────
 *   app.use(requestId);   // must be the very first middleware
 *
 * ── Accessing the ID downstream ───────────────────────────────────────────────
 *   // In any middleware or route handler that runs after this one:
 *   logger.info({ requestId: req.requestId }, 'Processing request');
 *
 *   // In the error handler:
 *   logger.error({ requestId: req.requestId, err }, 'Unhandled error');
 */

import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

/**
 * Express middleware that attaches a unique `requestId` to every request.
 *
 * Must be mounted before any other middleware so that `req.requestId` is
 * available everywhere — including inside other middleware functions and the
 * global error handler.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  // Honour an existing ID from upstream (load balancer, API gateway, client).
  // Fall back to a freshly generated UUID v4.
  const id = (req.headers['x-request-id'] as string | undefined) ?? uuidv4();

  // Attach to the request object so downstream code can read it without
  // re-parsing the header (type declaration lives in src/types/express.d.ts).
  req.requestId = id;

  // Echo the ID back in the response so clients can correlate logs.
  res.setHeader('X-Request-Id', id);

  next();
}
