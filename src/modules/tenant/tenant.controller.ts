/**
 * src/modules/tenant/tenant.controller.ts — Tenant HTTP Handlers
 *
 * Thin layer between Express routing and the tenant service. Controllers are
 * responsible only for:
 *   - Extracting data from the request (req.body, req.params, req.user).
 *   - Calling the appropriate service function.
 *   - Serialising the result into the standard HTTP response envelope.
 *   - Forwarding errors to next() for the global error handler.
 *
 * All business logic and DB access live in tenant.service.ts.
 */

import type { Request, Response, NextFunction } from 'express';
import * as tenantService from './tenant.service';
import { sendSuccess } from '../../common/http';
import type { CreateTenantDto } from './tenant.validation';

// ── create ────────────────────────────────────────────────────────────────────
/**
 * POST /api/v1/tenants
 *
 * Creates a new tenant. The authenticated user (req.user.sub) becomes the
 * owner and is automatically granted an 'owner' membership record.
 *
 * The validate(CreateTenantSchema) middleware runs before this handler and
 * ensures req.body is a valid CreateTenantDto before control reaches here.
 *
 * Responds: 201 { data: TenantPublic }
 */
export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const dto = req.body as CreateTenantDto;
    const tenant = await tenantService.createTenant(dto, req.user.sub);
    sendSuccess(res, tenant, 201);
  } catch (err) {
    next(err);
  }
}

// ── list ──────────────────────────────────────────────────────────────────────
/**
 * GET /api/v1/tenants
 *
 * Returns all tenants where the authenticated user (req.user.sub) has a
 * membership record. The result is not paginated in Phase 5 — users are
 * expected to belong to a small number of tenants. Pagination can be added
 * in a later phase if the use case demands it.
 *
 * Responds: 200 { data: TenantPublic[] }
 */
export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenants = await tenantService.listTenants(req.user.sub);
    sendSuccess(res, tenants);
  } catch (err) {
    next(err);
  }
}
