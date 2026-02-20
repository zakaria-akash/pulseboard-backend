/**
 * src/common/paginate.ts — Pagination Query Parser
 *
 * Parses `?page=` and `?limit=` query parameters into the three values every
 * Mongoose paginated query needs: the validated `page` and `limit` numbers,
 * and the computed `skip` offset.
 *
 * ── Why centralise this? ──────────────────────────────────────────────────────
 *   Every list endpoint (checks, incidents, audit, usage) needs the same
 *   defensive parsing: coerce strings to numbers, reject negative values,
 *   and cap the page size to prevent accidental full-table scans. Doing this
 *   in one place means the cap and defaults are consistent across all routes.
 *
 * ── Bounds ────────────────────────────────────────────────────────────────────
 *   - Page is always ≥ 1. A `?page=0` or `?page=-5` request silently resets
 *     to page 1 rather than throwing an error — callers typically don't need
 *     to distinguish "invalid page" from "first page".
 *   - Limit is clamped to [1, MAX_LIMIT]. Requesting `?limit=99999` returns
 *     at most MAX_LIMIT documents, protecting the server from runaway queries.
 *   - Non-numeric values (e.g. `?page=abc`) fall back to the defaults because
 *     `parseInt('abc', 10)` returns `NaN`, and `NaN || DEFAULT` evaluates to
 *     the default.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   // In a controller or repo:
 *   const { page, limit, skip } = parsePagination(req.query);
 *   const items = await Model.find(filter).skip(skip).limit(limit).lean();
 *   const total = await Model.countDocuments(filter);
 *   sendPaginated(res, items, total, page, limit);
 */

/** Shape returned by `parsePagination`. All three fields are always present. */
export interface PaginationResult {
  /** Current page number, 1-based. */
  page: number;
  /** Number of documents per page, clamped to [1, MAX_LIMIT]. */
  limit: number;
  /** MongoDB `.skip()` offset, computed as `(page - 1) * limit`. */
  skip: number;
}

/** Page number used when the query param is absent or invalid. */
const DEFAULT_PAGE = 1;

/** Documents per page used when the query param is absent or invalid. */
const DEFAULT_LIMIT = 20;

/**
 * Hard upper bound on the `limit` parameter.
 * Prevents a single request from returning thousands of documents, which
 * would stress both the DB and the client's memory.
 */
const MAX_LIMIT = 100;

/**
 * Parses `page` and `limit` from an Express `req.query` object (or any
 * `Record<string, unknown>`) and returns the three values needed for
 * Mongoose pagination.
 *
 * All inputs are treated defensively:
 * - Missing → falls back to defaults.
 * - Non-numeric → falls back to defaults.
 * - Out-of-range → clamped to valid bounds.
 *
 * @param query  Typically `req.query`. Values are converted via `String()`
 *               before `parseInt` so the function works regardless of whether
 *               express has already coerced them.
 */
export function parsePagination(query: Record<string, unknown>): PaginationResult {
  // `parseInt(...) || DEFAULT` handles both NaN (non-numeric strings) and 0.
  const page = Math.max(1, parseInt(String(query.page ?? DEFAULT_PAGE), 10) || DEFAULT_PAGE);

  const rawLimit = parseInt(String(query.limit ?? DEFAULT_LIMIT), 10) || DEFAULT_LIMIT;
  // Clamp: at least 1 (never zero docs), at most MAX_LIMIT (no full-table scan).
  const limit = Math.min(Math.max(1, rawLimit), MAX_LIMIT);

  // Mongoose's `.skip()` offset: page 1 → skip 0, page 2 → skip limit, etc.
  const skip = (page - 1) * limit;

  return { page, limit, skip };
}
