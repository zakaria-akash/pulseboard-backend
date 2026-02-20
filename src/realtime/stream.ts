/**
 * src/realtime/stream.ts — Streaming HTTP Timeline Response
 *
 * `streamTimeline(req, res)` sends the audit log entries for an incident as a
 * chunked JSON response without loading the entire result set into memory.
 *
 * ── Wire format ───────────────────────────────────────────────────────────────
 *   The response body is a single JSON object:
 *     { "items": [ <entry>, <entry>, ... ] }
 *
 *   Written in three phases:
 *     1. Write the opening:   '{"items":['
 *     2. Stream each document from the Mongoose cursor, comma-separated.
 *     3. Write the closing:   ']}'
 *
 * ── Why a Mongoose cursor instead of `.find().lean()`? ────────────────────────
 *   An incident timeline can have hundreds of audit entries. Loading them all
 *   into a JS array before writing the response would consume O(n) memory and
 *   delay the first byte. A cursor yields documents one at a time, allowing
 *   Node.js to send data to the client while still reading from MongoDB —
 *   classic streaming / backpressure.
 *
 * ── Async generator ───────────────────────────────────────────────────────────
 *   Mongoose QueryCursor implements the async iterator protocol, so we can use
 *   `for await...of` to consume it. The async generator `auditCursor` wraps
 *   the Mongoose cursor to enforce the tenant + targetId filter cleanly.
 *
 * ── Error handling ────────────────────────────────────────────────────────────
 *   Once the response headers have been flushed (after the first `res.write`)
 *   we can no longer send an HTTP error status. Errors after that point are
 *   logged and the stream is terminated early with a closing `]}` so the client
 *   receives valid (if partial) JSON.
 *
 * ── Auth ──────────────────────────────────────────────────────────────────────
 *   The route using this handler must apply `authGuard()` to ensure `req.user`
 *   is present. The tenantId from the JWT is used to scope the DB query.
 */

import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { AuditLog } from '../modules/audit/audit.model';
import { Incident } from '../modules/incident/incident.model';
import { NotFoundError } from '../common/errors';
import logger from '../config/logger';

/**
 * Async generator that streams audit log documents for a given incident
 * one at a time using a Mongoose QueryCursor.
 *
 * Using a cursor means only one document lives in memory at a time;
 * the rest remain in MongoDB until requested.
 */
async function* auditCursor(tenantId: string, targetId: string) {
  const cursor = AuditLog.find({
    tenantId: new Types.ObjectId(tenantId),
    targetId: new Types.ObjectId(targetId),
  })
    .sort({ ts: 1 })
    .lean()
    .cursor();

  for await (const doc of cursor) {
    yield doc;
  }
}

/**
 * Express handler: streams the audit timeline for an incident as chunked JSON.
 *
 * Route param: `:id` — the incident ObjectId string.
 * Requires `authGuard()` in the middleware chain (reads `req.user.tenantId`).
 *
 * Usage in routes:
 *   router.get('/:id/timeline/stream', authGuard(), streamTimeline);
 */
export async function streamTimeline(req: Request, res: Response): Promise<void> {
  const { tenantId } = req.user;
  const { id } = req.params;

  // Verify the incident exists and belongs to this tenant before streaming.
  const incident = await Incident.findOne({
    _id: new Types.ObjectId(id),
    tenantId: new Types.ObjectId(tenantId),
  })
    .lean()
    .exec();

  if (!incident) {
    // Headers not yet flushed — safe to send a proper HTTP error.
    const err = new NotFoundError(`Incident ${id} not found`);
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message },
    });
    return;
  }

  // Set chunked transfer encoding headers.
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('X-Accel-Buffering', 'no');

  // Phase 1: open the JSON array.
  res.write('{"items":[');

  let first = true;

  try {
    for await (const doc of auditCursor(tenantId, id)) {
      // Comma-separate entries; no trailing comma.
      if (!first) res.write(',');
      first = false;
      res.write(JSON.stringify(doc));
    }
  } catch (err) {
    // Cannot change status code once headers are flushed — log and close cleanly.
    logger.error({ err, incidentId: id }, '[stream] Error during timeline cursor');
  }

  // Phase 3: close the JSON array and end the response.
  res.write(']}');
  res.end();
}
