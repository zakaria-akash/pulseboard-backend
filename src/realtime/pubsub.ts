/**
 * src/realtime/pubsub.ts — In-Process Event Bus
 *
 * A thin, typed wrapper around Node.js `EventEmitter` that provides a simple
 * publish/subscribe interface used throughout the application:
 *
 *   - The scheduler (Phase 7) publishes 'check:fail' / 'check:recover' events
 *     on the channel `incidents:{tenantId}` when a probe changes state.
 *   - The incident service (Phase 8) subscribes to drive automatic open/resolve.
 *   - The WebSocket server (Phase 11) subscribes to forward events to browsers.
 *   - The check service (Phase 6) publishes on 'checks:changed' so the scheduler
 *     can reload its configuration after a CRUD mutation.
 *
 * ── Design ────────────────────────────────────────────────────────────────────
 *
 *  Single shared EventEmitter
 *    All modules import the same three functions which act on a module-level
 *    EventEmitter singleton. No class instantiation is required at call sites.
 *
 *  Extensible to Redis
 *    The publish/subscribe interface is intentionally narrow. Replacing the
 *    in-process EventEmitter with a Redis pub/sub adapter (for multi-process
 *    or multi-pod deployments) requires changes only in this file — callers
 *    remain unchanged.
 *
 *  setMaxListeners(0)
 *    The default limit of 10 listeners per event produces a warning in large
 *    applications. Setting 0 disables the limit; Node.js will not warn even
 *    when many subscribers are registered on the same channel.
 *
 * ── Channel naming conventions ────────────────────────────────────────────────
 *
 *  `incidents:{tenantId}` — probe state-change events for a specific tenant.
 *     Payload: { event: 'check:fail' | 'check:recover', checkId, tenantId, result }
 *
 *  `checks:changed`       — internal signal that a check was created/updated/deleted.
 *     Payload: { tenantId: string }
 *     The scheduler listens here to reload its timer configuration.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   import { publish, subscribe, unsubscribe } from '../realtime/pubsub';
 *
 *   // Publisher (e.g. scheduler):
 *   publish(`incidents:${tenantId}`, { event: 'check:fail', checkId, tenantId });
 *
 *   // Subscriber (e.g. incident service):
 *   const handler = (payload: unknown) => { ... };
 *   subscribe(`incidents:${tenantId}`, handler);
 *
 *   // Cleanup (e.g. on shutdown or test teardown):
 *   unsubscribe(`incidents:${tenantId}`, handler);
 */

import { EventEmitter } from 'events';

/** Signature for any channel subscriber. */
export type PubSubHandler = (payload: unknown) => void;

// Module-level singleton — all callers share the same event bus.
const bus = new EventEmitter();

// Disable the listener-count warning; the app legitimately registers many
// subscribers on the same channels without it indicating a memory leak.
bus.setMaxListeners(0);

// ── publish ───────────────────────────────────────────────────────────────────
/**
 * Emits `payload` synchronously to every subscriber registered on `channel`.
 *
 * @param channel  Channel name, e.g. `'incidents:abc123'` or `'checks:changed'`.
 * @param payload  Arbitrary data delivered to each handler.
 */
export function publish(channel: string, payload: unknown): void {
  bus.emit(channel, payload);
}

// ── subscribe ─────────────────────────────────────────────────────────────────
/**
 * Registers `handler` to be called every time `channel` receives a message.
 * Multiple handlers can be registered on the same channel; each is called
 * independently in registration order.
 *
 * @param channel  Channel name to listen on.
 * @param handler  Function called with the published payload.
 */
export function subscribe(channel: string, handler: PubSubHandler): void {
  bus.on(channel, handler);
}

// ── unsubscribe ───────────────────────────────────────────────────────────────
/**
 * Removes a specific handler from a channel. Pass the exact same function
 * reference that was passed to subscribe().
 *
 * @param channel  Channel name to stop listening on.
 * @param handler  The handler reference to remove.
 */
export function unsubscribe(channel: string, handler: PubSubHandler): void {
  bus.off(channel, handler);
}
