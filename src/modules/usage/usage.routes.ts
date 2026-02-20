/**
 * src/modules/usage/usage.routes.ts — Usage Event Routes
 *
 * Mounted at /api/v1/usage in app.ts, behind the `usageLimiter` (60 req/min).
 *
 * Routes:
 *   POST /events  authGuard() + requireIdempotencyKey + validate → ingest
 *
 * Middleware order:
 *   1. authGuard()            — JWT authentication; attaches req.user
 *   2. usageLimiter           — applied at mount point in app.ts (not here)
 *   3. requireIdempotencyKey  — 400 if Idempotency-Key header is absent/empty
 *   4. validate(schema)       — Zod body validation; replaces req.body with parsed data
 *   5. ingest                 — controller
 */

import { Router } from 'express';
import { authGuard } from '../../common/middleware/authGuard';
import { validate } from '../../common/middleware/validate';
import { CreateUsageEventSchema, requireIdempotencyKey } from './usage.validation';
import { ingest } from './usage.controller';

const router = Router();

router.post(
  '/events',
  authGuard(),
  requireIdempotencyKey,
  validate(CreateUsageEventSchema),
  ingest,
);

export default router;
