/**
 * src/config/logger.ts — Pino Logger Singleton
 *
 * Creates and exports a single shared `pino` logger instance used throughout
 * the entire application. Having one instance (rather than calling pino()
 * in every module) means:
 *
 *  - Log level changes at runtime affect all modules at once.
 *  - The pretty-print transport worker thread is only spawned once.
 *  - Child loggers created via `logger.child({ requestId })` all share the
 *    same underlying destination stream, so output stays ordered.
 *
 * ── Transport strategy ────────────────────────────────────────────────────
 *
 *  development / test  →  pino-pretty (human-readable, coloured output)
 *                          Runs in a separate worker thread so it doesn't
 *                          block the event loop; pino hands log lines to the
 *                          worker over a synchronous channel.
 *
 *  production          →  structured JSON to stdout (no pretty transport).
 *                          Log aggregators (Datadog, Loki, CloudWatch) ingest
 *                          the raw JSON. Minimising allocations keeps throughput
 *                          high under load.
 *
 * ── Usage ────────────────────────────────────────────────────────────────
 *   import logger from './config/logger.js';
 *
 *   logger.info('Server started');
 *   logger.error({ err }, 'Unhandled rejection');
 *
 *   // Per-request child logger (carries requestId on every line):
 *   const reqLogger = logger.child({ requestId: req.id });
 *   reqLogger.info({ userId }, 'User authenticated');
 */

import pino from 'pino';
import { env } from './env.js';

// ── Transport ──────────────────────────────────────────────────────────────
// pino-pretty is only used in non-production environments.
// In production we output raw JSON — no extra allocations, no worker thread.
const transport =
  env.NODE_ENV !== 'production'
    ? pino.transport({
        target: 'pino-pretty',
        options: {
          // Render timestamp as a human-readable local time string.
          translateTime: 'SYS:HH:MM:ss.l',
          // Include log level as a label (INFO, ERROR, …) rather than a number.
          colorize: true,
          // Suppress the pid and hostname fields in dev — noise reduction.
          ignore: 'pid,hostname',
          // Single-line output keeps the terminal clean.
          singleLine: false,
        },
      })
    : undefined;

// ── Logger instance ────────────────────────────────────────────────────────
const logger = pino(
  {
    // Map NODE_ENV → pino log level:
    //   development → 'debug'  (verbose; shows debug + info + warn + error + fatal)
    //   test        → 'silent' (no output during Jest runs — keeps test output clean)
    //   production  → 'info'   (skip debug noise; log info and above)
    level: env.NODE_ENV === 'production' ? 'info' : env.NODE_ENV === 'test' ? 'silent' : 'debug',

    // Pino's base object is merged into every log line.
    // We remove pid and hostname in non-prod via the pretty transport's `ignore`
    // option above; in production JSON we keep them for system-level debugging.
    base: env.NODE_ENV === 'production' ? { pid: process.pid } : undefined,

    // ISO-8601 timestamp on every log line — essential for log aggregators.
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  // The transport is undefined in production, so pino writes to stdout directly.
  transport,
);

export default logger;
