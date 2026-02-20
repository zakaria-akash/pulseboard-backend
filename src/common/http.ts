/**
 * src/common/http.ts — Response Envelope Helpers
 *
 * Provides three thin wrappers around `res.json()` that enforce a consistent
 * response shape across every endpoint in the application. All API responses —
 * success, paginated list, or error — share the same top-level envelope so
 * clients can handle them generically.
 *
 * ── Response shapes ───────────────────────────────────────────────────────────
 *
 *  Success (single resource or action result):
 *    { "data": <payload> }
 *
 *  Paginated list:
 *    { "data": { "items": [...], "total": 42, "page": 1, "limit": 20, "pages": 3 } }
 *
 *  Error (also see errorHandler.ts for the automatic path):
 *    { "error": { "code": "NOT_FOUND", "message": "...", "details": [...] } }
 *
 * ── Why not use these in the error handler? ───────────────────────────────────
 *   `sendError` exists for controllers that catch their own errors and want to
 *   respond inline (rare). Most errors bubble up through `next(err)` and are
 *   handled centrally by `errorHandler.ts`, which builds the same envelope
 *   directly. Both paths produce the identical JSON shape.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   sendSuccess(res, { id: '123', name: 'Acme' }, 201);
 *   sendPaginated(res, checks, total, page, limit);
 *   sendError(res, new NotFoundError('Check not found'));
 */

import type { Response } from 'express';
import { AppError, ErrorCode } from './errors';

/**
 * Sends a successful JSON response wrapped in `{ data: ... }`.
 *
 * @param res        Express response object.
 * @param data       Payload to nest under the `data` key. Can be any JSON value.
 * @param statusCode HTTP status code — defaults to 200. Pass 201 for creation.
 */
export function sendSuccess<T>(res: Response, data: T, statusCode = 200): void {
  res.status(statusCode).json({ data });
}

/**
 * Sends a paginated list response with cursor metadata.
 *
 * The `pages` field is derived — always `Math.ceil(total / limit)` — so
 * clients can render page navigation without doing the math themselves.
 *
 * @param res    Express response object.
 * @param items  The current page's array of documents.
 * @param total  Total number of matching documents across all pages.
 * @param page   The current page number (1-based).
 * @param limit  The page size used for this query.
 */
export function sendPaginated<T>(
  res: Response,
  items: T[],
  total: number,
  page: number,
  limit: number,
): void {
  res.status(200).json({
    data: {
      items,
      total,
      page,
      limit,
      // Derived field: total number of pages given the current limit.
      // Using Math.ceil so a partial final page still counts as a page.
      pages: Math.ceil(total / limit),
    },
  });
}

/**
 * Sends an error JSON response wrapped in `{ error: { code, message, details? } }`.
 *
 * Prefer letting errors bubble to the global `errorHandler` via `next(err)`.
 * Use this function when a controller needs to handle an error inline and
 * respond immediately without re-throwing.
 *
 * Unknown errors (not an `AppError` instance) are treated as 500 Internal
 * Server Error — the original error is swallowed to avoid leaking internals.
 * For proper logging of unknown errors, use `next(err)` so `errorHandler`
 * can log with the request context.
 *
 * @param res   Express response object.
 * @param error The error to serialise. `AppError` subclasses are used as-is;
 *              everything else maps to a generic 500.
 */
export function sendError(res: Response, error: unknown): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        // Only include `details` when present — keeps the payload lean for
        // errors that have no structured context (e.g. NotFoundError).
        ...(error.details !== undefined && { details: error.details }),
      },
    });
  } else {
    // Never expose raw error messages from unknown exceptions — they may
    // contain stack traces, file paths, or DB credentials.
    res.status(500).json({
      error: {
        code: ErrorCode.INTERNAL,
        message: 'Internal server error',
      },
    });
  }
}
