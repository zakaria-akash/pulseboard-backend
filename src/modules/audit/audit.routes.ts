/**
 * src/modules/audit/audit.routes.ts — Audit Log Routes
 *
 * Mounted at /api/v1/audit in app.ts.
 *
 * Routes:
 *   GET /   authGuard('admin') — paginated audit log for the tenant's admins/owners
 */

import { Router } from 'express';
import { authGuard } from '../../common/middleware/authGuard';
import { getAuditLog } from './audit.controller';

const router = Router();

// Only admins and owners may read audit logs.
// authGuard('admin') passes for 'admin' and 'owner' (see ROLE_HIERARCHY).
router.get('/', authGuard('admin'), getAuditLog);

export default router;
