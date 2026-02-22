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

/**
 * @swagger
 * /checks:
 *   get:
 *     tags: [Checks]
 *     summary: List checks for the current tenant (paginated)
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number (1-based)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *         description: Items per page (max 100)
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Full-text search on check name
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [enabled, disabled]
 *         description: Filter by enabled or disabled state
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           default: createdAt_desc
 *         description: Sort expression — field + direction (e.g. `name_asc`, `createdAt_desc`)
 *     responses:
 *       200:
 *         description: Paginated list of checks
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     items:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Check'
 *                     total:
 *                       type: integer
 *                       example: 42
 *                     page:
 *                       type: integer
 *                       example: 1
 *                     limit:
 *                       type: integer
 *                       example: 20
 *                     pages:
 *                       type: integer
 *                       example: 3
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
// GET  /api/v1/checks — paginated list with optional filtering/search/sort
router.get('/', authGuard(), validate(ListChecksQuerySchema), checkController.list);

/**
 * @swagger
 * /checks:
 *   post:
 *     tags: [Checks]
 *     summary: Create a new check
 *     description: >
 *       Creates a health check for the authenticated user's tenant. The scheduler
 *       will probe the URL starting from the next interval cycle.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateCheckRequest'
 *     responses:
 *       201:
 *         description: Check created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   $ref: '#/components/schemas/Check'
 *       400:
 *         description: Validation error
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
 */
// POST /api/v1/checks — create a new check; any authenticated user can create
router.post('/', authGuard(), validate(CreateCheckSchema), checkController.create);

/**
 * @swagger
 * /checks/{id}:
 *   get:
 *     tags: [Checks]
 *     summary: Get a single check by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the check
 *     responses:
 *       200:
 *         description: Check found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   $ref: '#/components/schemas/Check'
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Check not found or belongs to a different tenant
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
// GET  /api/v1/checks/:id — fetch a single check
router.get('/:id', authGuard(), checkController.getById);

/**
 * @swagger
 * /checks/{id}:
 *   patch:
 *     tags: [Checks]
 *     summary: Partially update a check
 *     description: Only the fields provided in the request body are updated.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateCheckRequest'
 *     responses:
 *       200:
 *         description: Check updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   $ref: '#/components/schemas/Check'
 *       400:
 *         description: Validation error
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
 *       404:
 *         description: Check not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
// PATCH /api/v1/checks/:id — partial update; any authenticated user can update
router.patch('/:id', authGuard(), validate(UpdateCheckSchema), checkController.update);

/**
 * @swagger
 * /checks/{id}:
 *   delete:
 *     tags: [Checks]
 *     summary: Permanently delete a check (operator role or higher)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Check deleted — no body
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Insufficient role — requires operator or higher
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Check not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
// DELETE /api/v1/checks/:id — operator role required; viewers cannot delete
router.delete('/:id', authGuard('operator'), checkController.remove);

export default router;
