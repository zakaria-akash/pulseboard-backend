/**
 * src/modules/audit/audit.model.ts — Append-Only Audit Log
 *
 * Every mutation in PulseBoard (incident opened/resolved, check created, etc.)
 * writes one immutable row here. The log is tamper-evident because:
 *   - There is no `updateOne` / `findByIdAndUpdate` path in audit.service.ts.
 *   - `timestamps: false` prevents Mongoose from adding or modifying `updatedAt`.
 *   - `versionKey: false` drops the `__v` field (only meaningful for mutable docs).
 *
 * ── Why `ts` instead of `createdAt`? ─────────────────────────────────────────
 *   Using a custom `ts` field (typed as `Date`, indexed) is intentional:
 *   - It makes the "when did this happen?" semantics explicit.
 *   - `ts` is set by the application (`default: Date.now`) so it reflects the
 *     time the event occurred in business logic, not when MongoDB accepted the
 *     insert (which may differ under load).
 *
 * ── `actorId` nullable ────────────────────────────────────────────────────────
 *   System-generated events (e.g. the scheduler opening an incident) have no
 *   human actor. Setting `actorId: null` (rather than omitting the field) keeps
 *   the schema consistent and makes "system vs. human" queries straightforward.
 */

import { Schema, model, type Types } from 'mongoose';

// ── Interfaces ────────────────────────────────────────────────────────────────

/** Raw Mongoose document shape (as stored in MongoDB). */
export interface IAuditLog {
  tenantId: Types.ObjectId;
  /** ObjectId of the user who triggered the action; null for system events. */
  actorId: Types.ObjectId | null;
  /** Dot-separated action name, e.g. 'incident.open', 'check.create'. */
  action: string;
  /** MongoDB collection name for the affected document, e.g. 'incidents'. */
  targetCollection: string;
  /** ObjectId of the affected document. */
  targetId: Types.ObjectId;
  /** Arbitrary extra context — probe result, previous status, etc. */
  meta?: Record<string, unknown>;
  /** Timestamp of the event (application-set, not a Mongoose timestamp). */
  ts: Date;
}

/** Public (serialised) shape — ObjectIds converted to strings. */
export interface AuditLogPublic {
  _id: string;
  tenantId: string;
  actorId: string | null;
  action: string;
  targetCollection: string;
  targetId: string;
  meta?: Record<string, unknown>;
  ts: Date;
}

// ── Schema ────────────────────────────────────────────────────────────────────

const AuditLogSchema = new Schema<IAuditLog>(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, ref: 'Tenant' },
    // null is the explicit value for system-generated entries.
    actorId: { type: Schema.Types.ObjectId, default: null, ref: 'User' },
    action: { type: String, required: true, trim: true },
    targetCollection: { type: String, required: true, trim: true },
    targetId: { type: Schema.Types.ObjectId, required: true },
    // Mixed allows any JSON-serialisable shape without a fixed sub-schema.
    meta: { type: Schema.Types.Mixed },
    ts: { type: Date, default: Date.now },
  },
  {
    // Append-only — never updated after insert.
    timestamps: false,
    versionKey: false,
  },
);

// Primary query: list audit entries for a tenant, newest first.
AuditLogSchema.index({ tenantId: 1, ts: -1 });

// ── Model ─────────────────────────────────────────────────────────────────────

export const AuditLog = model<IAuditLog>('AuditLog', AuditLogSchema);
