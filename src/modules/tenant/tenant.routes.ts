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

// POST /api/v1/tenants — admin-only tenant creation
// authGuard('admin') → validate(CreateTenantSchema) → tenantController.create
router.post('/', authGuard('admin'), validate(CreateTenantSchema), tenantController.create);

// GET /api/v1/tenants — list tenants the requesting user belongs to
// authGuard() → tenantController.list
router.get('/', authGuard(), tenantController.list);

export default router;
