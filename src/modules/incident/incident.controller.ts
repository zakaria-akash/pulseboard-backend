/**
 * src/modules/incident/incident.controller.ts — Incident HTTP Handlers
 *
 * Handlers:
 *   list          GET /incidents            — paginated list for the tenant
 *   getById       GET /incidents/:id        — single incident
 *   update        PATCH /incidents/:id      — status change / add note
 *   streamTimeline GET /incidents/:id/timeline/stream — SSE timeline stream
 *   streamFeed    GET /incidents/stream     — SSE feed of all tenant incidents
 *
 * ── SSE pattern ───────────────────────────────────────────────────────────────
 *   Both SSE handlers follow the same structure:
 *     1. Write `Content-Type: text/event-stream` and flush headers.
 *     2. Send the current snapshot as the first event.
 *     3. Subscribe to the relevant pubsub channel.
 *     4. On each pubsub event, write a new SSE data line and flush.
 *     5. On `req` 'close', unsubscribe and clean up.
 *
 *   `res.flushHeaders()` is called before any async work so the browser
 *   receives the 200 + headers immediately and knows the stream is open.
 *
 *   Each SSE event is formatted as:
 *     data: <JSON string>\n\n
 *   The double newline terminates the event; the browser dispatches it.
 */

import type { Request, Response, NextFunction } from 'express';
import { sendSuccess, sendPaginated } from '../../common/http';
import * as incidentService from './incident.service';
import type { UpdateIncidentDto } from './incident.validation';
import { parsePagination } from '../../common/paginate';
import { incidentSSE } from '../../realtime/sse';
import { streamTimeline as streamTimelineChunkedImpl } from '../../realtime/stream';

// ── Controllers ───────────────────────────────────────────────────────────────

/**
 * GET /incidents
 * Returns a paginated list of incidents for the authenticated user's tenant.
 */
export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { tenantId } = req.user;
    const { page, limit } = parsePagination(req.query as Record<string, unknown>);
    const result = await incidentService.listIncidents(
      tenantId,
      req.query as Record<string, unknown>,
    );
    sendPaginated(res, result.items, result.total, page, limit);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /incidents/:id
 * Returns a single incident. 404 if not found or cross-tenant.
 */
export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { tenantId } = req.user;
    const incident = await incidentService.getIncidentById(tenantId, req.params.id);
    sendSuccess(res, incident);
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /incidents/:id
 * Applies a status change and/or appends a note to the incident.
 * Validates state-machine transitions; returns 400 on invalid transition.
 */
export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { tenantId, sub: actorId } = req.user;
    const dto = req.body as UpdateIncidentDto;
    const incident = await incidentService.updateIncident(tenantId, req.params.id, dto, actorId);
    sendSuccess(res, incident);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /incidents/:id/timeline/stream
 *
 * Streams the audit log for an incident as chunked JSON:
 *   { "items": [ <auditEntry>, ... ] }
 *
 * Uses a Mongoose cursor for backpressure — documents are sent one at a time
 * without buffering the full result set in memory. Delegates to stream.ts.
 *
 * Requires authentication (authGuard applied in routes).
 */
export async function streamTimeline(req: Request, res: Response): Promise<void> {
  await streamTimelineChunkedImpl(req, res);
}

/**
 * GET /incidents/stream
 *
 * SSE endpoint: streams all incident lifecycle events for a tenant.
 * No auth required — designed for a public status page.
 * The `tenantId` is read from the `?tenantId=` query param.
 *
 * Delegates to sse.ts (incidentSSE) which handles heartbeats and cleanup.
 */
export function streamFeed(req: Request, res: Response): void {
  incidentSSE(req, res);
}
