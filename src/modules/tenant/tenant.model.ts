/**
 * src/modules/tenant/tenant.model.ts — Tenant Mongoose Model
 *
 * A Tenant represents an isolated workspace — a company, brand, or team. Every
 * other resource (checks, incidents, memberships) is scoped to a tenant, making
 * `tenantId` the primary partition key across the entire data model.
 *
 * ── Key design decisions ──────────────────────────────────────────────────────
 *
 *  slug — URL-safe unique identifier
 *    Lowercase letters, digits, and hyphens only. Used in human-readable URLs
 *    (/t/my-company) and as a stable external identifier. The schema enforces
 *    lowercase + trim before storage; the Zod schema (tenant.validation.ts)
 *    validates the character set before data reaches Mongoose, giving the
 *    client a clear error message rather than a silent normalisation.
 *
 *  ownerId — ObjectId reference to User
 *    Denormalised field recording who created the tenant. Canonical access
 *    control uses the Membership join table (membership.model.ts); ownerId is
 *    preserved for ownership-transfer flows and fast "tenants I own" queries.
 *
 *  timestamps: true
 *    Mongoose automatically manages `createdAt` and `updatedAt`. They are
 *    declared as optional in `ITenant` because they are absent before the
 *    document is first saved; after any successful save they are always present.
 *
 * ── Indexes ────────────────────────────────────────────────────────────────────
 *   { slug: 1, unique: true } — enforces global slug uniqueness and enables
 *     fast lookup by slug. Created automatically by `unique: true` on the field.
 *   { ownerId: 1 } — supports future "list tenants I own" queries.
 *     Declared explicitly via schema.index() for discoverability.
 */

import { Schema, model, type Types } from 'mongoose';

// ── Document interface ─────────────────────────────────────────────────────────
/**
 * Shape of a Tenant document as stored in MongoDB.
 * `createdAt` and `updatedAt` are optional because they are managed by
 * Mongoose's `timestamps: true` option, not user-supplied fields. After any
 * successful save or create they will always be present.
 */
export interface ITenant {
  name: string;
  slug: string;
  ownerId: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Public-safe tenant shape returned by service functions and API endpoints.
 * Unlike UserPublic there is no sensitive field to exclude — all tenant fields
 * are safe to send to any member of the tenant.
 */
export interface TenantPublic {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  ownerId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

// ── Schema ────────────────────────────────────────────────────────────────────
const TenantSchema = new Schema<ITenant>(
  {
    name: {
      type: String,
      required: true,
      trim: true, // strip leading/trailing whitespace
    },
    slug: {
      type: String,
      required: true,
      unique: true, // creates { slug: 1, unique: true } index automatically
      lowercase: true, // normalise before storage — "My-Slug" → "my-slug"
      trim: true, // strip leading/trailing whitespace
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: 'User', // references the User model created in Phase 4
      required: true,
    },
  },
  {
    // Automatically adds `createdAt` and `updatedAt` Date fields managed by Mongoose.
    timestamps: true,
  },
);

// ── Explicit indexes ──────────────────────────────────────────────────────────
// { slug: 1 } is already created by `unique: true` on the field above.
// { ownerId: 1 } is added explicitly here for future "tenants by owner" queries.
TenantSchema.index({ ownerId: 1 });

// ── Model ─────────────────────────────────────────────────────────────────────
export const Tenant = model<ITenant>('Tenant', TenantSchema);
