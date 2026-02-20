/**
 * src/modules/check/check.controller.ts — Check HTTP Handlers
 *
 * Thin layer between Express routing and the check service. Each handler:
 *   - Reads identity from req.user.tenantId (set by authGuard).
 *   - Extracts the relevant data from req (body, params, query).
 *   - Calls the appropriate service function.
 *   - Sends the standard HTTP response envelope.
 *   - Forwards errors to next() for the global error handler.
 *
 * No business logic or DB access lives here — everything is in check.service.ts.
 */

import type { Request, Response, NextFunction } from 'express';
import * as checkService from './check.service';
import { sendSuccess, sendPaginated } from '../../common/http';
import { parsePagination } from '../../common/paginate';
import type { CreateCheckDto, UpdateCheckDto } from './check.validation';

// ── list ──────────────────────────────────────────────────────────────────────
/**
 * GET /api/v1/checks
 *
 * Returns a paginated list of checks scoped to the authenticated user's tenant.
 * Supports optional query parameters: `?q=`, `?status=`, `?sort=`, `?page=`, `?limit=`.
 *
 * Responds: 200 { data: { items: CheckPublic[], total, page, limit, pages } }
 */
export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // parsePagination reads page/limit from req.query and returns the
    // 1-based page and limit that sendPaginated needs for its metadata.
    const { page, limit } = parsePagination(req.query);
    const { items, total } = await checkService.listChecks(
      req.user.tenantId,
      req.query as Record<string, unknown>,
    );
    sendPaginated(res, items, total, page, limit);
  } catch (err) {
    next(err);
  }
}

// ── create ────────────────────────────────────────────────────────────────────
/**
 * POST /api/v1/checks
 *
 * Creates a new check for the authenticated user's tenant. The
 * validate(CreateCheckSchema) middleware ensures req.body is a typed
 * CreateCheckDto before this handler runs.
 *
 * Responds: 201 { data: CheckPublic }
 */
export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const dto = req.body as CreateCheckDto;
    const check = await checkService.createCheck(req.user.tenantId, dto);
    sendSuccess(res, check, 201);
  } catch (err) {
    next(err);
  }
}

// ── getById ───────────────────────────────────────────────────────────────────
/**
 * GET /api/v1/checks/:id
 *
 * Returns a single check scoped to the authenticated user's tenant.
 * The service throws NotFoundError (404) if the check does not exist or
 * belongs to a different tenant.
 *
 * Responds: 200 { data: CheckPublic }
 */
export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const check = await checkService.getCheckById(req.user.tenantId, req.params.id);
    sendSuccess(res, check);
  } catch (err) {
    next(err);
  }
}

// ── update ────────────────────────────────────────────────────────────────────
/**
 * PATCH /api/v1/checks/:id
 *
 * Applies a partial update to a check. The validate(UpdateCheckSchema)
 * middleware ensures req.body contains only valid, known fields.
 *
 * Responds: 200 { data: CheckPublic } (updated document)
 */
export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const dto = req.body as UpdateCheckDto;
    const check = await checkService.updateCheck(req.user.tenantId, req.params.id, dto);
    sendSuccess(res, check);
  } catch (err) {
    next(err);
  }
}

// ── remove ────────────────────────────────────────────────────────────────────
/**
 * DELETE /api/v1/checks/:id
 *
 * Permanently deletes a check. Requires at least 'operator' role (enforced
 * by authGuard('operator') in the router). Returns 204 No Content on success.
 *
 * Responds: 204 (no body)
 */
export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await checkService.removeCheck(req.user.tenantId, req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
