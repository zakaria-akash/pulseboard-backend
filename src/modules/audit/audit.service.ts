/**
 * src/modules/audit/audit.service.ts — Audit Log Business Logic
 *
 * Two responsibilities:
 *
 *  1. `log(entry)` — fire-and-forget append.
 *     Callers (incident service, future check/tenant mutations) call this and
 *     do NOT await the promise. Any DB error is swallowed and logged via pino
 *     so an audit failure never aborts the primary operation.
 *
 *  2. `query(tenantId, opts)` — paginated read for the admin UI.
 *     Supports optional date-range, action, and targetId filters.
 *
 * ── Fire-and-forget pattern ───────────────────────────────────────────────────
 *   `log` is intentionally not awaited at call sites:
 *     void auditService.log({ ... });
 *   The `void` operator signals to ESLint/TypeScript that the promise is
 *   deliberately unhandled. The function itself catches and logs any error
 *   internally so it never rejects and never causes an UnhandledPromiseRejection.
 */

import { Types } from 'mongoose';
import { AuditLog, type AuditLogPublic } from './audit.model';
import logger from '../../config/logger';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Input shape for `log()`. All IDs are plain strings; the service converts
 * them to ObjectIds before inserting to keep callers free of Mongoose imports.
 */
export interface AuditEntry {
  tenantId: string;
  /** User ObjectId string; omit or pass null for system-generated entries. */
  actorId?: string | null;
  /** Dot-separated action, e.g. 'incident.open', 'check.create'. */
  action: string;
  /** MongoDB collection name, e.g. 'incidents', 'checks'. */
  targetCollection: string;
  /** ObjectId string of the affected document. */
  targetId: string;
  /** Arbitrary extra context to include in the log entry. */
  meta?: Record<string, unknown>;
}

export interface AuditQueryOpts {
  from?: Date;
  to?: Date;
  /** Filter by exact action string, e.g. 'incident.open'. */
  action?: string;
  /** Filter by target document ObjectId string. */
  targetId?: string;
  page?: number;
  limit?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Maps a raw lean AuditLog document to the public (string-ID) shape. */
function toPublic(doc: Record<string, unknown>): AuditLogPublic {
  return {
    _id: String(doc._id),
    tenantId: String(doc.tenantId),
    actorId: doc.actorId != null ? String(doc.actorId) : null,
    action: doc.action as string,
    targetCollection: doc.targetCollection as string,
    targetId: String(doc.targetId),
    meta: doc.meta as Record<string, unknown> | undefined,
    ts: doc.ts as Date,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Appends one immutable audit entry to the database.
 *
 * This function is intentionally fire-and-forget:
 *   - It never throws (all errors are caught and logged with pino).
 *   - Callers use `void auditService.log(...)` to signal the intent.
 *   - An audit failure must NEVER abort the primary mutation.
 */
export async function log(entry: AuditEntry): Promise<void> {
  try {
    await AuditLog.create({
      tenantId: new Types.ObjectId(entry.tenantId),
      actorId: entry.actorId ? new Types.ObjectId(entry.actorId) : null,
      action: entry.action,
      targetCollection: entry.targetCollection,
      targetId: new Types.ObjectId(entry.targetId),
      meta: entry.meta,
    });
  } catch (err) {
    // Swallow — an audit write failure must not propagate to the primary request.
    logger.error({ err, entry }, '[Audit] Failed to write audit log entry');
  }
}

/**
 * Returns a paginated list of audit log entries for `tenantId`.
 * Supports optional date-range, action, and targetId filters.
 * Results are ordered newest-first (descending `ts`).
 *
 * @param tenantId  Tenant ObjectId string.
 * @param opts      Optional filters + pagination.
 */
export async function query(
  tenantId: string,
  opts: AuditQueryOpts,
): Promise<{ items: AuditLogPublic[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(Math.max(1, opts.limit ?? 20), 100);
  const skip = (page - 1) * limit;

  // Build the filter incrementally.
  const filter: Record<string, unknown> = {
    tenantId: new Types.ObjectId(tenantId),
  };

  // Date-range filter on `ts`.
  if (opts.from ?? opts.to) {
    const tsFilter: Record<string, Date> = {};
    if (opts.from) tsFilter.$gte = opts.from;
    if (opts.to) tsFilter.$lte = opts.to;
    filter.ts = tsFilter;
  }

  if (opts.action) filter.action = opts.action;
  if (opts.targetId) filter.targetId = new Types.ObjectId(opts.targetId);

  const [rawDocs, total] = await Promise.all([
    AuditLog.find(filter).sort({ ts: -1 }).skip(skip).limit(limit).lean().exec(),
    AuditLog.countDocuments(filter).exec(),
  ]);

  return {
    items: rawDocs.map((d) => toPublic(d as unknown as Record<string, unknown>)),
    total,
    page,
    limit,
  };
}
