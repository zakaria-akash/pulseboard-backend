/**
 * src/modules/check/check.model.ts — Check Mongoose Model
 *
 * A Check is a single HTTP endpoint that PulseBoard monitors on a schedule.
 * Every check belongs to a tenant and contains enough configuration for the
 * probe engine (Phase 7 scheduler) to send an HTTP request and evaluate its
 * result against the operator's SLA expectations.
 *
 * ── Key design decisions ──────────────────────────────────────────────────────
 *
 *  lastResult — denormalised most-recent probe snapshot
 *    Rather than keeping a full probe history here (unbounded growth), we store
 *    only the most recent probe outcome as a nested subdocument. Full timeseries
 *    data lives in a separate metrics collection (Phase 10). `lastResult` drives
 *    real-time status badges in the UI without an additional query.
 *
 *  expectedStatus (default 200) + maxLatencyMs
 *    A probe is "ok" only when BOTH conditions hold:
 *      statusCode === expectedStatus  AND  latencyMs <= maxLatencyMs
 *    This lets operators monitor APIs that intentionally return non-200 codes
 *    (e.g. 204 No Content, 301 Redirect) and enforce SLA latency budgets.
 *
 *  enabled (default true)
 *    Soft on/off switch. The scheduler skips disabled checks without deleting
 *    them, preserving configuration and history for easy re-enabling.
 *
 *  timestamps: true
 *    Mongoose manages `createdAt` and `updatedAt` automatically.
 *
 * ── Indexes ────────────────────────────────────────────────────────────────────
 *   { tenantId: 1, createdAt: -1 } — tenant-scoped paginated list, newest first.
 *     Covers the primary GET /checks query pattern.
 *   { name: 'text' } — full-text search on name, powers the ?q= parameter.
 *     MongoDB allows only one text index per collection; add more fields to this
 *     index rather than creating a second one if needed in the future.
 */

import { Schema, model, type Types } from 'mongoose';

// ── Subdocument interface ──────────────────────────────────────────────────────
/**
 * Snapshot of the most recent HTTP probe outcome for a check.
 * Stored inline so the check document carries its own status without a join.
 */
export interface ILastResult {
  /** HTTP status code returned by the probe response (0 on network error). */
  status: number;
  /** Round-trip probe time in milliseconds. */
  latencyMs: number;
  /** Timestamp of when this particular probe ran. */
  checkedAt: Date;
  /** true iff status === expectedStatus AND latencyMs <= maxLatencyMs. */
  ok: boolean;
}

// ── Document interface ─────────────────────────────────────────────────────────
/**
 * Shape of a Check document as stored in MongoDB.
 * `createdAt` and `updatedAt` are optional because Mongoose's `timestamps: true`
 * manages them — they are absent before the first save but always present after.
 */
export interface ICheck {
  tenantId: Types.ObjectId;
  name: string;
  url: string;
  /** HTTP status code the probe must receive to pass. Defaults to 200. */
  expectedStatus: number;
  /** Maximum acceptable round-trip time in ms. A probe that takes longer fails. */
  maxLatencyMs: number;
  /** When false the scheduler skips this check (soft disable). */
  enabled: boolean;
  /** Most recent probe outcome. Absent until the first probe has completed. */
  lastResult?: ILastResult;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Public-safe check shape returned by service functions and API endpoints.
 * All check fields are safe to expose — there is no sensitive data to exclude.
 */
export interface CheckPublic {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  name: string;
  url: string;
  expectedStatus: number;
  maxLatencyMs: number;
  enabled: boolean;
  lastResult?: ILastResult;
  createdAt: Date;
  updatedAt: Date;
}

// ── Subdocument schema ────────────────────────────────────────────────────────
// `_id: false` suppresses the automatic ObjectId on the nested document —
// lastResult has no identity of its own beyond being part of its parent check.
const LastResultSchema = new Schema<ILastResult>(
  {
    status: { type: Number, required: true },
    latencyMs: { type: Number, required: true },
    checkedAt: { type: Date, required: true },
    ok: { type: Boolean, required: true },
  },
  { _id: false },
);

// ── Schema ────────────────────────────────────────────────────────────────────
const CheckSchema = new Schema<ICheck>(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    url: {
      type: String,
      required: true,
      trim: true,
    },
    expectedStatus: {
      type: Number,
      required: true,
      default: 200,
      min: 100, // 1xx is the lowest valid HTTP status class
      max: 599, // 5xx is the highest valid HTTP status class
    },
    maxLatencyMs: {
      type: Number,
      required: true,
      min: 100, // values below 100 ms are unrealistic for networked probes
    },
    enabled: {
      type: Boolean,
      required: true,
      default: true,
    },
    lastResult: {
      // Optional nested document. `default: undefined` prevents Mongoose from
      // initialising it to an empty object `{}` before the first probe runs.
      type: LastResultSchema,
      default: undefined,
    },
  },
  {
    timestamps: true,
  },
);

// ── Indexes ───────────────────────────────────────────────────────────────────
// Compound index for tenant-scoped paginated listing, newest checks first.
CheckSchema.index({ tenantId: 1, createdAt: -1 });

// Text index on name for full-text search via the ?q= query parameter.
CheckSchema.index({ name: 'text' });

// ── Model ─────────────────────────────────────────────────────────────────────
export const Check = model<ICheck>('Check', CheckSchema);
