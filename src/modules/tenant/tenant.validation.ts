/**
 * src/modules/tenant/tenant.validation.ts — Tenant Request Schemas
 *
 * Zod schemas for incoming tenant API requests. The validate() middleware
 * (src/common/middleware/validate.ts) calls `.strict()` on each schema before
 * parsing, rejecting any extra fields the client sends.
 *
 * ── Slug rules ────────────────────────────────────────────────────────────────
 *   Only lowercase letters, digits, and hyphens are allowed (`^[a-z0-9-]+$`).
 *   This makes slugs safe for use in URLs and DNS labels. The Mongoose schema
 *   also lowercases slugs at the DB layer, but we validate the format here
 *   first to give the client a clear, field-level error rather than a silent
 *   normalisation or an opaque duplicate-key DB error.
 */

import { z } from 'zod';

/**
 * Schema for creating a new tenant.
 *
 * Accepts:
 *   - name: human-readable display name (1–100 characters)
 *   - slug: URL-safe identifier; only lowercase letters, digits, and hyphens
 */
export const CreateTenantSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name must be 100 characters or fewer')
    .trim(),
  slug: z
    .string()
    .min(1, 'Slug is required')
    .max(50, 'Slug must be 50 characters or fewer')
    .regex(/^[a-z0-9-]+$/, 'Slug may only contain lowercase letters, digits, and hyphens')
    .trim(),
});

export type CreateTenantDto = z.infer<typeof CreateTenantSchema>;
