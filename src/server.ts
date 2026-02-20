/**
 * src/server.ts — Application Entry Point
 *
 * This is the top-level bootstrap file. Its responsibilities are:
 *
 *  1. Load environment variables from the .env file BEFORE anything else
 *     imports from `config/env.ts` (which validates them at parse-time).
 *
 *  2. Connect to MongoDB via `connectDB()`. We wait for the connection to
 *     succeed before binding the HTTP port so that:
 *       a) No request can arrive before the DB is ready.
 *       b) The readiness probe (/readyz) correctly reflects DB state from
 *          the very first request.
 *
 *  3. Create a raw Node.js `http.Server` around the Express `app`.
 *     We deliberately avoid calling `app.listen()` directly so that the
 *     same underlying `http.Server` instance can be handed to the
 *     WebSocket server (`attachWS`) in Phase 3 — both WS and HTTP traffic
 *     share a single TCP port.
 *
 *  4. Start listening and print the startup banner via the pino logger.
 *
 *  5. Register OS signal handlers (SIGTERM, SIGINT) for graceful shutdown
 *     so that in-flight requests are drained and the DB connection is
 *     closed before the process exits. Critical in containerised deployments
 *     (Docker / Kubernetes) where the orchestrator sends SIGTERM before
 *     forcibly killing the pod.
 *
 * ── Evolution by Phase ────────────────────────────────────────────────────
 *  Phase 1 (now) : connectDB + logger + env wired in
 *  Phase 3       : import attachWS() from realtime/ws.ts; attach after listen
 *                  expand shutdown() to close WS connections
 */

// Load .env into process.env immediately — must be the very first import
// so that all subsequent modules that read process.env see the values.
import 'dotenv/config';

import http from 'http';
import app from './app.js';
import { env } from './config/env.js';
import logger from './config/logger.js';
import { connectDB, disconnectDB } from './config/db.js';

// ── HTTP Server ────────────────────────────────────────────────────────────
// Wrap the Express app in a plain Node http.Server.
// Reason: app.listen() returns an http.Server but also starts listening
// immediately — we want to control the moment we start accepting traffic
// (after DB is connected). Using http.createServer() keeps those two
// concerns separate and lets us attach the WebSocket server in Phase 3.
const server = http.createServer(app);

// ── Graceful shutdown ──────────────────────────────────────────────────────
/**
 * Closes the server without dropping active connections abruptly.
 *
 * `server.close()` stops accepting *new* connections but allows existing
 * keep-alive connections to finish their current request before closing.
 * The callback fires once all connections have drained.
 *
 * In Phase 3 this function will also:
 *  - Call `wss.close()` to send WebSocket close frames to all clients.
 *  - End all open SSE response streams.
 *  - Set a hard-kill timeout (e.g. 10 s) in case drain takes too long.
 *
 * @param signal - The OS signal name ('SIGTERM' | 'SIGINT') for logging.
 */
async function shutdown(signal: string): Promise<void> {
  logger.info(`[PulseBoard] ${signal} received — shutting down gracefully…`);

  // Step 1: Stop accepting new HTTP connections; drain in-flight requests.
  server.close(async () => {
    logger.info('[PulseBoard] HTTP server closed — draining DB connection…');

    // Step 2: Close the Mongoose connection so pending writes are flushed.
    await disconnectDB();

    logger.info('[PulseBoard] Shutdown complete. Bye.');
    process.exit(0);
  });
}

// SIGTERM is sent by Docker / Kubernetes when stopping a container.
// SIGINT  is sent when the developer presses Ctrl+C in the terminal.
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT',  () => void shutdown('SIGINT'));

// ── Bootstrap ─────────────────────────────────────────────────────────────
/**
 * Async IIFE that:
 *  1. Connects to MongoDB (exits on failure — fail-fast).
 *  2. Starts the HTTP server listening on env.PORT.
 *  3. Prints the startup banner.
 *
 * Using an IIFE avoids top-level await (which requires "type":"module"
 * in package.json and changes the module system for the entire project).
 */
(async () => {
  // 1. Connect to MongoDB before accepting any HTTP traffic.
  await connectDB();

  // 2. Start listening.
  server.listen(env.PORT, () => {
    // ASCII banner — PULSEBOARD (10 letters: P-U-L-S-E-B-O-A-R-D)
    logger.info('');
    logger.info('  ██████╗ ██╗   ██╗██╗     ███████╗███████╗██████╗  ██████╗  █████╗ ██████╗ ██████╗ ');
    logger.info('  ██╔══██╗██║   ██║██║     ██╔════╝██╔════╝██╔══██╗██╔═══██╗██╔══██╗██╔══██╗██╔══██╗');
    logger.info('  ██████╔╝██║   ██║██║     ███████╗█████╗  ██████╔╝██║   ██║███████║██████╔╝██║  ██║');
    logger.info('  ██╔═══╝ ██║   ██║██║     ╚════██║██╔══╝  ██╔══██╗██║   ██║██╔══██║██╔══██╗██║  ██║');
    logger.info('  ██║     ╚██████╔╝███████╗███████║███████╗██████╔╝╚██████╔╝██║  ██║██║  ██║██████╔╝');
    logger.info('  ╚═╝      ╚═════╝ ╚══════╝╚══════╝╚══════╝╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ ');
    logger.info('');
    logger.info('  Uptime & Incident Control Room — Backend API');
    logger.info('  ─────────────────────────────────────────────');
    logger.info(`  Server  →  http://localhost:${env.PORT}`);
    logger.info(`  Health  →  http://localhost:${env.PORT}/healthz`);
    logger.info(`  Ready   →  http://localhost:${env.PORT}/readyz`);
    logger.info(`  Env     →  ${env.NODE_ENV}`);
    logger.info(`  Phase   →  1  (config layer)`);
    logger.info('');
  });
})();

export default server;
