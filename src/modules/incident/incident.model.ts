/**
 * src/modules/incident/incident.model.ts — Incident Model
 *
 * An incident is automatically created when a check probe transitions from
 * passing to failing (via the scheduler → incident service bridge). It is
 * resolved when the probe recovers.
 *
 * ── Status machine ────────────────────────────────────────────────────────────
 *
 *   open ──► monitoring ──► resolved
 *     └──────────────────► resolved   (direct: auto-resolve path)
 *
 *   No backward transitions are permitted. 'resolved' is terminal.
 *
 * ── Notes ─────────────────────────────────────────────────────────────────────
 *   Notes are operator/admin annotations appended via PATCH /incidents/:id.
 *   Each note records who wrote it (`by`), when (`at`), and the free-text
 *   content (`text`). Notes are never deleted or edited once written.
 *
 * ── Indexes ───────────────────────────────────────────────────────────────────
 *   { tenantId: 1, lastChangeAt: -1 }  — default list sort for a tenant
 *   { checkId: 1 }                     — deduplication lookup in openIncident
 *   { tenantId: 1, status: 1 }         — filter by status within a tenant
 */

import { Schema, model, type Types } from 'mongoose';

// ── Interfaces ────────────────────────────────────────────────────────────────

/** The three lifecycle states of an incident. */
export type IncidentStatus = 'open' | 'monitoring' | 'resolved';

/** A single operator annotation on an incident. */
export interface INote {
  /** ObjectId of the user who added the note. */
  by: Types.ObjectId;
  /** When the note was added. */
  at: Date;
  /** Free-text content. */
  text: string;
}

/** Raw Mongoose document shape (as stored in MongoDB). */
export interface IIncident {
  tenantId: Types.ObjectId;
  /** Reference to the Check that triggered this incident. */
  checkId: Types.ObjectId;
  status: IncidentStatus;
  /** When the incident was first opened (probe first failed). */
  openedAt: Date;
  /** When the incident was resolved (probe recovered). Absent if still open. */
  resolvedAt?: Date;
  /** Timestamp of the most recent status change or note; used for list sort. */
  lastChangeAt: Date;
  /** Ordered list of operator annotations, newest appended last. */
  notes: INote[];
}

/** Public (serialised) shape — ObjectIds converted to strings. */
export interface IncidentPublic {
  _id: string;
  tenantId: string;
  checkId: string;
  status: IncidentStatus;
  openedAt: Date;
  resolvedAt?: Date;
  lastChangeAt: Date;
  notes: { by: string; at: Date; text: string }[];
  createdAt: Date;
  updatedAt: Date;
}

// ── Sub-schema ────────────────────────────────────────────────────────────────

const NoteSchema = new Schema<INote>(
  {
    by: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    at: { type: Date, required: true },
    text: { type: String, required: true, trim: true },
  },
  { _id: false }, // notes are value objects — no need for a separate ObjectId
);

// ── Schema ────────────────────────────────────────────────────────────────────

const IncidentSchema = new Schema<IIncident>(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, ref: 'Tenant' },
    checkId: { type: Schema.Types.ObjectId, required: true, ref: 'Check' },
    status: {
      type: String,
      enum: ['open', 'monitoring', 'resolved'] satisfies IncidentStatus[],
      required: true,
      default: 'open',
    },
    openedAt: { type: Date, required: true },
    resolvedAt: { type: Date },
    lastChangeAt: { type: Date, required: true },
    notes: { type: [NoteSchema], default: [] },
  },
  {
    timestamps: true, // adds createdAt + updatedAt
    versionKey: false,
  },
);

// Default sort: newest change first per tenant.
IncidentSchema.index({ tenantId: 1, lastChangeAt: -1 });

// Deduplication: find the open incident for a given check efficiently.
IncidentSchema.index({ checkId: 1 });

// Status filter within a tenant.
IncidentSchema.index({ tenantId: 1, status: 1 });

// ── Model ─────────────────────────────────────────────────────────────────────

export const Incident = model<IIncident>('Incident', IncidentSchema);
