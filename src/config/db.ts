/**
 * src/config/db.ts — Mongoose Connection Manager
 *
 * Exports two async functions:
 *
 *  • connectDB()    — Opens the Mongoose connection to MongoDB Atlas.
 *                     Called once in `server.ts` BEFORE `server.listen()`.
 *                     If the connection fails the process exits immediately
 *                     (fail-fast: a backend without a DB cannot serve traffic).
 *
 *  • disconnectDB() — Gracefully closes the Mongoose connection.
 *                     Called in the SIGTERM/SIGINT shutdown handler in
 *                     `server.ts` so in-flight writes are flushed before exit.
 *
 * ── Why connect before listen? ────────────────────────────────────────────
 *   Ensuring the DB is ready before accepting HTTP traffic prevents a race
 *   condition where the first real request arrives before Mongoose has
 *   completed its initial TCP handshake with MongoDB Atlas. Container
 *   readiness probes (/readyz) use this state to signal "ready for traffic".
 *
 * ── Mongoose options ──────────────────────────────────────────────────────
 *   `strictQuery: true` — Mongoose 7+ default. Filters out fields in query
 *   objects that do not exist in the schema, preventing accidental broad
 *   queries from reaching the DB. Explicitly set here to make the intent
 *   clear and avoid the deprecation warning if the Mongoose default changes
 *   in a future version.
 *
 * ── Connection events ─────────────────────────────────────────────────────
 *   Mongoose fires lifecycle events on `mongoose.connection`. We log each
 *   state change so that connection drops and reconnects are visible in
 *   production logs without any extra polling.
 */

import mongoose from 'mongoose';
import { env } from './env';
import logger from './logger';

// ── Mongoose global settings ───────────────────────────────────────────────
// Set before the first connection attempt.
mongoose.set('strictQuery', true);

// ── Connection event listeners ─────────────────────────────────────────────
// Registered once at module load time. Mongoose keeps the handlers across
// reconnects, so we don't need to re-register them inside connectDB().

mongoose.connection.on('connected', () => {
  logger.info('[DB] MongoDB connection established');
});

mongoose.connection.on('error', (err: Error) => {
  logger.error({ err }, '[DB] MongoDB connection error');
});

mongoose.connection.on('disconnected', () => {
  logger.warn('[DB] MongoDB disconnected');
});

mongoose.connection.on('reconnected', () => {
  logger.info('[DB] MongoDB reconnected');
});

// ── connectDB ─────────────────────────────────────────────────────────────
/**
 * Opens the Mongoose connection using the MONGODB_URI from env.
 *
 * @throws Will call `process.exit(1)` on connection failure rather than
 *         throwing, because a startup failure should kill the process — not
 *         be caught and silenced somewhere up the call stack.
 */
export async function connectDB(): Promise<void> {
  try {
    logger.info('[DB] Connecting to MongoDB…');
    await mongoose.connect(env.MONGO_URI);
    // The 'connected' event listener above logs the success message.
  } catch (err) {
    logger.fatal({ err }, '[DB] Failed to connect to MongoDB — exiting');
    process.exit(1);
  }
}

// ── disconnectDB ──────────────────────────────────────────────────────────
/**
 * Gracefully closes the Mongoose connection.
 *
 * Mongoose flushes any pending buffered operations before closing the
 * underlying socket, so in-flight writes are not lost.
 */
export async function disconnectDB(): Promise<void> {
  try {
    await mongoose.disconnect();
    logger.info('[DB] MongoDB connection closed');
  } catch (err) {
    logger.error({ err }, '[DB] Error while closing MongoDB connection');
  }
}
