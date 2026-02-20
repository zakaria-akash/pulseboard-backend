/**
 * src/server.ts — Application Entry Point
 *
 * This is the top-level bootstrap file. Its responsibilities are:
 *
 *  1. Load environment variables from the .env file BEFORE anything else
 *     imports from `config/env.ts` (which validates them at parse-time).
 *
 *  2. Create a raw Node.js `http.Server` around the Express `app`.
 *     We deliberately avoid calling `app.listen()` directly so that the
 *     same underlying `http.Server` instance can be handed to the
 *     WebSocket server (`attachWS`) in Phase 3 — both WS and HTTP traffic
 *     share a single TCP port (4000).
 *
 *  3. Start listening and print the startup banner.
 *
 *  4. Register OS signal handlers (SIGTERM, SIGINT) for graceful shutdown
 *     so that in-flight requests are drained before the process exits.
 *     This is critical in containerised deployments (Docker / Kubernetes)
 *     where the orchestrator sends SIGTERM before forcibly killing the pod.
 *
 * ── Evolution by Phase ────────────────────────────────────────────────────
 *  Phase 0 (now) : bare http.Server + banner + signal handlers
 *  Phase 1       : import connectDB() from config/db.ts; await before listen
 *  Phase 3       : import attachWS() from realtime/ws.ts; attach after listen
 *                  expand shutdown() to close WS connections + drain DB
 */

// Load .env into process.env immediately — must be the very first import
// so that all subsequent modules that read process.env see the values.
import 'dotenv/config';

import http from 'http';
import app from './app';

// ── Environment ────────────────────────────────────────────────────────────
// Read PORT from env with a sensible fallback; parseInt ensures it is a
// number (http.Server.listen rejects strings in strict TypeScript).
const PORT = parseInt(process.env['PORT'] ?? '4000', 10);
const ENV = process.env['NODE_ENV'] ?? 'development';

// ── HTTP Server ────────────────────────────────────────────────────────────
// Wrap the Express app in a plain Node http.Server.
// Reason: app.listen() returns an http.Server but also starts listening
// immediately — we want to control the moment we start accepting traffic
// (after DB is connected in Phase 1). Using http.createServer() keeps those
// two concerns separate and lets us attach the WebSocket server in Phase 3.
const server = http.createServer(app);

// ── Start listening ────────────────────────────────────────────────────────
server.listen(PORT, () => {
  // ASCII banner — PULSEBOARD (10 letters: P-U-L-S-E-B-O-A-R-D)
  console.log('');
  console.log('  ██████╗ ██╗   ██╗██╗     ███████╗███████╗██████╗  ██████╗  █████╗ ██████╗ ██████╗ ');
  console.log('  ██╔══██╗██║   ██║██║     ██╔════╝██╔════╝██╔══██╗██╔═══██╗██╔══██╗██╔══██╗██╔══██╗');
  console.log('  ██████╔╝██║   ██║██║     ███████╗█████╗  ██████╔╝██║   ██║███████║██████╔╝██║  ██║');
  console.log('  ██╔═══╝ ██║   ██║██║     ╚════██║██╔══╝  ██╔══██╗██║   ██║██╔══██║██╔══██╗██║  ██║');
  console.log('  ██║     ╚██████╔╝███████╗███████║███████╗██████╔╝╚██████╔╝██║  ██║██║  ██║██████╔╝');
  console.log('  ╚═╝      ╚═════╝ ╚══════╝╚══════╝╚══════╝╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ ');
  console.log('');
  console.log('  Uptime & Incident Control Room — Backend API');
  console.log('  ─────────────────────────────────────────────');
  console.log(`  Server  →  http://localhost:${PORT}`);
  console.log(`  Health  →  http://localhost:${PORT}/healthz`);
  console.log(`  Ready   →  http://localhost:${PORT}/readyz`);
  console.log(`  Env     →  ${ENV}`);
  console.log(`  Phase   →  0  (toolchain bootstrap)`);
  console.log('');
});

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
 *  - Call `mongoose.disconnect()` to flush pending writes to MongoDB.
 *  - Set a hard-kill timeout (e.g. 10 s) in case drain takes too long.
 *
 * @param signal - The OS signal name ('SIGTERM' | 'SIGINT') for logging.
 */
function shutdown(signal: string): void {
  console.log(`\n  [PulseBoard] ${signal} received — shutting down gracefully...`);
  server.close(() => {
    console.log('  [PulseBoard] HTTP server closed. Bye.');
    process.exit(0);
  });
}

// SIGTERM is sent by Docker / Kubernetes when stopping a container.
// SIGINT  is sent when the developer presses Ctrl+C in the terminal.
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default server;
