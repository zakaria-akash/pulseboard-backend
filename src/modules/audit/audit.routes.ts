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

/**
 * @swagger
 * /audit:
 *   get:
 *     tags: [Audit]
 *     summary: Query the append-only audit log (admin or owner only)
 *     description: >
 *       Returns a paginated, tenant-scoped list of all mutation events.
 *       Entries are written by services on every create/update/delete and by the
 *       scheduler on incident open/resolve. They are **never deleted or modified**.
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Start of date range for `ts` field
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: End of date range for `ts` field
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *         description: Filter by action string (e.g. `check.created`, `incident.opened`)
 *       - in: query
 *         name: targetId
 *         schema:
 *           type: string
 *         description: Filter by target document ObjectId
 *     responses:
 *       200:
 *         description: Paginated audit entries
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
 *                         $ref: '#/components/schemas/AuditEntry'
 *                     total:
 *                       type: integer
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     pages:
 *                       type: integer
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
 */
// Only admins and owners may read audit logs.
// authGuard('admin') passes for 'admin' and 'owner' (see ROLE_HIERARCHY).
router.get('/', authGuard('admin'), getAuditLog);

export default router;
