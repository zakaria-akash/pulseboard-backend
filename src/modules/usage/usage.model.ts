/**
 * src/modules/usage/usage.model.ts — Usage Event Model
 *
 * Stores one immutable usage event per idempotency key. The unique index on
 * `idempotencyKey` is the primary deduplication mechanism: a duplicate insert
 * (same key) raises a MongoServerError with code 11000, which `usage.service`
 * catches and converts to an idempotent success by returning the original record.
 *
 * ── Why a unique index instead of an upsert? ──────────────────────────────────
 *   An insert + catch-on-11000 is intentionally different from `updateOne` with
 *   `upsert: true`. The upsert pattern would silently succeed on duplicates but
 *   would also allow the payload to be mutated on re-delivery. The insert pattern
 *   ensures the stored record is always the one from the first delivery — the
 *   canonical definition of idempotency.
 *
 * ── `idempotencyKey` format ───────────────────────────────────────────────────
 *   Clients generate a UUID v4 and send it in the `Idempotency-Key` header.
 *   The server stores it verbatim; no normalisation is applied. Clients must
 *   ensure they use the same key for retries of the same logical event.
 */

import { Schema, model, type Types } from 'mongoose';

// ── Interfaces ────────────────────────────────────────────────────────────────

/** Raw Mongoose document shape. */
export interface IUsageEvent {
  idempotencyKey: string;
  tenantId: Types.ObjectId;
  /** Event category, e.g. 'page_view', 'api_call', 'check_triggered'. */
  kind: string;
  /** Arbitrary event-specific data. */
  payload?: Record<string, unknown>;
  /** Timestamp of the event (application-set). */
  ts: Date;
}

/** Public (serialised) shape — ObjectIds converted to strings. */
export interface UsageEventPublic {
  _id: string;
  idempotencyKey: string;
  tenantId: string;
  kind: string;
  payload?: Record<string, unknown>;
  ts: Date;
}

// ── Schema ────────────────────────────────────────────────────────────────────

const UsageEventSchema = new Schema<IUsageEvent>(
  {
    // The deduplication key supplied by the client via the Idempotency-Key header.
    idempotencyKey: { type: String, required: true },
    tenantId: { type: Schema.Types.ObjectId, required: true, ref: 'Tenant' },
    kind: { type: String, required: true, trim: true },
    payload: { type: Schema.Types.Mixed },
    ts: { type: Date, default: Date.now },
  },
  {
    timestamps: false, // `ts` is the explicit event timestamp
    versionKey: false,
  },
);

// Primary deduplication guard — raises code 11000 on duplicate insert.
UsageEventSchema.index({ idempotencyKey: 1 }, { unique: true });

// ── Model ─────────────────────────────────────────────────────────────────────

export const UsageEvent = model<IUsageEvent>('UsageEvent', UsageEventSchema);
