/**
 * src/modules/tenant/membership.model.ts — Membership Join Model
 *
 * Records which users belong to which tenants and at what role level. Acts as
 * the join table between User and Tenant, enabling:
 *   - A user to belong to multiple tenants (multi-brand / multi-org support).
 *   - Per-tenant role assignment — the same user can be 'admin' in one tenant
 *     and 'viewer' in another, independently of their global user role.
 *
 * ── Key design decisions ──────────────────────────────────────────────────────
 *
 *  Compound unique index { tenantId: 1, userId: 1 }
 *    Prevents a user from being added to the same tenant twice. On a duplicate
 *    insert, MongoDB throws a duplicate-key error (code 11000), which the
 *    service layer catches and converts to a 409 ConflictError.
 *
 *  role — same values as the Role type in authGuard.ts
 *    Stored as a string enum. The four values (owner/admin/operator/viewer)
 *    are declared separately here (ROLES constant) rather than imported from
 *    authGuard.ts to avoid a layering violation (the model layer should not
 *    depend on middleware). The type is imported as a type-only import so
 *    TypeScript can enforce the value set without creating a runtime dependency.
 *    The values must stay in sync with the Role type in authGuard.ts.
 *
 *  joinedAt — explicit domain timestamp
 *    Stored as a dedicated field rather than relying on Mongoose's `timestamps`
 *    option. It has specific domain meaning: the exact moment the user joined
 *    the tenant. Using a dedicated field keeps the intent clear and avoids
 *    confusion with generic Mongoose `createdAt`/`updatedAt` fields.
 *
 * ── Indexes ────────────────────────────────────────────────────────────────────
 *   { tenantId: 1, userId: 1, unique: true } — primary compound index.
 *     Powers "find this user's membership in this tenant" lookups and enforces
 *     the one-membership-per-tenant-per-user invariant.
 *   { userId: 1 } — secondary index powering listTenants(userId) in the service,
 *     which fetches all tenantIds for a given user in one query.
 */

import { Schema, model, type Types } from 'mongoose';
import type { Role } from '../../common/middleware/authGuard';

// ── Valid role values ─────────────────────────────────────────────────────────
// Duplicated from authGuard.ts to keep the model layer free of middleware
// imports. Must stay in sync with the Role type in authGuard.ts.
const ROLES: Role[] = ['owner', 'admin', 'operator', 'viewer'];

// ── Document interface ─────────────────────────────────────────────────────────
/**
 * Shape of a Membership document as stored in MongoDB.
 * No optional fields — all are required on creation.
 */
export interface IMembership {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  role: Role;
  joinedAt: Date;
}

// ── Schema ────────────────────────────────────────────────────────────────────
const MembershipSchema = new Schema<IMembership>({
  tenantId: {
    type: Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
  },
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  role: {
    type: String,
    enum: ROLES,
    required: true,
  },
  joinedAt: {
    type: Date,
    required: true,
    // Default to the current time so callers can omit it and get "now".
    default: () => new Date(),
  },
});

// ── Indexes ───────────────────────────────────────────────────────────────────
// Primary: one membership per user per tenant (unique constraint) + fast lookup
// of a specific user's membership within a specific tenant.
MembershipSchema.index({ tenantId: 1, userId: 1 }, { unique: true });

// Secondary: powers the "fetch all tenantIds for a user" query in listTenants.
MembershipSchema.index({ userId: 1 });

// ── Model ─────────────────────────────────────────────────────────────────────
export const Membership = model<IMembership>('Membership', MembershipSchema);
