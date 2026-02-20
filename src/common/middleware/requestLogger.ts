/**
 * src/common/middleware/requestLogger.ts — Structured Request/Response Logger
 *
 * Logs a single structured line per request on response finish:
 *   { requestId, tenantId, method, url, statusCode, durationMs }
 *
 * ── p50 / p95 latency tracking ────────────────────────────────────────────────
 *   A fixed-size circular buffer (WINDOW_SIZE = 500) keeps the most recent
 *   response durations in memory. Every 60 s, p50 and p95 are derived from
 *   the current window and logged at INFO level. No external dependency is
 *   needed — the percentile is computed with a simple sort.
 *
 * ── Health-probe noise reduction ─────────────────────────────────────────────
 *   /healthz and /readyz are called frequently by orchestrators. Those paths
 *   are logged at DEBUG level (silent in production) rather than INFO so they
 *   don't drown the access log.
 *
 * ── Placement in app.ts ───────────────────────────────────────────────────────
 *   Register immediately after requestId so `req.requestId` is already set,
 *   and before route handlers so the `res.on('finish')` callback captures the
 *   total end-to-end duration including middleware and DB time.
 *
 *   app.use(requestId);
 *   app.use(requestLogger);  ← here
 *   app.use(helmet);
 *   ...
 */

import type { Request, Response, NextFunction } from 'express';
import logger from '../../config/logger';

// ── Latency percentile tracker ────────────────────────────────────────────────

/** Number of request durations to retain for percentile calculation. */
const WINDOW_SIZE = 500;

/**
 * Circular buffer storing the most recent response durations (ms).
 * Overwriting old values avoids unbounded memory growth.
 */
const durationBuffer: number[] = [];
let bufferHead = 0; // next write position

function recordDuration(ms: number): void {
  if (durationBuffer.length < WINDOW_SIZE) {
    durationBuffer.push(ms);
  } else {
    durationBuffer[bufferHead % WINDOW_SIZE] = ms;
    bufferHead++;
  }
}

/**
 * Returns the p-th percentile of the current duration window.
 * @param p  Percentile (0–100), e.g. 50 for p50, 95 for p95.
 */
function percentile(p: number): number {
  if (durationBuffer.length === 0) return 0;
  const sorted = [...durationBuffer].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[idx]);
}

/**
 * Emits p50 / p95 latency stats every 60 s.
 * `.unref()` ensures the interval does not keep the Node.js event loop alive
 * after all real work is done (important for clean process exit in tests).
 */
const statsInterval = setInterval(() => {
  if (durationBuffer.length === 0) return;
  logger.info(
    {
      p50Ms: percentile(50),
      p95Ms: percentile(95),
      sampleSize: durationBuffer.length,
    },
    '[latency] Request latency percentiles',
  );
}, 60_000);

statsInterval.unref();

// ── Paths that should be logged at DEBUG (not INFO) ───────────────────────────
const QUIET_PATHS = new Set(['/healthz', '/readyz']);

// ── Middleware ────────────────────────────────────────────────────────────────

/**
 * Express middleware that logs one structured line per request on response
 * finish and feeds the duration into the rolling percentile window.
 *
 * The `req.user` property may be undefined for unauthenticated routes
 * (health probes, 404s, login); we safely access it with optional chaining.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startMs = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - startMs;
    recordDuration(durationMs);

    const logLevel = QUIET_PATHS.has(req.path) ? 'debug' : 'info';

    logger[logLevel](
      {
        requestId: req.requestId,
        tenantId: req.user?.tenantId,
        method: req.method,
        url: req.originalUrl,
        statusCode: res.statusCode,
        durationMs,
      },
      `${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs}ms`,
    );
  });

  next();
}
