/**
 * src/modules/tenant/tenant.service.ts — Tenant Business Logic
 *
 * Contains all tenant domain logic. Controllers call these functions and handle
 * only HTTP concerns (response shape, status codes). This layer is
 * database-aware but HTTP-unaware — it throws typed AppErrors, not HTTP
 * responses.
 *
 * ── Functions ─────────────────────────────────────────────────────────────────
 *
 *  createTenant(dto, actorId)      — create a tenant + owner membership
 *  listTenants(userId)             — tenants where the user has a membership
 *  getTenantById(tenantId, userId) — scoped single-tenant lookup
 *
 * ── Multi-tenancy model ───────────────────────────────────────────────────────
 *   Users access tenants through the Membership join table, not through a
 *   direct tenantId field on the User document. This enables:
 *     - One user to belong to multiple tenants (consultant, agency, etc.).
 *     - Per-tenant role assignment that is independent of the global user role.
 *
 *   All functions that return a specific tenant validate membership first.
 *   Returning 404 (rather than 403) when a tenant exists but the requesting
 *   user has no membership prevents information disclosure about tenants the
 *   caller has no access to.
 *
 * ── Audit logging ─────────────────────────────────────────────────────────────
 *   Phase 9 will implement audit.service.ts with a persistent DB-backed audit
 *   log. createTenant currently logs a structured pino message as a placeholder.
 *   In Phase 9 this will be replaced with:
 *     await auditService.log({ tenantId, actorId, action: 'tenant.create' })
 */

import { Types } from 'mongoose';
import { Tenant, type ITenant, type TenantPublic } from './tenant.model';
import { Membership } from './membership.model';
import { ConflictError, NotFoundError } from '../../common/errors';
import logger from '../../config/logger';
import type { CreateTenantDto } from './tenant.validation';

// ── Internal helper ───────────────────────────────────────────────────────────
/**
 * Maps a raw Mongoose document (lean or toObject()) to the public-safe
 * TenantPublic shape. Explicit field mapping ensures no internal Mongoose
 * fields (__v) are forwarded to callers.
 *
 * @param doc  A Mongoose lean result or toObject() output for a Tenant document.
 */
function toPublic(
  doc: ITenant & { _id: Types.ObjectId; createdAt?: Date; updatedAt?: Date },
): TenantPublic {
  return {
    _id: doc._id,
    name: doc.name,
    slug: doc.slug,
    ownerId: doc.ownerId,
    // Mongoose always sets these with `timestamps: true`. The fallback to
    // new Date() is a no-op in practice but avoids a non-null assertion warning.
    createdAt: doc.createdAt ?? new Date(),
    updatedAt: doc.updatedAt ?? new Date(),
  };
}

// ── createTenant ──────────────────────────────────────────────────────────────
/**
 * Creates a new tenant and grants the creator an 'owner' membership.
 *
 * Steps:
 *  1. Check slug uniqueness — 409 Conflict if already taken.
 *  2. Create the Tenant document.
 *  3. Create an 'owner' Membership so the creator has full access to the tenant.
 *  4. Emit a placeholder audit log entry (Phase 9 will persist this to the DB).
 *
 * @param dto      Validated CreateTenantDto (name, slug).
 * @param actorId  The `sub` claim from the JWT — the creator's _id as a string.
 */
export async function createTenant(dto: CreateTenantDto, actorId: string): Promise<TenantPublic> {
  // 1. Slug uniqueness check — provides a clear 409 before attempting an insert
  //    that would fail with a duplicate-key MongoDB error (code 11000), which
  //    is harder to map to a user-friendly message.
  const existing = await Tenant.findOne({ slug: dto.slug }).lean().exec();
  if (existing) {
    throw new ConflictError(`Slug "${dto.slug}" is already taken`);
  }

  const ownerObjectId = new Types.ObjectId(actorId);

  // 2. Persist the tenant. The schema lowercases and trims slug before storage.
  const tenant = await Tenant.create({
    name: dto.name,
    slug: dto.slug,
    ownerId: ownerObjectId,
  });

  // 3. Grant the creator an 'owner' membership in this tenant.
  //    The ownerId field on Tenant is denormalised for ownership queries;
  //    Membership is the authoritative source for access control.
  await Membership.create({
    tenantId: tenant._id,
    userId: ownerObjectId,
    role: 'owner',
    // joinedAt defaults to new Date() in the schema; passing it explicitly
    // makes the intent clear and keeps the audit log timestamp consistent.
    joinedAt: new Date(),
  });

  // 4. Placeholder audit log — Phase 9 will replace this with a DB-persisted
  //    AuditLog entry via auditService.log({ tenantId, actorId, action }).
  logger.info(
    { tenantId: tenant._id.toString(), actorId, action: 'tenant.create' },
    'Tenant created',
  );

  return toPublic(
    tenant.toObject() as ITenant & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date },
  );
}

// ── listTenants ───────────────────────────────────────────────────────────────
/**
 * Returns all tenants where the given user has a membership record.
 *
 * Uses a two-query approach (memberships → tenants) rather than a populate or
 * aggregation pipeline, so each step stays simple and independently testable:
 *   1. Fetch the user's membership records to collect tenantIds.
 *   2. Batch-fetch all tenant documents by those ids in one $in query.
 *
 * An empty array is returned (not an error) if the user has no memberships yet.
 *
 * @param userId  The `sub` claim from the JWT — the user's _id as a string.
 */
export async function listTenants(userId: string): Promise<TenantPublic[]> {
  // 1. Find all tenantIds the user belongs to.
  //    Projecting only 'tenantId' keeps the payload minimal — we discard the
  //    rest of the membership document.
  const memberships = await Membership.find({ userId: new Types.ObjectId(userId) })
    .select('tenantId')
    .lean()
    .exec();

  if (memberships.length === 0) {
    return [];
  }

  // 2. Batch-fetch all matching tenants. Using $in avoids N+1 queries.
  const tenantIds = memberships.map((m) => m.tenantId);
  const tenants = await Tenant.find({ _id: { $in: tenantIds } })
    .lean()
    .exec();

  return tenants.map((t) =>
    toPublic(t as ITenant & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date }),
  );
}

// ── getTenantById ─────────────────────────────────────────────────────────────
/**
 * Returns a single tenant by its ObjectId, scoped to the requesting user.
 *
 * Membership is validated before fetching the tenant. If the user is not a
 * member, 404 is thrown rather than 403 — this avoids leaking whether the
 * tenant ID exists at all to callers who have no access to it.
 *
 * @param tenantId  The tenant's MongoDB ObjectId string (from a URL parameter).
 * @param userId    The `sub` claim from the JWT — the user's _id as a string.
 */
export async function getTenantById(tenantId: string, userId: string): Promise<TenantPublic> {
  const tenantObjectId = new Types.ObjectId(tenantId);

  // Membership check — user must belong to this tenant to see its details.
  const membership = await Membership.findOne({
    tenantId: tenantObjectId,
    userId: new Types.ObjectId(userId),
  })
    .lean()
    .exec();

  if (!membership) {
    // 404 not 403: avoids disclosing whether the tenant exists to non-members.
    throw new NotFoundError('Tenant not found');
  }

  const tenant = await Tenant.findById(tenantObjectId).lean().exec();

  if (!tenant) {
    // Membership exists but the tenant was deleted — data inconsistency guard.
    throw new NotFoundError('Tenant not found');
  }

  return toPublic(tenant as ITenant & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date });
}
