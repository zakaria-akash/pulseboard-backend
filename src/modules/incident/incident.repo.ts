/**
 * src/modules/incident/incident.repo.ts — Incident Data Access Layer
 *
 * All functions accept `tenantId` as the first argument and inject it into
 * every MongoDB filter. This ensures cross-tenant data leakage is impossible
 * at the data layer even if the service layer has a bug.
 *
 * All read functions use `.lean()` to return plain JS objects rather than
 * Mongoose documents — faster, lighter, and safe to serialise directly.
 */

import { Types, type FilterQuery } from 'mongoose';
import { Incident, type IIncident, type IncidentPublic } from './incident.model';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Maps a raw lean document to the public (string-ID) shape. */
function toPublic(doc: Record<string, unknown>): IncidentPublic {
  const notes = (doc.notes as Array<Record<string, unknown>> | undefined) ?? [];
  return {
    _id: String(doc._id),
    tenantId: String(doc.tenantId),
    checkId: String(doc.checkId),
    status: doc.status as IncidentPublic['status'],
    openedAt: doc.openedAt as Date,
    resolvedAt: doc.resolvedAt as Date | undefined,
    lastChangeAt: doc.lastChangeAt as Date,
    notes: notes.map((n) => ({
      by: String(n.by),
      at: n.at as Date,
      text: n.text as string,
    })),
    createdAt: doc.createdAt as Date,
    updatedAt: doc.updatedAt as Date,
  };
}

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Returns a paginated, optionally filtered list of incidents for `tenantId`.
 *
 * @param tenantId  Tenant ObjectId string.
 * @param query     Parsed query params from ListIncidentsQuerySchema.
 */
export async function findAll(
  tenantId: string,
  query: Record<string, unknown>,
): Promise<{ items: IncidentPublic[]; total: number }> {
  const filter: FilterQuery<IIncident> = {
    tenantId: new Types.ObjectId(tenantId),
  };

  // Status filter.
  if (query.status) filter.status = query.status;

  // Check-specific filter.
  if (query.checkId) filter.checkId = new Types.ObjectId(String(query.checkId));

  // Date-range filter on `openedAt`.
  if (query.from || query.to) {
    filter.openedAt = {};
    if (query.from) filter.openedAt.$gte = query.from as Date;
    if (query.to) filter.openedAt.$lte = query.to as Date;
  }

  // Pagination.
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(Math.max(1, Number(query.limit) || 20), 100);
  const skip = (page - 1) * limit;

  // Sort — default: newest change first.
  const sortParam = (query.sort as string | undefined) ?? '-lastChangeAt';
  const desc = sortParam.startsWith('-');
  const sortField = desc ? sortParam.slice(1) : sortParam;
  const sortOrder = desc ? -1 : 1;

  const [rawDocs, total] = await Promise.all([
    Incident.find(filter)
      .sort({ [sortField]: sortOrder })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec(),
    Incident.countDocuments(filter).exec(),
  ]);

  return {
    items: rawDocs.map((d) => toPublic(d as unknown as Record<string, unknown>)),
    total,
  };
}

/**
 * Returns a single incident by `id`, scoped to `tenantId`.
 * Returns null if the incident doesn't exist or belongs to a different tenant.
 */
export async function findById(tenantId: string, id: string): Promise<IncidentPublic | null> {
  const doc = await Incident.findOne({
    _id: new Types.ObjectId(id),
    tenantId: new Types.ObjectId(tenantId),
  })
    .lean()
    .exec();

  return doc ? toPublic(doc as unknown as Record<string, unknown>) : null;
}

/**
 * Finds the first open (status === 'open' | 'monitoring') incident for a check.
 * Used by `openIncident` to deduplicate: if one already exists, skip creation.
 */
export async function findOpenByCheckId(
  tenantId: string,
  checkId: string,
): Promise<IncidentPublic | null> {
  const doc = await Incident.findOne({
    tenantId: new Types.ObjectId(tenantId),
    checkId: new Types.ObjectId(checkId),
    status: { $in: ['open', 'monitoring'] },
  })
    .lean()
    .exec();

  return doc ? toPublic(doc as unknown as Record<string, unknown>) : null;
}

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Creates a new incident document.
 *
 * @param tenantId  Tenant ObjectId string.
 * @param checkId   Check ObjectId string.
 */
export async function create(tenantId: string, checkId: string): Promise<IncidentPublic> {
  const now = new Date();
  const doc = await Incident.create({
    tenantId: new Types.ObjectId(tenantId),
    checkId: new Types.ObjectId(checkId),
    status: 'open',
    openedAt: now,
    lastChangeAt: now,
    notes: [],
  });
  return toPublic(doc.toObject() as unknown as Record<string, unknown>);
}

/**
 * Applies a partial update to an incident and returns the updated document.
 * Returns null if the incident doesn't exist or belongs to a different tenant.
 *
 * @param tenantId  Tenant ObjectId string.
 * @param id        Incident ObjectId string.
 * @param update    Partial update to apply (uses $set + $push for notes).
 */
export async function updateById(
  tenantId: string,
  id: string,
  update: {
    status?: string;
    resolvedAt?: Date;
    lastChangeAt?: Date;
    note?: { by: string; at: Date; text: string };
  },
): Promise<IncidentPublic | null> {
  const setFields: Record<string, unknown> = { lastChangeAt: update.lastChangeAt ?? new Date() };
  if (update.status) setFields.status = update.status;
  if (update.resolvedAt) setFields.resolvedAt = update.resolvedAt;

  const mongoUpdate: Record<string, unknown> = { $set: setFields };
  if (update.note) {
    mongoUpdate.$push = {
      notes: {
        by: new Types.ObjectId(update.note.by),
        at: update.note.at,
        text: update.note.text,
      },
    };
  }

  const doc = await Incident.findOneAndUpdate(
    { _id: new Types.ObjectId(id), tenantId: new Types.ObjectId(tenantId) },
    mongoUpdate,
    { new: true },
  )
    .lean()
    .exec();

  return doc ? toPublic(doc as unknown as Record<string, unknown>) : null;
}
