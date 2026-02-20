/**
 * src/common/middleware/rateLimit.ts — Rate Limiters
 *
 * Exports three `express-rate-limit` instances with different thresholds
 * tuned for the traffic patterns of each route group. All limiters use a
 * fixed 1-minute sliding window and key requests by the client IP address.
 *
 * ── Limiter breakdown ────────────────────────────────────────────────────────
 *
 *  globalLimiter   — applied to every route in the app (mounted in app.ts)
 *    200 req/min   : generous enough for normal browser and API usage while
 *                    still preventing trivial DoS attacks and scraping.
 *
 *  authLimiter     — applied only to POST /api/v1/auth/login (and register)
 *    10 req/min    : tight limit to make credential-stuffing and brute-force
 *                    attacks impractical without locking out legitimate users
 *                    who mistype their password a few times.
 *
 *  usageLimiter    — applied only to POST /api/v1/usage/events
 *    60 req/min    : 1 event/second per IP is reasonable for an ingestion
 *                    endpoint; prevents accidental or intentional event floods
 *                    that would inflate billing or degrade query performance.
 *
 * ── Response headers ─────────────────────────────────────────────────────────
 *   `standardHeaders: true`  → sends the modern `RateLimit-*` headers defined
 *                               in the IETF draft (RateLimit-Limit,
 *                               RateLimit-Remaining, RateLimit-Reset).
 *   `legacyHeaders: false`   → suppresses the old `X-RateLimit-*` headers to
 *                               keep the response clean.
 *
 * ── Error envelope ────────────────────────────────────────────────────────────
 *   The `message` option is set to a JSON object matching the application's
 *   standard error envelope `{ error: { code, message } }` so that rate-limit
 *   rejections look identical to other API errors on the client side.
 *
 * ── Mounting ─────────────────────────────────────────────────────────────────
 *   // In app.ts:
 *   app.use(globalLimiter);                         // all routes
 *   app.use('/api/v1/auth', authLimiter, authRouter);
 *   app.use('/api/v1/usage', usageLimiter, usageRouter);
 */

import rateLimit from 'express-rate-limit';

/**
 * Default rate limiter applied globally to all routes.
 * 200 requests per IP per minute.
 */
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 200,
  standardHeaders: true, // Return `RateLimit-*` headers
  legacyHeaders: false, // Suppress `X-RateLimit-*` headers
  message: {
    error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests, please try again later' },
  },
});

/**
 * Strict rate limiter for authentication endpoints.
 * 10 requests per IP per minute — mitigates brute-force login attacks.
 */
export const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many authentication attempts, please try again later',
    },
  },
});

/**
 * Moderate rate limiter for the usage event ingestion endpoint.
 * 60 requests per IP per minute (~1 event/second).
 */
export const usageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests, please try again later' },
  },
});
