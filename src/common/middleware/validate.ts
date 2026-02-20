/**
 * src/common/middleware/validate.ts — Zod Validation Middleware Factory
 *
 * Returns an Express middleware that validates the incoming request data
 * against a Zod schema before the route handler runs. On success, `req.body`
 * is replaced with the parsed (and potentially coerced) data so that handlers
 * always receive a clean, typed payload. On failure, a `ValidationError` with
 * full Zod issue details is forwarded to the global error handler.
 *
 * ── GET vs. mutation requests ────────────────────────────────────────────────
 *   - GET / HEAD / DELETE: validate `req.query` (query-string parameters).
 *     The query is not replaced — Mongoose query builders read it directly.
 *   - POST / PUT / PATCH: validate `req.body`.
 *     `req.body` is replaced with `result.data` so that:
 *       a) Any Zod transforms (e.g. `z.string().trim()`) are applied.
 *       b) Unknown fields stripped by `.strict()` never reach the service layer.
 *
 * ── Why `.strict()`? ─────────────────────────────────────────────────────────
 *   Zod schemas are passthrough by default — unknown keys are silently ignored.
 *   Calling `.strict()` turns unknown keys into a validation error, which
 *   prevents clients from sneaking in extra fields that the handler might
 *   accidentally persist (e.g. `role: 'owner'` on a registration payload).
 *
 * ── Error shape ──────────────────────────────────────────────────────────────
 *   On failure the middleware forwards a `ValidationError` whose `details`
 *   field contains the raw Zod `ZodIssue[]` array. The global error handler
 *   serialises this into:
 *     { "error": { "code": "VALIDATION_ERROR", "message": "...",
 *                  "details": [{ "path": ["email"], "message": "Invalid email" }] } }
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   import { validate } from '../common/middleware/validate';
 *   import { CreateCheckSchema } from './check.validation';
 *
 *   router.post('/checks', authGuard(), validate(CreateCheckSchema), createCheck);
 */

import type { Request, Response, NextFunction } from 'express';
import type { AnyZodObject } from 'zod';
import { ValidationError } from '../errors';

/**
 * Creates an Express middleware that validates request data against `schema`.
 *
 * @param schema  A Zod object schema. `.strict()` is called internally — do
 *                not call it on the schema before passing it in, or it will
 *                be applied twice (harmless but redundant).
 */
export function validate(schema: AnyZodObject) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    // Route GET/HEAD queries through req.query; everything else through req.body.
    const target = req.method === 'GET' ? req.query : req.body;

    // safeParse never throws — it returns a discriminated union so we can
    // inspect success/failure without a try/catch.
    const result = schema.strict().safeParse(target);

    if (!result.success) {
      // Forward the error to the global error handler via next(err).
      // Attaching the Zod issue array as `details` lets the client show
      // per-field validation messages.
      next(new ValidationError('Validation failed', result.error.issues));
      return;
    }

    // Replace req.body with the parsed data so downstream handlers receive
    // a clean, coerced payload (e.g. trimmed strings, numeric coercions).
    // We skip this for GET requests since query params are read-only and
    // Zod transforms on query strings would create inconsistency.
    if (req.method !== 'GET') {
      req.body = result.data;
    }

    next();
  };
}
