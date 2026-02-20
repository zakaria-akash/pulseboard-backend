/**
 * src/modules/auth/auth.validation.ts — Auth Zod Schemas
 *
 * Defines the request body schemas for the two auth endpoints that accept
 * input: login and register. These schemas are consumed by the `validate()`
 * middleware factory (common/middleware/validate.ts) which calls `.strict()`
 * on them — any unknown fields in the request body will be rejected with a
 * 400 Validation Error.
 *
 * ── Why Zod here (not just Mongoose validation)? ─────────────────────────────
 *   Mongoose validators run at the DB layer and throw after the network round-
 *   trip to MongoDB has started. Zod validates at the HTTP boundary — before
 *   any business logic or DB call — so invalid payloads are rejected cheaply
 *   and the error message format is consistent with all other validation errors.
 *
 * ── Schema relationships ──────────────────────────────────────────────────────
 *   RegisterSchema extends LoginSchema via `.extend()` rather than duplicating
 *   the email/password rules. Both schemas always share the same email format
 *   check and minimum password length.
 *
 * ── Exported DTO types ────────────────────────────────────────────────────────
 *   `LoginDto` and `RegisterDto` are inferred from their schemas so the
 *   TypeScript types and the runtime validation rules can never drift apart.
 *   Import these types in auth.service.ts and auth.controller.ts instead of
 *   redefining the shapes manually.
 */

import { z } from 'zod';

/**
 * Schema for POST /api/v1/auth/login
 *
 * Fields:
 *  - email    : must be a valid RFC-5322 email address (Zod normalises the check)
 *  - password : raw plaintext, min 8 chars — the service compares against the hash
 */
export const LoginSchema = z.object({
  email: z.string().email('Must be a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

/**
 * Schema for POST /api/v1/auth/register
 *
 * Extends LoginSchema with two additional required fields:
 *  - name     : display name, min 1 char (not stored on the user document in
 *               Phase 4 — reserved for a future profile field)
 *  - tenantId : MongoDB ObjectId string of the tenant the user is joining.
 *               The tenant must exist; validated at runtime by auth.service.ts.
 */
export const RegisterSchema = LoginSchema.extend({
  name: z.string().min(1, 'Name is required'),
  tenantId: z.string().min(1, 'Tenant ID is required'),
});

// ── Inferred DTO types ────────────────────────────────────────────────────────

/** Typed payload for the login service function. */
export type LoginDto = z.infer<typeof LoginSchema>;

/** Typed payload for the register service function. */
export type RegisterDto = z.infer<typeof RegisterSchema>;
