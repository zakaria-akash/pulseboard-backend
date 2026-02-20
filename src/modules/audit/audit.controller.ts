/**
 * src/modules/audit/audit.controller.ts — Audit Log HTTP Handler
 *
 * Single endpoint: GET /api/v1/audit
 * Access: admin or owner only (enforced by authGuard('admin') in the router).
 *
 * Query parameters (all optional):
 *   from      ISO-8601 date — return entries at or after this timestamp
 *   to        ISO-8601 date — return entries at or before this timestamp
 *   action    Exact action string filter, e.g. 'incident.open'
 *   targetId  ObjectId string of the affected document
 *   page      Page number (default 1)
 *   limit     Page size (default 20, max 100)
 */

import type { Request, Response, NextFunction } from 'express';
import * as auditService from './audit.service';
import { sendPaginated } from '../../common/http';

/**
 * GET /api/v1/audit
 *
 * Returns a paginated, filtered list of audit log entries for the
 * authenticated user's tenant. Only admins and owners can access this.
 */
export async function getAuditLog(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { tenantId } = req.user;
    const q = req.query as Record<string, string | undefined>;

    const opts: auditService.AuditQueryOpts = {
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      action: q.action ?? undefined,
      targetId: q.targetId ?? undefined,
      page: q.page ? parseInt(q.page, 10) : undefined,
      limit: q.limit ? parseInt(q.limit, 10) : undefined,
    };

    const result = await auditService.query(tenantId, opts);
    sendPaginated(res, result.items, result.total, result.page, result.limit);
  } catch (err) {
    next(err);
  }
}
