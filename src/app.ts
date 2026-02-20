/**
 * src/app.ts — Express Application Factory
 *
 * Creates and exports the configured Express `app` instance.
 * Intentionally separated from `server.ts` (which owns the http.Server,
 * the port binding, and the WebSocket attachment) for two reasons:
 *
 *  1. Testability — Supertest imports `app` directly and creates an in-process
 *     server without binding a real port. Tests stay fast and port-collision-free.
 *
 *  2. Separation of concerns — this file answers "what does the server do"
 *     (middleware, routes, error handling). `server.ts` answers "how does it run"
 *     (port, DB, WebSocket, OS signals).
 *
 * ── Middleware order ──────────────────────────────────────────────────────────
 * Express executes middleware in registration order. The stack below is arranged
 * so that each layer builds on what the previous one provides:
 *
 *   1. requestId     — attach X-Request-Id before anything can log or error
 *   2. helmet        — set security headers before any content is served
 *   3. cors          — handle preflight OPTIONS before body parsing
 *   4. compression   — compress after CORS headers are set
 *   5. hpp           — sanitise query params before any handler reads them
 *   6. json / urlencoded — parse bodies before route handlers or validators
 *   7. cookieParser  — parse cookies before authGuard reads req.cookies.token
 *   8. globalLimiter — rate-limit after parsing so we can read client identity
 *   ── routes ──
 *   9. /healthz, /readyz — outside /api/v1, no auth, no versioning
 *  10. /api/v1 router   — all versioned API routes
 *  11. 404 handler      — catches unmatched routes
 *  12. errorHandler     — MUST be last; handles all next(err) calls
 */

import express, { type Application, type Request, type Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import hpp from 'hpp';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';

import { env } from './config/env';
import { requestId } from './common/middleware/requestId';
import { globalLimiter, authLimiter, usageLimiter } from './common/middleware/rateLimit';
import { errorHandler } from './common/middleware/errorHandler';

// ── Module routers (mounted as implemented) ───────────────────────────────────
import authRouter from './modules/auth/auth.routes'; // Phase 4
import tenantRouter from './modules/tenant/tenant.routes'; // Phase 5
import checkRouter from './modules/check/check.routes'; // Phase 6
import incidentRouter from './modules/incident/incident.routes'; // Phase 8
import auditRouter from './modules/audit/audit.routes'; // Phase 9
import usageRouter from './modules/usage/usage.routes'; // Phase 10

// ── App instance ─────────────────────────────────────────────────────────────
const app: Application = express();

// ── 1. Request ID ────────────────────────────────────────────────────────────
// Must be first so req.requestId is available in every subsequent middleware,
// route handler, and the error handler.
app.use(requestId);

// ── 2. Helmet — security headers ─────────────────────────────────────────────
// Sets a suite of HTTP response headers that harden the app against common
// web vulnerabilities (clickjacking, MIME-sniffing, XSS via old IE, etc.).
//
// CSP is customised to allow:
//   - connectSrc 'ws:' / 'wss:' — browser clients need to open WebSocket and
//     SSE connections back to our own server; without this Chrome blocks them.
//   - script/style/img default to 'self' — this is a pure API, no served HTML,
//     but setting defaults prevents browsers from inheriting permissive policies.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Allow WebSocket (ws:/wss:) and SSE (fetch to self) connections.
        connectSrc: ["'self'", 'ws:', 'wss:'],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        // Block all frames — this is an API, not a page that should be embedded.
        frameAncestors: ["'none'"],
      },
    },
  }),
);

// ── 3. CORS ───────────────────────────────────────────────────────────────────
// Restricts cross-origin requests to the configured frontend origin(s).
// `credentials: true` is required for the browser to send HttpOnly cookies
// (the JWT token cookie) and for the server's Set-Cookie header to be
// accepted by the browser. Without it, cookie-based auth silently breaks.
//
// CORS_ORIGIN supports a comma-separated list for staging/multi-domain setups:
//   CORS_ORIGIN=http://localhost:3000,https://app.pulseboard.io
const corsOrigins = env.CORS_ORIGIN.split(',').map((o) => o.trim());
app.use(
  cors({
    origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins,
    credentials: true,
  }),
);

// ── 4. Compression ────────────────────────────────────────────────────────────
// Gzip/deflate responses above 1 kB. Particularly useful for paginated list
// responses and streamed timelines that can be several KB of JSON.
app.use(compression());

// ── 5. HPP — HTTP Parameter Pollution prevention ──────────────────────────────
// When the same query param appears multiple times (?id=1&id=2), Express
// populates req.query.id as an array. HPP collapses duplicates to the last
// value, preventing handlers from receiving unexpected arrays where they expect
// a scalar (which could bypass Zod validation or cause unexpected behaviour).
app.use(hpp());

// ── 6. Body parsers ───────────────────────────────────────────────────────────
// Parse JSON bodies (Content-Type: application/json).
app.use(express.json());
// Parse URL-encoded form bodies (Content-Type: application/x-www-form-urlencoded).
// extended: false uses the native querystring module — no nested objects needed.
app.use(express.urlencoded({ extended: false }));

// ── 7. Cookie parser ──────────────────────────────────────────────────────────
// Parses the Cookie header into req.cookies so authGuard can read
// req.cookies.token for HttpOnly JWT authentication.
app.use(cookieParser());

// ── 8. Global rate limiter ────────────────────────────────────────────────────
// Applied to every route: 200 requests/minute per IP.
// Route-specific limiters (authLimiter, usageLimiter) are applied at the
// router level in their respective route files.
app.use(globalLimiter);

// ── Health probes ─────────────────────────────────────────────────────────────
// Mounted outside /api/v1 — no versioning, no auth, no rate-limit overhead
// beyond the global limiter above. These are called frequently by orchestrators
// and must return quickly.

/**
 * GET /healthz — Liveness probe
 *
 * Answers: "Is the process alive?"
 * Always returns 200 as long as Node.js is running. Container orchestrators
 * (Kubernetes, ECS) restart the pod if this fails.
 * Never add DB checks here — a slow DB must not kill the process.
 */
app.get('/healthz', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

/**
 * GET /readyz — Readiness probe
 *
 * Answers: "Is the app ready to serve traffic?"
 * Checks Mongoose connection state:
 *   readyState === 1 (connected)  → 200 { status: 'ok',   db: 'connected'    }
 *   anything else                 → 503 { status: 'fail',  db: 'disconnected' }
 *
 * Orchestrators stop routing traffic to the pod while this returns non-200,
 * giving the DB connection time to establish on cold start.
 *
 * Mongoose readyState values: 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
 */
app.get('/readyz', (_req: Request, res: Response) => {
  const isConnected = mongoose.connection.readyState === 1;

  if (isConnected) {
    res.status(200).json({ status: 'ok', db: 'connected' });
  } else {
    res.status(503).json({ status: 'fail', db: 'disconnected' });
  }
});

// ── Versioned API router ──────────────────────────────────────────────────────
// All application routes live under /api/v1. Module routers are mounted here
// as they are implemented in later phases:
//
//   Phase 4  → authRouter    at /auth
//   Phase 5  → tenantRouter  at /tenants
//   Phase 6  → checkRouter   at /checks
//   Phase 8  → incidentRouter at /incidents
//   Phase 9  → auditRouter   at /audit
//   Phase 10 → usageRouter   at /usage
const apiRouter = express.Router();

// Phase 4 — Auth: strict rate limit (10 req/min) on all /auth endpoints
apiRouter.use('/auth', authLimiter, authRouter);

// Phase 5 — Tenants: no extra rate limit; authGuard is applied per-route
apiRouter.use('/tenants', tenantRouter);

// Phase 6 — Checks: no extra rate limit; authGuard applied per-route
apiRouter.use('/checks', checkRouter);

// Phase 8 — Incidents: no extra rate limit; authGuard applied per-route
apiRouter.use('/incidents', incidentRouter);

// Phase 9 — Audit: admin-only; authGuard applied per-route
apiRouter.use('/audit', auditRouter);

// Phase 10 — Usage: usageLimiter applied here; authGuard + idempotency guard per-route
apiRouter.use('/usage', usageLimiter, usageRouter);

app.use('/api/v1', apiRouter);

// ── 404 handler ───────────────────────────────────────────────────────────────
// Any request that reaches this point matched no registered route.
// Registered after all valid routes but before the error handler.
// Returns the standard { error } envelope so clients handle it consistently.
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
});

// ── Global error handler ──────────────────────────────────────────────────────
// MUST be the last middleware registered. Express identifies it as an error
// handler by its 4-argument signature. All next(err) calls end up here.
app.use(errorHandler);

export default app;
