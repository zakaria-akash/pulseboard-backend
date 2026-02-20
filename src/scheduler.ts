/**
 * src/scheduler.ts — HTTP Probe Scheduler
 *
 * Loads all enabled checks from the database on startup and schedules a
 * recurring HTTP probe for each one. After every probe it updates the check's
 * `lastResult` in the DB, detects pass/fail state transitions, and publishes
 * events on the pub/sub bus so downstream subscribers (Phase 8 incident
 * service, Phase 11 WebSocket server) can react in real time.
 *
 * ── Lifecycle ─────────────────────────────────────────────────────────────────
 *
 *   startScheduler() → called once from server.ts after server.listen()
 *     1. Subscribes to 'checks:changed' so mutations from the REST API
 *        trigger an automatic reload.
 *     2. Runs the initial full load of enabled checks.
 *     3. Returns stopScheduler() — called in the graceful shutdown handler.
 *
 *   reloadChecks() → clears all timers, re-fetches enabled checks, re-schedules.
 *     Called on startup and whenever 'checks:changed' fires.
 *
 *   scheduleCheck(check) → starts a setInterval for one check with a random
 *     jitter delay (0–5 s) so all checks don't fire simultaneously on startup.
 *
 *   probeAndHandle(check) → runs runProbe() and calls handleProbeResult().
 *     Wrapped in try/catch so a single failing probe never crashes the loop.
 *
 *   handleProbeResult(check, result) → persists lastResult to the DB, updates
 *     the in-memory snapshot for the next state comparison, and emits pubsub
 *     events on state transitions (pass→fail / fail→pass). No event on same-state
 *     repeat to avoid thundering-herd incident creation.
 *
 * ── State transition logic ────────────────────────────────────────────────────
 *
 *   prevOk = check.lastResult?.ok  (undefined before the first probe)
 *
 *   prevOk !== false  &&  !newOk  → FAIL   (first fail OR pass→fail)
 *   prevOk === false  &&   newOk  → RECOVER (fail→pass)
 *   same state as before          → no event (deduplication)
 *
 * ── Events emitted on `incidents:{tenantId}` ─────────────────────────────────
 *
 *   { event: 'check:fail',    checkId, tenantId, result: ProbeResult }
 *   { event: 'check:recover', checkId, tenantId, result: ProbeResult }
 *
 * ── Jitter ────────────────────────────────────────────────────────────────────
 *   A random 0–5 000 ms delay is added before the first probe of each check.
 *   Without jitter, reloading 100 checks at once would send 100 HTTP requests
 *   simultaneously — a "thundering herd" that spikes outbound traffic and
 *   could trigger rate-limiting on monitored services.
 */

import { type Types } from 'mongoose';
import { Check, type ICheck, type ILastResult } from './modules/check/check.model';
import { runProbe, type ProbeResult } from './modules/check/check.service';
import { publish, subscribe, unsubscribe, type PubSubHandler } from './realtime/pubsub';
import { env } from './config/env';
import logger from './config/logger';

// ── Types ─────────────────────────────────────────────────────────────────────
/** A lean Check document enriched with its Mongoose _id. */
type CheckDoc = ICheck & { _id: Types.ObjectId };

// ── Module state ──────────────────────────────────────────────────────────────
// Maps check ObjectId string → the setInterval handle so we can clear timers
// individually on reload or collectively on shutdown.
const timers = new Map<string, NodeJS.Timeout>();

// ── DB helpers ────────────────────────────────────────────────────────────────
/**
 * Fetches all checks with enabled === true from the database.
 * Called on startup and on every 'checks:changed' event.
 */
async function loadEnabledChecks(): Promise<CheckDoc[]> {
  const docs = await Check.find({ enabled: true }).lean().exec();
  return docs as CheckDoc[];
}

// ── Probe result handler ──────────────────────────────────────────────────────
/**
 * Persists the probe result to the database, updates the in-memory snapshot,
 * and emits a pubsub event if the pass/fail state has changed.
 *
 * Mutating `check.lastResult` in-place is intentional: the `check` reference
 * is the same object captured in the setInterval closure, so the next call to
 * probeAndHandle sees the updated `prevOk` without hitting the DB.
 */
async function handleProbeResult(check: CheckDoc, result: ProbeResult): Promise<void> {
  const prevOk = check.lastResult?.ok; // undefined on the very first probe

  // Build the new snapshot.
  const newLastResult: ILastResult = {
    status: result.statusCode,
    latencyMs: result.latencyMs,
    checkedAt: new Date(),
    ok: result.ok,
  };

  // Persist to DB so the REST API can serve the latest status.
  await Check.findByIdAndUpdate(check._id, { lastResult: newLastResult });

  // Update in-memory so the next probe comparison uses the current state.
  check.lastResult = newLastResult;

  const tenantId = check.tenantId.toString();
  const checkId = check._id.toString();

  // Detect state transitions and publish events.
  // prevOk !== false covers both "true" (was passing) and "undefined" (first probe).
  if (prevOk !== false && !result.ok) {
    // Pass (or unknown) → Fail: open an incident.
    logger.warn({ checkId, tenantId }, `Check FAILED — ${check.url}`);
    publish(`incidents:${tenantId}`, { event: 'check:fail', checkId, tenantId, result });
  } else if (prevOk === false && result.ok) {
    // Fail → Pass: resolve the open incident.
    logger.info({ checkId, tenantId }, `Check RECOVERED — ${check.url}`);
    publish(`incidents:${tenantId}`, { event: 'check:recover', checkId, tenantId, result });
  }
  // Same state → no event (deduplication prevents duplicate incident creation).
}

// ── Probe loop ────────────────────────────────────────────────────────────────
/**
 * Runs a single probe cycle for `check` and handles the result.
 * Errors are caught here so one broken check cannot crash the scheduler.
 */
async function probeAndHandle(check: CheckDoc): Promise<void> {
  try {
    const result = await runProbe(check.url, check.expectedStatus, check.maxLatencyMs);
    await handleProbeResult(check, result);
  } catch (err) {
    logger.error({ err, checkId: check._id.toString() }, 'Unhandled error during probe cycle');
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────
/**
 * Schedules a check's probe loop:
 *   1. Clears any existing timer for this check (safe to call on reload).
 *   2. Waits a random 0–5 000 ms jitter to stagger startup probes.
 *   3. Runs the first probe immediately after the jitter delay.
 *   4. Starts a setInterval for subsequent probes every CHECK_INTERVAL_MS.
 */
function scheduleCheck(check: CheckDoc): void {
  const id = check._id.toString();

  // Cancel existing timer before rescheduling (e.g. after a check update).
  const existing = timers.get(id);
  if (existing) {
    clearInterval(existing);
    timers.delete(id);
  }

  // Stagger probes: random 0–5 000 ms delay before first fire.
  const jitter = Math.floor(Math.random() * 5_000);

  setTimeout(() => {
    // First probe immediately after jitter.
    void probeAndHandle(check);

    // Recurring probes every CHECK_INTERVAL_MS.
    const handle = setInterval(() => void probeAndHandle(check), env.CHECK_INTERVAL_MS);
    timers.set(id, handle);
  }, jitter);
}

// ── Reload ────────────────────────────────────────────────────────────────────
/**
 * Clears all existing timers, re-fetches enabled checks from the DB, and
 * re-schedules each one. Called on startup and on 'checks:changed' events.
 */
async function reloadChecks(): Promise<void> {
  try {
    logger.info('[Scheduler] Reloading checks…');

    // Cancel all running timers before rescheduling.
    for (const handle of timers.values()) {
      clearInterval(handle);
    }
    timers.clear();

    const checks = await loadEnabledChecks();
    for (const check of checks) {
      scheduleCheck(check);
    }

    logger.info(`[Scheduler] Scheduled ${checks.length.toString()} enabled check(s)`);
  } catch (err) {
    logger.error({ err }, '[Scheduler] Failed to reload checks');
  }
}

// ── Public API ────────────────────────────────────────────────────────────────
/**
 * Starts the probe scheduler.
 *
 * Called once from `server.ts` after `server.listen()` so that the DB
 * connection is confirmed before we try to load checks.
 *
 * @returns A `stopScheduler` function to call during graceful shutdown.
 *          It unsubscribes from pub/sub and cancels all outstanding timers.
 */
export async function startScheduler(): Promise<() => void> {
  logger.info('[Scheduler] Starting…');

  // The handler must be a stable reference so unsubscribe can remove it later.
  const handleChecksChanged: PubSubHandler = (_payload) => {
    void reloadChecks();
  };

  // Subscribe before the initial load so no mutation event is missed between
  // the load completing and the subscription being registered.
  subscribe('checks:changed', handleChecksChanged);

  await reloadChecks();

  logger.info('[Scheduler] Ready');

  /** Cancels all probe timers and removes the pub/sub listener. */
  return function stopScheduler(): void {
    logger.info('[Scheduler] Stopping…');
    unsubscribe('checks:changed', handleChecksChanged);
    for (const handle of timers.values()) {
      clearInterval(handle);
    }
    timers.clear();
    logger.info('[Scheduler] Stopped');
  };
}
