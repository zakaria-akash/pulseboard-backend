/**
 * src/modules/auth/user.model.ts — User Mongoose Model
 *
 * Defines the shape of a user document in MongoDB and exports the compiled
 * Mongoose model. This is the only file that describes users at the DB level.
 *
 * ── Key design decisions ──────────────────────────────────────────────────────
 *
 *  hash field — `select: false`
 *    The bcrypt hash is NEVER returned by default queries. Any query that needs
 *    to compare a password must explicitly opt in with `.select('+hash')`.
 *    This prevents accidental password-hash exposure in list endpoints, logs,
 *    or JSON serialisation bugs. Hashing is done in auth.service.ts, not here,
 *    to keep the model thin (no pre-save hooks).
 *
 *  email — lowercase + trim at schema level
 *    Normalised before storage so that lookups are case-insensitive without
 *    requiring a case-insensitive collation on the index.
 *
 *  role — stored as a string enum
 *    The four roles (owner, admin, operator, viewer) match the hierarchy in
 *    authGuard.ts. Default is 'viewer' — the least privileged role — so new
 *    users get minimal access until explicitly elevated.
 *
 *  tenantId — required ObjectId reference to the Tenant collection
 *    Every user belongs to exactly one tenant. All repository queries must
 *    include `tenantId` to enforce data isolation.
 *
 *  timestamps: true
 *    Mongoose automatically manages `createdAt` and `updatedAt`. No need to
 *    declare them in the schema body — they are included in `IUser` as optional
 *    fields so that TypeScript knows they exist after creation.
 *
 * ── Indexes ────────────────────────────────────────────────────────────────────
 *   { email: 1, unique: true } — enforces global email uniqueness and enables
 *     fast login lookups by email. Set on the field definition so Mongoose
 *     creates it automatically.
 *   { tenantId: 1 } — speeds up "list users for tenant" queries in future
 *     phases. Declared explicitly via schema.index() to make it discoverable.
 *
 * ── No pre-save hook ──────────────────────────────────────────────────────────
 *   Per the WORKFLOW spec, password hashing is done in auth.service.ts before
 *   calling User.create(). This keeps the model as a pure data layer with no
 *   side-effects, making it easier to test services in isolation.
 */

import { Schema, model, type Types } from 'mongoose';
import type { Role } from '../../common/middleware/authGuard';

// ── Document interface ─────────────────────────────────────────────────────────
/**
 * Shape of a User document as stored in MongoDB.
 * `hash` is present in the interface so TypeScript knows the field exists,
 * but `select: false` in the schema ensures it is excluded from all default
 * queries. Use `.select('+hash')` only in auth.service.ts when comparing passwords.
 *
 * `createdAt` and `updatedAt` are optional because they are managed by Mongoose's
 * `timestamps: true` option rather than being user-supplied fields. After any
 * successful save or create they will always be present.
 */
export interface IUser {
  tenantId: Types.ObjectId;
  email: string;
  hash: string;
  role: Role;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Public-safe user shape returned by all service functions and API endpoints.
 * Excludes `hash` — the bcrypt password digest must never leave the server.
 */
export interface UserPublic {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  email: string;
  role: Role;
  createdAt: Date;
  updatedAt: Date;
}

// ── Valid role values ─────────────────────────────────────────────────────────
// Duplicated here from authGuard.ts so the schema enum doesn't import from
// middleware (which would create a layering violation). The values must stay
// in sync with the Role type in authGuard.ts.
const ROLES: Role[] = ['owner', 'admin', 'operator', 'viewer'];

// ── Schema ────────────────────────────────────────────────────────────────────
const UserSchema = new Schema<IUser>(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant', // resolved in Phase 5 when the Tenant model is created
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true, // creates { email: 1, unique: true } index automatically
      lowercase: true, // normalise before storage — "User@Example.com" → "user@example.com"
      trim: true, // strip leading/trailing whitespace
    },
    hash: {
      type: String,
      required: true,
      select: false, // NEVER returned by default — must opt in with .select('+hash')
    },
    role: {
      type: String,
      enum: ROLES,
      required: true,
      default: 'viewer', // least-privileged default; elevate explicitly
    },
  },
  {
    // Automatically adds `createdAt` and `updatedAt` Date fields managed by Mongoose.
    timestamps: true,
  },
);

// ── Explicit indexes ──────────────────────────────────────────────────────────
// { email: 1 } is already created by `unique: true` on the field above.
// { tenantId: 1 } is added explicitly here for future "users by tenant" queries.
UserSchema.index({ tenantId: 1 });

// ── Model ─────────────────────────────────────────────────────────────────────
export const User = model<IUser>('User', UserSchema);
