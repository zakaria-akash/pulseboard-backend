/**
 * src/server.ts — Application Entry Point & Bootstrap
 *
 * Owns everything that lives outside the Express app itself:
 *  1. Loading .env before any module reads process.env.
 *  2. Connecting to MongoDB before accepting HTTP traffic.
 *  3. Creating the raw http.Server so HTTP and WebSocket share one TCP port.
 *  4. Starting the server and attaching the WebSocket server.
 *  5. Graceful shutdown on SIGTERM / SIGINT.
 *
 * ── Why separate from app.ts? ─────────────────────────────────────────────────
 *   `app.ts` is imported by integration tests via Supertest, which spins up an
 *   in-process server without binding a real port. If server.ts were merged with
 *   app.ts, every test would also attempt to connect to MongoDB and listen on
 *   port 4000 — slowing down the suite and causing port-collision failures.
 *
 * ── Bootstrap sequence ────────────────────────────────────────────────────────
 *   dotenv → connectDB → http.createServer(app) → server.listen → attachWS
 *
 *   The sequence is strict:
 *   a) dotenv must load before config/env.ts is imported (env validation runs
 *      at module parse time, not at call time).
 *   b) DB must be connected before the server starts accepting traffic so the
 *      /readyz probe correctly reflects "ready" from the very first request.
 *   c) attachWS must be called after server.listen so the underlying TCP socket
 *      exists for the WebSocket server to upgrade connections on.
 *
 * ── Graceful shutdown ─────────────────────────────────────────────────────────
 *   On SIGTERM (sent by Docker/Kubernetes when stopping a container) or SIGINT
 *   (Ctrl+C during development), the shutdown sequence is:
 *     1. Stop accepting new HTTP connections (`server.close()`).
 *     2. Close all WebSocket connections (sends close frames to clients).
 *     3. Disconnect Mongoose (flushes pending writes).
 *     4. Exit with code 0.
 *
 *   A hard-kill timeout ensures the process doesn't hang forever if a client
 *   holds a keep-alive connection open indefinitely.
 */

// ── Load .env first ───────────────────────────────────────────────────────────
// Must be the very first import. config/env.ts validates process.env at parse
// time — if dotenv hasn't run yet, MONGO_URI and JWT_SECRET will be undefined
// and the process will exit immediately with a validation error.
import 'dotenv/config';

import http from 'http';
import app from './app';
import { env } from './config/env';
import logger from './config/logger';
import { connectDB, disconnectDB } from './config/db';
import { attachWS, type WsController } from './realtime/ws';

// ── HTTP Server ───────────────────────────────────────────────────────────────
// Wrapping app in http.createServer (rather than calling app.listen) lets us
// hand the same server instance to the WebSocket server so both HTTP upgrades
// and regular HTTP requests share a single TCP socket / port.
const server = http.createServer(app);

// Holds the WsController returned by attachWS. Populated after listen() so
// the shutdown handler can close WebSocket connections gracefully.
let wsController: WsController | null = null;

// ── Graceful shutdown ─────────────────────────────────────────────────────────
/**
 * Drain in-flight requests, close the WebSocket server, disconnect MongoDB,
 * then exit cleanly.
 *
 * `server.close()` stops the server from accepting new connections while
 * allowing existing keep-alive connections to finish their current request.
 * The callback fires once all connections have closed.
 *
 * A 10-second hard-kill timeout prevents the process from hanging if a
 * long-lived connection (e.g. an SSE stream) refuses to close on its own.
 *
 * @param signal  The OS signal name, used only for the log message.
 */
async function shutdown(signal: string): Promise<void> {
  logger.info(`[PulseBoard] ${signal} received — shutting down gracefully…`);

  // Hard-kill timeout: if drain takes more than 10 s, force exit.
  // This prevents a stuck connection from leaving a zombie process.
  const killTimer = setTimeout(() => {
    logger.error('[PulseBoard] Shutdown timed out — forcing exit');
    process.exit(1);
  }, 10_000).unref(); // .unref() so the timer doesn't prevent the clean exit path

  server.close(async () => {
    clearTimeout(killTimer);

    logger.info('[PulseBoard] HTTP server closed');

    // Close WebSocket connections, sending close frames to all connected clients.
    // Phase 11 will make this asynchronous; for now the stub is a no-op.
    wsController?.close();
    logger.info('[PulseBoard] WebSocket server closed');

    // Flush pending Mongoose writes and close the connection pool.
    await disconnectDB();

    logger.info('[PulseBoard] Shutdown complete. Bye.');
    process.exit(0);
  });
}

// Docker / Kubernetes send SIGTERM when stopping a container.
process.on('SIGTERM', () => void shutdown('SIGTERM'));
// Ctrl+C in the terminal during development.
process.on('SIGINT', () => void shutdown('SIGINT'));

// ── Bootstrap ─────────────────────────────────────────────────────────────────
/**
 * Async IIFE that runs the full startup sequence:
 *   1. Connect to MongoDB (exits on failure — fail-fast).
 *   2. Start the HTTP server on env.PORT.
 *   3. Attach the WebSocket server to the same http.Server instance.
 *   4. Print the startup banner.
 *
 * An IIFE is used to avoid top-level await, which would require
 * `"type": "module"` in package.json and change the module system project-wide.
 */
(async () => {
  // 1. Ensure MongoDB is reachable before accepting any HTTP traffic.
  //    connectDB calls process.exit(1) on failure, so no error handling needed here.
  await connectDB();

  // 2. Bind the TCP port.
  server.listen(env.PORT, () => {
    // 3. Attach the WebSocket server — must be done after listen() so the
    //    underlying socket exists for the WS upgrade handshake.
    wsController = attachWS(server);

    // ── Startup banner ────────────────────────────────────────────────────
    logger.info('');
    logger.info(
      '  ██████╗ ██╗   ██╗██╗     ███████╗███████╗██████╗  ██████╗  █████╗ ██████╗ ██████╗ ',
    );
    logger.info(
      '  ██╔══██╗██║   ██║██║     ██╔════╝██╔════╝██╔══██╗██╔═══██╗██╔══██╗██╔══██╗██╔══██╗',
    );
    logger.info(
      '  ██████╔╝██║   ██║██║     ███████╗█████╗  ██████╔╝██║   ██║███████║██████╔╝██║  ██║',
    );
    logger.info(
      '  ██╔═══╝ ██║   ██║██║     ╚════██║██╔══╝  ██╔══██╗██║   ██║██╔══██║██╔══██╗██║  ██║',
    );
    logger.info(
      '  ██║     ╚██████╔╝███████╗███████║███████╗██████╔╝╚██████╔╝██║  ██║██║  ██║██████╔╝',
    );
    logger.info(
      '  ╚═╝      ╚═════╝ ╚══════╝╚══════╝╚══════╝╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ ',
    );
    logger.info('');
    logger.info('  Uptime & Incident Control Room — Backend API');
    logger.info('  ─────────────────────────────────────────────');
    logger.info(`  Server   →  http://localhost:${env.PORT}`);
    logger.info(`  Healthz  →  http://localhost:${env.PORT}/healthz`);
    logger.info(`  Readyz   →  http://localhost:${env.PORT}/readyz`);
    logger.info(`  Env      →  ${env.NODE_ENV}`);
    logger.info(`  Phase    →  3  (app & server wiring)`);
    logger.info('');
  });
})();

export default server;
