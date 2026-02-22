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

/**
 * @swagger
 * /usage/events:
 *   post:
 *     tags: [Usage]
 *     summary: Ingest a usage event (idempotent)
 *     description: >
 *       Stores a usage event. The `Idempotency-Key` header **must** be present.
 *       If the same key is submitted twice (e.g. client retry after a timeout),
 *       the second call returns the original stored event without creating a duplicate.
 *
 *       Idempotency is enforced at the database level via a unique index on
 *       `idempotencyKey` — no race conditions are possible.
 *
 *       **Rate limit:** 60 requests/min per IP (stricter than the global 200/min).
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         required: true
 *         schema:
 *           type: string
 *         description: >
 *           A unique client-generated key (UUID v4 or similar) that identifies
 *           this specific event submission. Must be globally unique per tenant.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateUsageEventRequest'
 *     responses:
 *       200:
 *         description: Event accepted (new or idempotent duplicate)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   $ref: '#/components/schemas/UsageEvent'
 *       400:
 *         description: Missing Idempotency-Key header or validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: Rate limit exceeded (60 req/min)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  '/events',
  authGuard(),
  requireIdempotencyKey,
  validate(CreateUsageEventSchema),
  ingest,
);

export default router;
