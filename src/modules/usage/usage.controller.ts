/**
 * src/modules/usage/usage.controller.ts — Usage Event HTTP Handler
 *
 * POST /api/v1/usage/events
 *
 * Returns 201 on first delivery, 200 on duplicate (idempotent re-delivery).
 * The response body is identical in both cases — the client can treat them the
 * same way; the status code is the only signal that distinguishes new vs. seen.
 */

import type { Request, Response, NextFunction } from 'express';
import { ingestEvent } from './usage.service';
import type { CreateUsageEventDto } from './usage.validation';

/**
 * POST /api/v1/usage/events
 *
 * Ingests a usage event idempotently.
 * Responds with 201 on first delivery or 200 on a duplicate (same
 * Idempotency-Key), always returning the stored event in `{ data: ... }`.
 */
export async function ingest(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { tenantId } = req.user;
    const idempotencyKey = req.idempotencyKey; // set by requireIdempotencyKey middleware
    const dto = req.body as CreateUsageEventDto;

    const { event, created } = await ingestEvent(tenantId, idempotencyKey, dto);

    // 201 Created on first delivery; 200 OK on idempotent re-delivery.
    res.status(created ? 201 : 200).json({ data: event });
  } catch (err) {
    next(err);
  }
}
