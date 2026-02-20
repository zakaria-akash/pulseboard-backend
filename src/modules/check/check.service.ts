/**
 * src/modules/check/check.service.ts — Check Business Logic & HTTP Probe
 *
 * Contains two distinct responsibilities:
 *
 *  1. CRUD business logic (Phase 6)
 *     Thin wrappers around the repo layer that add:
 *       - NotFoundError when the repo returns null.
 *       - Placeholder audit log entries (Phase 9 will persist to AuditLog).
 *       - 'checks:changed' pubsub events so the scheduler reloads its timers.
 *
 *  2. HTTP probe function — `runProbe` (Phase 7)
 *     Sends a single HTTP request to a check's URL and evaluates the result
 *     against the check's `expectedStatus` and `maxLatencyMs` thresholds.
 *     Called by the scheduler (src/scheduler.ts) on every interval tick.
 *
 * ── Security note — SSRF ──────────────────────────────────────────────────────
 *   `runProbe` sends outbound HTTP requests to operator-supplied URLs.
 *   In a production deployment, restrict outbound network access at the
 *   infrastructure level (egress firewall / VPC rules) so probes cannot reach
 *   internal services that should be unreachable from the public internet.
 *   Zod validates that `url` is a valid URL, but cannot prevent SSRF to private
 *   RFC-1918 addresses — network-level controls must handle that.
 *
 * ── Audit logging placeholder ─────────────────────────────────────────────────
 *   Phase 9 will implement audit.service.ts. Until then, mutations are logged
 *   as structured pino entries. In Phase 9 replace each logger.info call with:
 *     await auditService.log({ tenantId, actorId, action, resourceId })
 */

import axios from 'axios';
import { env } from '../../config/env';
import logger from '../../config/logger';
import { NotFoundError } from '../../common/errors';
import { publish } from '../../realtime/pubsub';
import * as checkRepo from './check.repo';
import type { CheckPublic } from './check.model';
import type { CreateCheckDto, UpdateCheckDto } from './check.validation';

// ── CRUD — list ───────────────────────────────────────────────────────────────
/**
 * Returns a paginated, filtered list of checks for the given tenant.
 * Delegates entirely to the repo; no business logic required here.
 *
 * @param tenantId  The tenant's ObjectId string.
 * @param query     Validated query parameters from req.query.
 */
export async function listChecks(
  tenantId: string,
  query: Record<string, unknown>,
): Promise<{ items: CheckPublic[]; total: number }> {
  return checkRepo.findAll(tenantId, query);
}

// ── CRUD — create ─────────────────────────────────────────────────────────────
/**
 * Creates a new check and notifies the scheduler to pick it up.
 *
 * @param tenantId  Tenant ObjectId string — the new check will belong to it.
 * @param dto       Validated CreateCheckDto from the request body.
 */
export async function createCheck(tenantId: string, dto: CreateCheckDto): Promise<CheckPublic> {
  const check = await checkRepo.create(tenantId, dto);

  // Phase 9 placeholder — replace with auditService.log(...)
  logger.info({ tenantId, checkId: check._id.toString(), action: 'check.create' }, 'Check created');

  // Signal the scheduler to reload so the new check is probed immediately.
  publish('checks:changed', { tenantId });

  return check;
}

// ── CRUD — getById ────────────────────────────────────────────────────────────
/**
 * Returns a single check by id, scoped to the tenant.
 * Throws NotFoundError (404) if the check does not exist or belongs to another
 * tenant — returning 404 rather than 403 avoids leaking resource existence.
 *
 * @param tenantId  Tenant ObjectId string.
 * @param id        Check ObjectId string from the URL parameter.
 */
export async function getCheckById(tenantId: string, id: string): Promise<CheckPublic> {
  const check = await checkRepo.findById(tenantId, id);
  if (!check) throw new NotFoundError(`Check ${id} not found`);
  return check;
}

// ── CRUD — update ─────────────────────────────────────────────────────────────
/**
 * Applies a partial update to a check and returns the updated document.
 * Notifies the scheduler so it can adjust its probe configuration (e.g. if
 * the URL or interval changed) or stop probing (if enabled was set to false).
 *
 * @param tenantId  Tenant ObjectId string.
 * @param id        Check ObjectId string from the URL parameter.
 * @param dto       Validated UpdateCheckDto — any subset of CreateCheckSchema.
 */
export async function updateCheck(
  tenantId: string,
  id: string,
  dto: UpdateCheckDto,
): Promise<CheckPublic> {
  const check = await checkRepo.updateById(tenantId, id, dto);
  if (!check) throw new NotFoundError(`Check ${id} not found`);

  // Phase 9 placeholder — replace with auditService.log(...)
  logger.info({ tenantId, checkId: id, action: 'check.update' }, 'Check updated');

  // Signal the scheduler to reload its configuration for this check.
  publish('checks:changed', { tenantId });

  return check;
}

// ── CRUD — remove ─────────────────────────────────────────────────────────────
/**
 * Permanently deletes a check. After deletion the scheduler is notified so it
 * cancels the probe timer for the deleted check.
 *
 * @param tenantId  Tenant ObjectId string.
 * @param id        Check ObjectId string from the URL parameter.
 */
export async function removeCheck(tenantId: string, id: string): Promise<void> {
  const deleted = await checkRepo.deleteById(tenantId, id);
  if (!deleted) throw new NotFoundError(`Check ${id} not found`);

  // Phase 9 placeholder — replace with auditService.log(...)
  logger.info({ tenantId, checkId: id, action: 'check.delete' }, 'Check deleted');

  // Signal the scheduler to cancel the probe timer for the deleted check.
  publish('checks:changed', { tenantId });
}

// ── Phase 7 — HTTP probe ───────────────────────────────────────────────────────

/**
 * Result of a single HTTP probe attempt.
 * Exported so the scheduler (src/scheduler.ts) can type its handleProbeResult
 * function without re-declaring the shape.
 */
export interface ProbeResult {
  /** true iff statusCode === expectedStatus AND latencyMs <= maxLatencyMs. */
  ok: boolean;
  /** HTTP status code returned by the response. 0 on network/timeout error. */
  statusCode: number;
  /** Round-trip time from request start to response received, in ms. */
  latencyMs: number;
  /** Set when an axios/network error prevented a response from being received. */
  error?: string;
}

/**
 * Sends a single HTTP GET request to `url` and evaluates the result against
 * the check's SLA expectations.
 *
 * ── Why axios with `validateStatus: () => true`? ──────────────────────────────
 *   By default, axios throws on non-2xx responses. `validateStatus: () => true`
 *   disables that behaviour so we receive the actual status code and can compare
 *   it against `expectedStatus` ourselves. A 404 that is *expected* should pass;
 *   an unexpected 200 on an endpoint that should return 404 should fail.
 *
 * ── Error handling ────────────────────────────────────────────────────────────
 *   Network errors (DNS failure, connection refused, timeout) are caught and
 *   recorded as `{ ok: false, statusCode: 0, error: message }` so the scheduler
 *   can still update `lastResult` and detect state transitions.
 *
 * @param url             The endpoint to probe (validated as a URL by Zod).
 * @param expectedStatus  The HTTP status code the probe must receive to pass.
 * @param maxLatencyMs    The maximum acceptable round-trip time in ms.
 */
export async function runProbe(
  url: string,
  expectedStatus: number,
  maxLatencyMs: number,
): Promise<ProbeResult> {
  const start = Date.now();
  try {
    const response = await axios.get<unknown>(url, {
      // Use the configurable probe timeout from env rather than a hard-coded value.
      timeout: env.PROBE_TIMEOUT_MS,
      // Accept any status code without throwing — we evaluate it ourselves.
      validateStatus: () => true,
    });

    const latencyMs = Date.now() - start;
    const ok = response.status === expectedStatus && latencyMs <= maxLatencyMs;

    return { ok, statusCode: response.status, latencyMs };
  } catch (err) {
    // Network-level failures (ECONNREFUSED, ETIMEDOUT, DNS error, etc.)
    const latencyMs = Date.now() - start;
    return {
      ok: false,
      statusCode: 0,
      latencyMs,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
