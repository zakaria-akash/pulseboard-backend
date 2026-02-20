/**
 * src/modules/check/check.routes.ts — Check API Routes
 *
 * Registers all check-related HTTP routes under /api/v1/checks (the prefix
 * is added in app.ts where this router is mounted).
 *
 * ── Routes ────────────────────────────────────────────────────────────────────
 *
 *   GET    /api/v1/checks      — paginated list of tenant checks
 *   POST   /api/v1/checks      — create a new check
 *   GET    /api/v1/checks/:id  — get a single check
 *   PATCH  /api/v1/checks/:id  — partial update
 *   DELETE /api/v1/checks/:id  — permanent delete (operator or higher)
 *
 * ── Auth ──────────────────────────────────────────────────────────────────────
 *   All routes require a valid JWT (authGuard() with no argument).
 *   DELETE additionally requires at least 'operator' role — viewers cannot
 *   delete checks, preventing accidental or malicious data loss.
 *
 * ── Validation ────────────────────────────────────────────────────────────────
 *   validate() middleware runs before each mutating handler.
 *   For GET /checks, the ListChecksQuerySchema is validated against req.query.
 *   For POST and PATCH, the respective schemas are validated against req.body,
 *   which is replaced with the parsed output (transforms applied, unknowns stripped).
 */

import { Router } from 'express';
import { authGuard } from '../../common/middleware/authGuard';
import { validate } from '../../common/middleware/validate';
import { CreateCheckSchema, UpdateCheckSchema, ListChecksQuerySchema } from './check.validation';
import * as checkController from './check.controller';

const router = Router();

// GET  /api/v1/checks — paginated list with optional filtering/search/sort
router.get('/', authGuard(), validate(ListChecksQuerySchema), checkController.list);

// POST /api/v1/checks — create a new check; any authenticated user can create
router.post('/', authGuard(), validate(CreateCheckSchema), checkController.create);

// GET  /api/v1/checks/:id — fetch a single check
router.get('/:id', authGuard(), checkController.getById);

// PATCH /api/v1/checks/:id — partial update; any authenticated user can update
router.patch('/:id', authGuard(), validate(UpdateCheckSchema), checkController.update);

// DELETE /api/v1/checks/:id — operator role required; viewers cannot delete
router.delete('/:id', authGuard('operator'), checkController.remove);

export default router;
