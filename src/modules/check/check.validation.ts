/**
 * src/modules/check/check.validation.ts — Check Request Schemas
 *
 * Zod schemas for all check API request payloads and query parameters.
 * The validate() middleware calls `.strict()` before parsing, rejecting any
 * extra fields the client sends.
 *
 * ── Schema hierarchy ──────────────────────────────────────────────────────────
 *
 *  CreateCheckSchema   — full set of required + optional fields for creation
 *  UpdateCheckSchema   — every field from CreateCheckSchema made optional
 *  ListChecksQuerySchema — validated GET query parameters for the list endpoint
 *
 * ── Coercion for query parameters ─────────────────────────────────────────────
 *   Express delivers all query-string values as strings. `z.coerce.number()`
 *   converts them to numbers before validation, mirroring the behaviour of
 *   parsePagination() in common/paginate.ts.
 *
 * ── Sort string format ────────────────────────────────────────────────────────
 *   A leading `-` means descending: '-createdAt' sorts newest first.
 *   No prefix means ascending: 'name' sorts A→Z.
 */

import { z } from 'zod';

// ── CreateCheckSchema ─────────────────────────────────────────────────────────
/**
 * Validates the body of POST /checks.
 *
 * Fields:
 *   - name:           Human-readable label (1–100 chars).
 *   - url:            Fully-qualified HTTP/HTTPS URL to probe.
 *   - expectedStatus: HTTP status code the probe must receive (100–599, default 200).
 *   - maxLatencyMs:   Round-trip SLA in ms; probe fails if exceeded (100–30 000).
 *   - enabled:        Whether the scheduler should probe this check (default true).
 */
export const CreateCheckSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name must be 100 characters or fewer')
    .trim(),
  url: z.string().url('Must be a valid URL'),
  expectedStatus: z.number().int().min(100).max(599).default(200),
  maxLatencyMs: z
    .number()
    .int()
    .min(100, 'maxLatencyMs must be at least 100 ms')
    .max(30_000, 'maxLatencyMs must be 30 000 ms or fewer'),
  enabled: z.boolean().default(true),
});

// ── UpdateCheckSchema ─────────────────────────────────────────────────────────
/**
 * Validates the body of PATCH /checks/:id.
 * Every field is optional — clients send only the fields they want to change.
 */
export const UpdateCheckSchema = CreateCheckSchema.partial();

// ── ListChecksQuerySchema ─────────────────────────────────────────────────────
/**
 * Validates the query string of GET /checks.
 *
 * Parameters:
 *   - page:   Page number, 1-based (default 1).
 *   - limit:  Documents per page, max 100 (default 20 via parsePagination).
 *   - q:      Full-text search against the check name.
 *   - status: Filter to only enabled or only disabled checks.
 *   - sort:   Sort order — one of 'createdAt', '-createdAt', 'name', '-name'.
 *             A leading `-` means descending. Defaults to '-createdAt' (newest first).
 */
export const ListChecksQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  q: z.string().min(1).optional(),
  status: z.enum(['enabled', 'disabled']).optional(),
  sort: z.enum(['createdAt', '-createdAt', 'name', '-name']).optional(),
});

// ── Derived TypeScript types ──────────────────────────────────────────────────
export type CreateCheckDto = z.infer<typeof CreateCheckSchema>;
export type UpdateCheckDto = z.infer<typeof UpdateCheckSchema>;
export type ListChecksQueryDto = z.infer<typeof ListChecksQuerySchema>;
