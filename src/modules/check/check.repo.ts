/**
 * src/modules/check/check.repo.ts — Check Database Layer
 *
 * All Mongoose queries for the Check collection live here. Every function
 * receives `tenantId` as its first argument and injects it into every query
 * filter — no query ever touches another tenant's data.
 *
 * ── Design principles ─────────────────────────────────────────────────────────
 *
 *  Tenant isolation
 *    Every read and write filter includes `{ tenantId }`. This means a tenant
 *    cannot read, update, or delete another tenant's checks even if they know
 *    the ObjectId — the query simply returns null / no documents.
 *
 *  Lean queries
 *    All reads use `.lean()` so Mongoose returns plain JavaScript objects
 *    rather than full Mongoose Document instances. This is faster, uses less
 *    memory, and avoids accidental mutation of Mongoose's internal state.
 *
 *  toPublic helper
 *    Converts a raw lean result to CheckPublic. Explicit field mapping ensures
 *    no Mongoose internals (__v) are forwarded to the service or API.
 *
 *  findAll — text search + filtering + sorting + pagination
 *    Supports three optional query filters:
 *      - `?q=`      → MongoDB `$text` search on `name` (requires the text index)
 *      - `?status=` → filter by enabled/disabled
 *      - `?sort=`   → sort field with optional `-` prefix for descending
 */

import { Types, type FilterQuery, type SortOrder } from 'mongoose';
import { Check, type ICheck, type CheckPublic } from './check.model';
import { parsePagination } from '../../common/paginate';
import type { CreateCheckDto, UpdateCheckDto } from './check.validation';

// ── Internal helper ───────────────────────────────────────────────────────────
/**
 * Converts a raw lean Mongoose document to the public-safe CheckPublic shape.
 */
function toPublic(
  doc: ICheck & { _id: Types.ObjectId; createdAt?: Date; updatedAt?: Date },
): CheckPublic {
  return {
    _id: doc._id,
    tenantId: doc.tenantId,
    name: doc.name,
    url: doc.url,
    expectedStatus: doc.expectedStatus,
    maxLatencyMs: doc.maxLatencyMs,
    enabled: doc.enabled,
    lastResult: doc.lastResult,
    createdAt: doc.createdAt ?? new Date(),
    updatedAt: doc.updatedAt ?? new Date(),
  };
}

// ── findAll ───────────────────────────────────────────────────────────────────
/**
 * Returns a paginated, optionally filtered and searched list of checks for
 * a given tenant. The list query and count query run in parallel.
 *
 * @param tenantId  The tenant's ObjectId string — all returned checks belong to it.
 * @param query     Raw query parameters from req.query (validated by Zod middleware).
 */
export async function findAll(
  tenantId: string,
  query: Record<string, unknown>,
): Promise<{ items: CheckPublic[]; total: number }> {
  const { skip, limit } = parsePagination(query);

  const filter: FilterQuery<ICheck> = { tenantId: new Types.ObjectId(tenantId) };

  // Optional enabled/disabled filter.
  if (query.status === 'enabled') filter.enabled = true;
  else if (query.status === 'disabled') filter.enabled = false;

  // Optional full-text search. Requires the { name: 'text' } index on the schema.
  if (typeof query.q === 'string' && query.q.trim()) {
    filter.$text = { $search: query.q.trim() };
  }

  // Build sort order. Default: newest checks first.
  const sortStr = typeof query.sort === 'string' ? query.sort : '-createdAt';
  const sortDesc = sortStr.startsWith('-');
  const sortKey = sortDesc ? sortStr.slice(1) : sortStr;
  const sort: Record<string, SortOrder> = { [sortKey]: sortDesc ? -1 : 1 };

  const [docs, total] = await Promise.all([
    Check.find(filter).sort(sort).skip(skip).limit(limit).lean().exec(),
    Check.countDocuments(filter).exec(),
  ]);

  return {
    items: docs.map((d) =>
      toPublic(d as ICheck & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date }),
    ),
    total,
  };
}

// ── findById ──────────────────────────────────────────────────────────────────
/**
 * Returns a single check by id, scoped to the tenant.
 * Returns null if the check does not exist or belongs to a different tenant.
 */
export async function findById(tenantId: string, id: string): Promise<CheckPublic | null> {
  const doc = await Check.findOne({
    _id: new Types.ObjectId(id),
    tenantId: new Types.ObjectId(tenantId),
  })
    .lean()
    .exec();

  if (!doc) return null;
  return toPublic(doc as ICheck & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date });
}

// ── create ────────────────────────────────────────────────────────────────────
/**
 * Inserts a new check document and returns the created document as CheckPublic.
 */
export async function create(tenantId: string, dto: CreateCheckDto): Promise<CheckPublic> {
  const doc = await Check.create({ tenantId: new Types.ObjectId(tenantId), ...dto });
  return toPublic(
    doc.toObject() as ICheck & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date },
  );
}

// ── updateById ────────────────────────────────────────────────────────────────
/**
 * Applies a partial update to a check and returns the updated document.
 * Returns null if the check does not exist or belongs to a different tenant.
 * `{ new: true }` ensures Mongoose returns the document after the update.
 */
export async function updateById(
  tenantId: string,
  id: string,
  dto: UpdateCheckDto,
): Promise<CheckPublic | null> {
  const doc = await Check.findOneAndUpdate(
    { _id: new Types.ObjectId(id), tenantId: new Types.ObjectId(tenantId) },
    { $set: dto },
    { new: true },
  )
    .lean()
    .exec();

  if (!doc) return null;
  return toPublic(doc as ICheck & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date });
}

// ── deleteById ────────────────────────────────────────────────────────────────
/**
 * Deletes a check scoped to the tenant.
 * Returns true if a document was deleted, false if none was found.
 */
export async function deleteById(tenantId: string, id: string): Promise<boolean> {
  const doc = await Check.findOneAndDelete({
    _id: new Types.ObjectId(id),
    tenantId: new Types.ObjectId(tenantId),
  })
    .lean()
    .exec();

  return doc !== null;
}
