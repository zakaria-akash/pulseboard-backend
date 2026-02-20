/**
 * src/app.ts — Express Application Factory
 *
 * This file creates and configures the Express `app` instance.
 * It is intentionally kept separate from `server.ts` (which owns the
 * http.Server and the port) for two important reasons:
 *
 *  1. Testability — Supertest can import `app` directly and spin up an
 *     in-process server without binding to a real port. Tests stay fast
 *     and port-collision-free.
 *
 *  2. Separation of concerns — `app.ts` is purely about *what* the server
 *     does (middleware stack, routes, error handling). `server.ts` is about
 *     *how* it runs (port, DB connection, WebSocket attachment, signals).
 *
 * ── Middleware order matters ───────────────────────────────────────────────
 * Express processes middleware in the order it is registered. The order
 * used in Phase 3 will be:
 *
 *   requestId  →  helmet  →  cors  →  compression  →  hpp
 *   →  express.json  →  cookieParser  →  globalLimiter
 *   →  /api/v1 routes  →  404 handler  →  errorHandler
 *
 * ── Evolution by Phase ────────────────────────────────────────────────────
 *  Phase 0 (now) : json parser, health probes, root info, 404, fallback error handler
 *  Phase 2       : replace fallback error handler with the typed AppError handler
 *  Phase 3       : add Helmet, CORS, compression, hpp, cookieParser, globalLimiter,
 *                  mount /api/v1 router with all module sub-routers
 */
import express, { type Application, type Request, type Response, type NextFunction } from 'express';

// ── App instance ───────────────────────────────────────────────────────────
// `express()` returns an Application — a thin wrapper around Node's
// http.IncomingMessage / ServerResponse with a routing layer on top.
const app: Application = express();

// ── Body parsers ───────────────────────────────────────────────────────────
// Parse incoming JSON payloads (Content-Type: application/json).
// Without this, req.body is undefined for POST/PATCH requests.
app.use(express.json());

// Parse URL-encoded form bodies (Content-Type: application/x-www-form-urlencoded).
// `extended: false` uses the native `querystring` module (no nested objects),
// which is sufficient for our simple form data needs.
app.use(express.urlencoded({ extended: false }));

// ── Health probes ──────────────────────────────────────────────────────────
/**
 * GET /healthz — Liveness probe
 *
 * Answers the question: "Is the process alive?"
 * Should ALWAYS return 200 as long as Node.js is running.
 * Container orchestrators (Kubernetes, ECS) restart the pod if this fails.
 * Never add DB checks here — a slow DB should not kill the process.
 */
app.get('/healthz', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * GET /readyz — Readiness probe
 *
 * Answers the question: "Is the app ready to serve traffic?"
 * In Phase 1 this will perform a real MongoDB ping:
 *   mongoose.connection.readyState === 1  →  200 { db: 'connected' }
 *   otherwise                             →  503 { db: 'disconnected' }
 * Orchestrators stop routing traffic to the pod while this returns non-200,
 * giving the DB connection time to establish on cold start.
 *
 * Currently returns 200 with db: 'pending' (no DB yet in Phase 0).
 */
app.get('/readyz', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', db: 'pending', timestamp: new Date().toISOString() });
});

// ── Root info ──────────────────────────────────────────────────────────────
/**
 * GET / — API discovery
 *
 * Lightweight endpoint that confirms the API is reachable and identifies
 * the service. Useful for quick curl checks during development.
 * Not versioned — lives outside /api/v1 intentionally.
 */
app.get('/', (_req: Request, res: Response) => {
  res.status(200).json({
    name: 'PulseBoard API',
    version: '1.0.0',
    phase: 0,
    note: 'Toolchain bootstrap — no domain logic yet',
  });
});

// ── 404 handler ────────────────────────────────────────────────────────────
// Any request that falls through all registered routes lands here.
// Registered BEFORE the error handler but AFTER all valid routes.
// Returns a consistent { error } envelope matching the rest of the API.
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
});

// ── Fallback error handler ─────────────────────────────────────────────────
/**
 * Express identifies a function as an error handler by its 4-argument
 * signature: (err, req, res, next). It MUST have exactly 4 parameters —
 * even if `next` is unused — otherwise Express treats it as regular
 * middleware and skips it for errors.
 *
 * This handler is replaced in Phase 2 with the full typed `errorHandler`
 * from `common/middleware/errorHandler.ts`, which:
 *  - Distinguishes AppError, ZodError, and MongoServerError by type
 *  - Maps each to the correct HTTP status code
 *  - Logs 500s with the pino logger + requestId for tracing
 *  - Always responds with the standard { error: { code, message, details? } } envelope
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
});

export default app;
