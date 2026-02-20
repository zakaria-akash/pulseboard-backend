/**
 * src/modules/usage/usage.validation.ts — Usage Event Validation
 *
 * Two exports:
 *
 *  1. `CreateUsageEventSchema` — Zod schema for the POST body.
 *
 *  2. `requireIdempotencyKey` — Express middleware that enforces the presence
 *     of the `Idempotency-Key` request header. This check runs before the Zod
 *     body validation so callers receive a clear 400 error when the header is
 *     missing rather than a confusing body-validation error.
 *
 * ── Why a middleware for the header, not a Zod header schema? ─────────────────
 *   The shared `validate()` middleware only handles `req.body` (POST/PATCH) and
 *   `req.query` (GET). Validating `req.headers` separately keeps the pattern
 *   consistent and the error message specific to the missing header.
 *
 * ── Idempotency-Key format ────────────────────────────────────────────────────
 *   The server accepts any non-empty string. UUID v4 is recommended but not
 *   enforced — the uniqueness guarantee is at the DB level (unique index), so
 *   the format does not matter as long as the client re-uses the same key on
 *   retries and generates a new key for new events.
 */

import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { ValidationError } from '../../common/errors';

// ── Body schema ───────────────────────────────────────────────────────────────

export const CreateUsageEventSchema = z.object({
  /** Event category — free-form, e.g. 'page_view', 'api_call'. */
  kind: z.string().min(1).max(100).trim(),
  /**
   * Arbitrary event-specific metadata. `z.record(z.unknown())` accepts any
   * JSON object without constraining the value types. The entire payload is
   * stored in a Mixed field so no further validation is applied here.
   */
  payload: z.record(z.unknown()).optional(),
});

export type CreateUsageEventDto = z.infer<typeof CreateUsageEventSchema>;

// ── Header guard middleware ───────────────────────────────────────────────────

/**
 * Express middleware that enforces the `Idempotency-Key` header.
 *
 * Throws a `ValidationError` (→ 400) when the header is absent or empty.
 * Attaches the validated key to `req.idempotencyKey` for downstream handlers.
 *
 * Mount this before `validate(CreateUsageEventSchema)` in the route:
 *   router.post('/events', authGuard(), requireIdempotencyKey, validate(...), handler)
 */
export function requireIdempotencyKey(req: Request, _res: Response, next: NextFunction): void {
  const key = req.headers['idempotency-key'];

  if (!key || typeof key !== 'string' || key.trim() === '') {
    next(new ValidationError('Idempotency-Key header is required'));
    return;
  }

  // Attach to request so the controller can read it without re-reading headers.
  req.idempotencyKey = key.trim();
  next();
}
