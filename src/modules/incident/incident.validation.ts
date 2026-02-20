/**
 * src/modules/incident/incident.validation.ts — Incident Zod Schemas
 *
 * Two schemas:
 *
 *  UpdateIncidentSchema  — body for PATCH /incidents/:id
 *    At least one of `status` or `note` must be provided; both may be supplied
 *    together (e.g. change status to 'monitoring' and append a note).
 *
 *  ListIncidentsQuerySchema — query string for GET /incidents
 *    All params are optional. `from` / `to` accept ISO-8601 strings and are
 *    coerced to Date objects by Zod.
 */

import { z } from 'zod';

// ── UpdateIncidentSchema ──────────────────────────────────────────────────────

// Note: no .refine() — the validate middleware requires AnyZodObject (not ZodEffects).
// The "at least one field" rule is enforced in incident.service.ts → updateIncident.
export const UpdateIncidentSchema = z.object({
  /**
   * New status for the incident. The service enforces the state-machine rules:
   *   open → monitoring | resolved
   *   monitoring → resolved
   *   resolved → (nothing — terminal state)
   */
  status: z.enum(['open', 'monitoring', 'resolved']).optional(),
  /** Operator annotation to append to the incident's notes array. */
  note: z
    .object({
      text: z.string().min(1, 'Note text must not be empty').max(2000),
    })
    .optional(),
});

// ── ListIncidentsQuerySchema ──────────────────────────────────────────────────

export const ListIncidentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  /** Filter by incident status. */
  status: z.enum(['open', 'monitoring', 'resolved']).optional(),
  /** ISO-8601 string — return incidents opened at or after this timestamp. */
  from: z.coerce.date().optional(),
  /** ISO-8601 string — return incidents opened at or before this timestamp. */
  to: z.coerce.date().optional(),
  /** ObjectId string — return only incidents for this check. */
  checkId: z.string().optional(),
  /** Sort field (prefix with '-' for descending). */
  sort: z.enum(['lastChangeAt', '-lastChangeAt', 'openedAt', '-openedAt']).optional(),
});

// ── Inferred types ────────────────────────────────────────────────────────────

export type UpdateIncidentDto = z.infer<typeof UpdateIncidentSchema>;
export type ListIncidentsQueryDto = z.infer<typeof ListIncidentsQuerySchema>;
