/**
 * src/common/errors.ts — Application Error Hierarchy
 *
 * Defines a typed, structured error hierarchy that flows through the entire
 * application. Every intentional failure (bad input, missing resource, auth
 * failure, etc.) should be expressed as one of these classes rather than a
 * raw `new Error(...)`, because they carry the HTTP status code and a
 * machine-readable `code` field that the error handler and API clients rely on.
 *
 * ── Design goals ─────────────────────────────────────────────────────────────
 *
 *  1. Single source of truth for HTTP status ↔ error code mapping.
 *     Controllers never hard-code `res.status(404)` — they throw `NotFoundError`
 *     and the global error handler resolves the status automatically.
 *
 *  2. Consistent JSON envelope on every error response:
 *       { "error": { "code": "NOT_FOUND", "message": "...", "details": [...] } }
 *     Clients can switch on `code` without parsing free-form message strings.
 *
 *  3. Optional `details` field for structured context (e.g. Zod issue array).
 *     Controllers can attach field-level validation failures so the client
 *     knows exactly which field(s) failed and why.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   // In a service:
 *   throw new NotFoundError(`Check ${id} not found`);
 *
 *   // In a Zod validate middleware:
 *   throw new ValidationError('Validation failed', zodResult.error.issues);
 *
 *   // Anywhere:
 *   throw new ForbiddenError(); // defaults to "Forbidden"
 *
 * ── Why extend Error and not just return plain objects? ───────────────────────
 *   Using real Error subclasses means:
 *   - `instanceof` checks work reliably in the error handler.
 *   - Stack traces are preserved (via `Error.captureStackTrace`).
 *   - `throw` semantics give us automatic unwinding — no need to check return
 *     values in every caller.
 */

/**
 * Machine-readable error codes sent in the JSON response envelope.
 * Using an enum (not raw strings) prevents typos across the codebase and makes
 * exhaustive switches possible in client code.
 */
export enum ErrorCode {
  VALIDATION = 'VALIDATION_ERROR',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  INTERNAL = 'INTERNAL_SERVER_ERROR',
}

/**
 * Base class for all intentional application errors.
 *
 * Extend this (not Error directly) whenever you need a domain-specific error
 * with a status code. The global error handler (`errorHandler.ts`) uses
 * `instanceof AppError` to distinguish expected failures from unexpected ones.
 *
 * @param message   Human-readable description, safe to expose in API responses.
 * @param statusCode HTTP status code to send to the client.
 * @param code      Machine-readable `ErrorCode` enum value.
 * @param details   Optional structured context (e.g. Zod issue array).
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(message: string, statusCode: number, code: ErrorCode, details?: unknown) {
    super(message);
    // Set `name` to the subclass name so stack traces read as "NotFoundError"
    // rather than the generic "Error".
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    // Removes the AppError constructor frames from the stack trace so the trace
    // points directly to the callsite that threw the error.
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * 400 Bad Request — the client sent data that failed schema validation.
 *
 * Pass the Zod `.issues` array as `details` so the client can show
 * per-field error messages without a second round-trip.
 *
 * @example
 *   throw new ValidationError('Validation failed', zodResult.error.issues);
 */
export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) {
    super(message, 400, ErrorCode.VALIDATION, details);
  }
}

/**
 * 401 Unauthorized — no valid credentials were provided.
 *
 * Thrown when a JWT is missing, malformed, expired, or has an invalid
 * signature. The client should redirect to the login page or prompt for
 * credentials.
 *
 * Note: "Unauthorized" is a misnomer in HTTP — it really means
 * "unauthenticated". Use `ForbiddenError` when the identity is known but
 * lacks permission.
 */
export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401, ErrorCode.UNAUTHORIZED);
  }
}

/**
 * 403 Forbidden — credentials are valid but the user lacks the required role.
 *
 * Thrown by `authGuard(minRole)` when the authenticated user's role sits
 * below the required minimum in the role hierarchy.
 */
export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403, ErrorCode.FORBIDDEN);
  }
}

/**
 * 404 Not Found — the requested resource does not exist (or is not visible
 * to the current tenant).
 *
 * For tenant-scoped resources, returning 404 instead of 403 on cross-tenant
 * access is intentional — it avoids leaking whether a resource exists at all.
 */
export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(message, 404, ErrorCode.NOT_FOUND);
  }
}

/**
 * 409 Conflict — the request could not be completed because it conflicts
 * with the current state of the resource (e.g. duplicate email on register,
 * duplicate slug on tenant creation).
 */
export class ConflictError extends AppError {
  constructor(message = 'Conflict') {
    super(message, 409, ErrorCode.CONFLICT);
  }
}

/**
 * 500 Internal Server Error — an unexpected condition was encountered.
 *
 * Only throw this explicitly when you catch a lower-level error and want to
 * re-wrap it. Most unknown errors are caught by the global error handler and
 * converted to this automatically.
 */
export class InternalError extends AppError {
  constructor(message = 'Internal server error') {
    super(message, 500, ErrorCode.INTERNAL);
  }
}
