/**
 * src/modules/tenant/tenant.routes.ts — Tenant API Routes
 *
 * Mounts all tenant-related HTTP routes under /api/v1/tenants (the prefix is
 * added in app.ts where this router is registered).
 *
 * ── Routes ────────────────────────────────────────────────────────────────────
 *
 *   POST  /api/v1/tenants  — create a new tenant (admin role or higher)
 *   GET   /api/v1/tenants  — list tenants the requesting user belongs to
 *
 * ── Auth ──────────────────────────────────────────────────────────────────────
 *   POST requires at least 'admin' role. Creating a tenant is a privileged
 *   action — viewer/operator accounts cannot create new workspaces. This
 *   prevents privilege escalation where any user could create a tenant and
 *   then grant themselves elevated access within it.
 *
 *   GET requires any authenticated user (authGuard() with no argument).
 *   Every user may list tenants they belong to — this drives tenant-switcher
 *   UIs in the frontend.
 *
 * ── Validation ────────────────────────────────────────────────────────────────
 *   validate(CreateTenantSchema) runs before the create handler. It calls
 *   schema.strict().safeParse(req.body), replaces req.body with the parsed
 *   output, and calls next(ValidationError) on failure — so the controller
 *   always receives a well-typed, pre-validated body.
 */

import { Router } from 'express';
import { authGuard } from '../../common/middleware/authGuard';
import { validate } from '../../common/middleware/validate';
import { CreateTenantSchema } from './tenant.validation';
import * as tenantController from './tenant.controller';

const router = Router();

/**
 * @swagger
 * /tenants:
 *   post:
 *     tags: [Tenants]
 *     summary: Create a new tenant (admin or owner only)
 *     description: >
 *       Creates a new workspace and automatically adds the requesting user as
 *       an `owner` member. Requires `admin` role or higher.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateTenantRequest'
 *     responses:
 *       201:
 *         description: Tenant created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   $ref: '#/components/schemas/Tenant'
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
 *       403:
 *         description: Insufficient role — requires admin or owner
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: Slug already taken
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
// POST /api/v1/tenants — admin-only tenant creation
// authGuard('admin') → validate(CreateTenantSchema) → tenantController.create
router.post('/', authGuard('admin'), validate(CreateTenantSchema), tenantController.create);

/**
 * @swagger
 * /tenants:
 *   get:
 *     tags: [Tenants]
 *     summary: List tenants the current user belongs to
 *     description: >
 *       Returns all tenants in which the authenticated user holds a membership.
 *       Used to populate tenant-switcher UIs in the frontend.
 *     responses:
 *       200:
 *         description: List of tenants
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Tenant'
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
// GET /api/v1/tenants — list tenants the requesting user belongs to
// authGuard() → tenantController.list
router.get('/', authGuard(), tenantController.list);

export default router;
