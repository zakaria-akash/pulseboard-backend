/**
 * src/modules/incident/incident.controller.ts — Incident HTTP Handlers
 *
 * Handlers:
 *   list            GET /incidents            — paginated list for the tenant
 *   getById         GET /incidents/:id        — single incident
 *   update          PATCH /incidents/:id      — status change / add note
 *   exportIncidents GET /incidents/export     — CSV download for a date range
 *   streamTimeline  GET /incidents/:id/timeline/stream — chunked JSON timeline
 *   streamFeed      GET /incidents/stream     — SSE feed of all tenant incidents
 *
 * ── CSV export ────────────────────────────────────────────────────────────────
 *   `exportIncidents` validates `from`/`to` query params (max 90-day range),
 *   sets CSV response headers, then streams rows via a Mongoose cursor so the
 *   full result set is never loaded into memory at once.
 *
 *   Columns: id, checkName, status, openedAt, resolvedAt, noteCount
 *   Check names are populated via Mongoose `.populate('checkId', 'name')`.
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
import { Types } from 'mongoose';
import { sendSuccess, sendPaginated } from '../../common/http';
import * as incidentService from './incident.service';
import type { UpdateIncidentDto } from './incident.validation';
import { parsePagination } from '../../common/paginate';
import { Incident } from './incident.model';
import { incidentSSE } from '../../realtime/sse';
import { streamTimeline as streamTimelineChunkedImpl } from '../../realtime/stream';
import logger from '../../config/logger';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Shape of an incident document after Mongoose populates `checkId`. */
interface PopulatedExportDoc {
  _id: { toString(): string };
  checkId: { name?: string } | null;
  status: string;
  openedAt: Date;
  resolvedAt?: Date;
  notes: unknown[];
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
 * GET /incidents/export
 *
 * Streams incident history as a CSV attachment for a given date range.
 *
 * Query params:
 *   from    ISO date string — range start (inclusive, matched against openedAt)
 *   to      ISO date string — range end   (inclusive, matched against openedAt)
 *   status  optional — filter to 'open' | 'monitoring' | 'resolved'
 *
 * Response:
 *   Content-Type: text/csv
 *   Content-Disposition: attachment; filename="incidents-<from>-<to>.csv"
 *   Columns: id, checkName, status, openedAt, resolvedAt, noteCount
 *
 * The date range must not exceed 90 days. Uses a Mongoose cursor so the full
 * result set is never loaded into memory — safe for very large exports.
 */
export async function exportIncidents(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { tenantId } = req.user;
    const q = req.query as Record<string, string | undefined>;

    // ── Validate required date params ──────────────────────────────────────
    if (!q.from || !q.to) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: '`from` and `to` query parameters are required',
        },
      });
      return;
    }

    const from = new Date(q.from);
    const to = new Date(q.to);

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: '`from` and `to` must be valid ISO dates' },
      });
      return;
    }

    const MS_90_DAYS = 90 * 24 * 60 * 60 * 1000;
    if (to.getTime() - from.getTime() > MS_90_DAYS) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Date range must not exceed 90 days' },
      });
      return;
    }

    // ── Build MongoDB filter ───────────────────────────────────────────────
    const filter: Record<string, unknown> = {
      tenantId: new Types.ObjectId(tenantId),
      openedAt: { $gte: from, $lte: to },
    };
    if (q.status) filter.status = q.status;

    // ── Set CSV response headers (before the first res.write) ─────────────
    const fromLabel = from.toISOString().slice(0, 10);
    const toLabel = to.toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="incidents-${fromLabel}-${toLabel}.csv"`,
    );
    res.setHeader('X-Accel-Buffering', 'no');

    // ── Phase 1: CSV header row ────────────────────────────────────────────
    res.write('id,checkName,status,openedAt,resolvedAt,noteCount\n');

    // ── Phase 2: Stream data rows via Mongoose cursor ──────────────────────
    const cursor = Incident.find(filter)
      .sort({ openedAt: 1 })
      .populate('checkId', 'name') // fetch check name without loading full Check doc
      .cursor();

    try {
      for await (const rawDoc of cursor) {
        const doc = rawDoc as unknown as PopulatedExportDoc;
        const checkName = doc.checkId?.name ?? '';
        const row = [
          doc._id.toString(),
          // RFC 4180: quote fields that may contain commas; double any inner quotes
          `"${checkName.replace(/"/g, '""')}"`,
          doc.status,
          doc.openedAt.toISOString(),
          doc.resolvedAt?.toISOString() ?? '',
          String((doc.notes as unknown[]).length),
        ].join(',');
        res.write(row + '\n');
      }
    } catch (streamErr) {
      // Cannot change status after headers are flushed — log and close cleanly.
      logger.error({ err: streamErr, tenantId }, '[export] Error during incident cursor');
    }

    // ── Phase 3: End the response ──────────────────────────────────────────
    res.end();
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
