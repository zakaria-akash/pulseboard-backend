/**
 * src/common/middleware/errorHandler.ts — Global Express Error Handler
 *
 * A 4-argument Express error-handling middleware that is the single exit point
 * for all errors in the application. Every `next(err)` call, every unhandled
 * promise rejection forwarded by async wrappers, and every thrown error from
 * middleware ends up here.
 *
 * ── Error classification ──────────────────────────────────────────────────────
 *
 *  1. `AppError` subclasses (ValidationError, NotFoundError, etc.)
 *     These are intentional, typed errors thrown by services and middleware.
 *     The status code, error code, and details are taken directly from the
 *     error object. 5xx AppErrors are also logged because they indicate an
 *     unexpected server-side condition.
 *
 *  2. `ZodError` (schema.parse() without safeParse)
 *     Should not reach here if the `validate` middleware is used correctly
 *     (it uses safeParse and wraps into ValidationError). Acts as a safety
 *     net in case Zod is called directly somewhere and throws.
 *
 *  3. `mongoose.Error.ValidationError`
 *     Mongoose's own schema-level validation errors (required fields, enum
 *     violations, etc.). Mapped to 400 so the client knows it's a bad request.
 *
 *  4. Anything else (unknown)
 *     Unrecognised errors — database driver errors, library bugs, programming
 *     mistakes. Always returns 500 with a generic message to avoid leaking
 *     internals. Always logged with the full error object for debugging.
 *
 * ── Why `requestId` in every log line? ───────────────────────────────────────
 *   Including `req.requestId` binds the log entry to the specific inbound
 *   request that caused the error. In a log aggregator (Loki, Datadog) you can
 *   filter by `requestId` to see the full request lifecycle: what middleware
 *   ran, what DB queries fired, and exactly where it failed.
 *
 * ── Why not log 4xx errors? ───────────────────────────────────────────────────
 *   Client errors (400–499) are expected in normal operation — bad input,
 *   expired tokens, missing resources. Logging every 400 would drown the error
 *   log in noise. 5xx errors are logged because they always warrant investigation.
 *
 * ── Mounting ──────────────────────────────────────────────────────────────────
 *   // In app.ts — MUST be the last middleware registered:
 *   app.use(errorHandler);
 *   // Express identifies a 4-argument function as an error handler.
 */

import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import mongoose from 'mongoose';
import { AppError, ValidationError, InternalError, ErrorCode } from '../errors';
import logger from '../../config/logger';

/**
 * Centralised Express error handler. Must be registered last in `app.ts`.
 *
 * The `_next` parameter is required by Express to recognise this as an error
 * handler (it looks for exactly 4 arguments). It is never called because once
 * an error handler responds, the chain is complete.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // Express requires the 4th argument to be present even if unused.
  _next: NextFunction,
): void {
  // ── Branch 1: Known application errors ─────────────────────────────────────
  if (err instanceof AppError) {
    // Log server errors (5xx) — these indicate something went wrong on our side.
    // Client errors (4xx) are not logged to keep the error log actionable.
    if (err.statusCode >= 500) {
      logger.error({ requestId: req.requestId, err }, err.message);
    }

    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        // Spread `details` only when present — avoids `"details": undefined`
        // appearing in the JSON (which would serialize as nothing anyway but
        // makes the intent explicit).
        ...(err.details !== undefined && { details: err.details }),
      },
    });
    return;
  }

  // ── Branch 2: Zod validation errors thrown without safeParse ───────────────
  // Safety net — validate.ts uses safeParse and wraps errors into ValidationError,
  // but raw Zod throws (e.g. schema.parse()) can still bubble up.
  if (err instanceof ZodError) {
    const validationError = new ValidationError('Validation failed', err.issues);
    res.status(400).json({
      error: {
        code: validationError.code,
        message: validationError.message,
        details: err.issues,
      },
    });
    return;
  }

  // ── Branch 3: Mongoose schema validation errors ─────────────────────────────
  // Occurs when a Mongoose document's built-in validators fail (e.g. `required`,
  // `enum`, custom validators). These are client-caused so they map to 400.
  if (err instanceof mongoose.Error.ValidationError) {
    res.status(400).json({
      error: {
        code: ErrorCode.VALIDATION,
        message: err.message,
      },
    });
    return;
  }

  // ── Branch 4: Catch-all for unknown errors ──────────────────────────────────
  // Anything that reaches here is unexpected — a bug, a library throwing
  // something we didn't anticipate, or a DB driver error.
  // Always log the full error and always respond with a generic 500 message
  // to avoid leaking stack traces, file paths, or connection strings.
  const internalError = new InternalError();
  logger.error({ requestId: req.requestId, err }, 'Unhandled error');
  res.status(500).json({
    error: {
      code: internalError.code,
      message: internalError.message,
    },
  });
}
