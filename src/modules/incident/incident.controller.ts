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
import { subscribe, unsubscribe, type PubSubHandler } from '../../realtime/pubsub';
import * as incidentService from './incident.service';
import type { UpdateIncidentDto } from './incident.validation';
import { parsePagination } from '../../common/paginate';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Writes one SSE event to the response and flushes. */
function sseWrite(res: Response, data: unknown): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
  // Express's compression middleware buffers output — flush ensures the event
  // is delivered to the client immediately rather than batched.
  if (typeof (res as { flush?: () => void }).flush === 'function') {
    (res as { flush: () => void }).flush();
  }
}

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
 * SSE endpoint: streams the incident timeline to the client.
 * Sends the current snapshot immediately, then forwards any
 * `incident:updated` / `incident:resolved` events for this incident.
 *
 * Requires authentication (authGuard applied in routes).
 */
export async function streamTimeline(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { tenantId } = req.user;
  const { id } = req.params;

  try {
    // Establish the SSE connection before any async work.
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable Nginx proxy buffering
    res.flushHeaders();

    // Send the current timeline as the first event.
    const timeline = await incidentService.getTimeline(tenantId, id);
    sseWrite(res, { type: 'snapshot', ...timeline });

    // Subscribe to tenant incident events and filter for this incident.
    const channel = `incidents:${tenantId}`;
    const handler: PubSubHandler = (payload) => {
      const ev = payload as { event: string; incidentId?: string };
      if (ev.incidentId === id) {
        sseWrite(res, { type: 'event', ...ev });
      }
    };

    subscribe(channel, handler);

    // Clean up when the client disconnects.
    req.on('close', () => {
      unsubscribe(channel, handler);
      res.end();
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /incidents/stream
 *
 * SSE endpoint: streams all incident lifecycle events for a tenant.
 * Intended for the public status page dashboard (no auth required).
 * The `tenantId` is read from the `?tenantId=` query param.
 *
 * Each SSE message has the shape:
 *   data: { event: 'incident:opened'|'incident:resolved'|'incident:updated', ... }
 */
export function streamFeed(req: Request, res: Response): void {
  // For the public feed, tenantId comes from the query string.
  // Authenticated routes use req.user.tenantId instead.
  const tenantId = (req.query as Record<string, string>).tenantId;

  if (!tenantId) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'tenantId is required' } });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const channel = `incidents:${tenantId}`;
  const handler: PubSubHandler = (payload) => {
    sseWrite(res, payload);
  };

  subscribe(channel, handler);

  req.on('close', () => {
    unsubscribe(channel, handler);
    res.end();
  });
}
