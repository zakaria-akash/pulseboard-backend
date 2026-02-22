# PulseBoard Backend — CodeFlow

> A complete technical walkthrough of every file in the backend codebase.
> Written for developers who are brand-new to Node.js and Express.js.

---

## Table of Contents

1. [What Is PulseBoard?](#1-what-is-pulseboard)
2. [How the Backend Is Organised](#2-how-the-backend-is-organised)
3. [The Layered Architecture](#3-the-layered-architecture)
4. [A Request's Journey — Start to Finish](#4-a-requests-journey--start-to-finish)
5. [Config Layer](#5-config-layer)
   - [env.ts — Environment Variables](#51-envts--environment-variables)
   - [db.ts — Database Connection](#52-dbts--database-connection)
   - [logger.ts — Application Logging](#53-loggerts--application-logging)
6. [Common Layer — Shared Building Blocks](#6-common-layer--shared-building-blocks)
   - [errors.ts — Error Types](#61-errorsts--error-types)
   - [http.ts — Response Envelopes](#62-httpts--response-envelopes)
   - [paginate.ts — Pagination Helper](#63-paginatets--pagination-helper)
7. [Middleware — The Request Pipeline](#7-middleware--the-request-pipeline)
   - [requestId.ts — Request Tracing](#71-requestidts--request-tracing)
   - [requestLogger.ts — Access Logging](#72-requestloggerts--access-logging)
   - [validate.ts — Input Validation](#73-validatets--input-validation)
   - [authGuard.ts — Authentication & Authorisation](#74-authguardts--authentication--authorisation)
   - [rateLimit.ts — Abuse Prevention](#75-ratelimitts--abuse-prevention)
   - [errorHandler.ts — Global Error Handling](#76-errorhandlerts--global-error-handling)
8. [Type System](#8-type-system)
   - [express.d.ts — Express Augmentation](#81-expressdts--express-augmentation)
9. [App Wiring](#9-app-wiring)
   - [app.ts — The Express Application](#91-appts--the-express-application)
   - [server.ts — The HTTP Server](#92-serverts--the-http-server)
10. [Auth Module](#10-auth-module)
    - [user.model.ts — User Schema](#101-usermodelts--user-schema)
    - [auth.validation.ts — Input Schemas](#102-authvalidationts--input-schemas)
    - [auth.service.ts — Business Logic](#103-authservicets--business-logic)
    - [auth.controller.ts — HTTP Handlers](#104-authcontrollerts--http-handlers)
    - [auth.routes.ts — Route Declarations](#105-authroutests--route-declarations)
11. [Tenant Module](#11-tenant-module)
    - [tenant.model.ts — Tenant Schema](#111-tenantmodelts--tenant-schema)
    - [membership.model.ts — Membership Schema](#112-membershipmodelts--membership-schema)
    - [tenant.validation.ts — Input Schemas](#113-tenantvalidationts--input-schemas)
    - [tenant.service.ts — Business Logic](#114-tenantservicets--business-logic)
    - [tenant.controller.ts & tenant.routes.ts](#115-tenantcontrollerts--tenantroutests)
12. [Check Module](#12-check-module)
    - [check.model.ts — Check Schema](#121-checkmodelts--check-schema)
    - [check.validation.ts — Input Schemas](#122-checkvalidationts--input-schemas)
    - [check.repo.ts — Database Layer](#123-checkrepots--database-layer)
    - [check.service.ts — Business Logic & Probe](#124-checkservicets--business-logic--probe)
    - [check.controller.ts & check.routes.ts](#125-checkcontrollerts--checkroutests)
13. [The Scheduler — Automated HTTP Probing](#13-the-scheduler--automated-http-probing)
14. [Incident Module](#14-incident-module)
    - [incident.model.ts — Incident Schema](#141-incidentmodelts--incident-schema)
    - [incident.validation.ts — Input Schemas](#142-incidentvalidationts--input-schemas)
    - [incident.repo.ts — Database Layer](#143-incidentrepots--database-layer)
    - [incident.service.ts — Business Logic](#144-incidentservicets--business-logic)
    - [incident.controller.ts & incident.routes.ts](#145-incidentcontrollerts--incidentroutests)
15. [Audit Module](#15-audit-module)
    - [audit.model.ts — Audit Log Schema](#151-auditmodelts--audit-log-schema)
    - [audit.service.ts — Log & Query](#152-auditservicets--log--query)
    - [audit.controller.ts & audit.routes.ts](#153-auditcontrollerts--auditroutests)
16. [Usage Module](#16-usage-module)
    - [usage.model.ts — Usage Event Schema](#161-usagemodelts--usage-event-schema)
    - [usage.validation.ts — Input Schemas & Header Guard](#162-usagevalidationts--input-schemas--header-guard)
    - [usage.service.ts — Idempotent Ingestion](#163-usageservicets--idempotent-ingestion)
    - [usage.controller.ts & usage.routes.ts](#164-usagecontrollerts--usageroutests)
17. [Real-Time Layer](#17-real-time-layer)
    - [pubsub.ts — In-Process Event Bus](#171-pubsubts--in-process-event-bus)
    - [ws.ts — WebSocket Server](#172-wsts--websocket-server)
    - [sse.ts — Server-Sent Events](#173-ssets--server-sent-events)
    - [stream.ts — Streaming HTTP Response](#174-streamts--streaming-http-response)
18. [The Full Event Flow — From Probe Failure to Browser](#18-the-full-event-flow--from-probe-failure-to-browser)
19. [Database Design at a Glance](#19-database-design-at-a-glance)
20. [Security Architecture](#20-security-architecture)
21. [Future Upgrades & Limitations](#21-future-upgrades--limitations)

---

## 1. What Is PulseBoard?

### From a user's perspective

Imagine you run a website — say, an online shop. You need to know immediately if it goes down so you can fix it before losing sales. PulseBoard is your control room: you add your website as a "check", and PulseBoard automatically visits it every 30–60 seconds to verify it is responding correctly. If it stops responding, PulseBoard:

1. **Opens an incident** — a record that says "something is wrong".
2. **Alerts your team in real time** — the dashboard updates instantly without needing to refresh the page.
3. **Resolves the incident automatically** when the website comes back up.
4. **Keeps a complete history** of everything that happened, exportable as a CSV for monthly reviews.

Companies with multiple brands (e.g. a hotel chain with several websites) are also supported — each brand sees only its own checks and incidents ("multi-tenant isolation").

### From a developer's perspective

The backend is a **REST API** built with:

- **Express.js** — a minimal Node.js web framework that handles HTTP requests and responses.
- **TypeScript** — JavaScript with strict types so bugs are caught before the code runs.
- **MongoDB + Mongoose** — a document database with an object modelling library.
- **WebSockets + SSE** — two different protocols for pushing data from the server to the browser in real time without the browser needing to poll.
- **Zod** — a schema validation library that checks incoming request data and rejects anything malformed.

The codebase is organised into **layers**: config → common (shared utilities) → modules (domain logic) → real-time. Each layer builds on the one below it, and no layer reaches "upward" into a higher one.

---

## 2. How the Backend Is Organised

```
src/
  config/           ← Layer 1: Environment, database, logging
  common/           ← Layer 2: Shared error types, response helpers, middleware
  types/            ← TypeScript augmentations (no runtime code)
  modules/          ← Layer 3: Domain logic, grouped by feature
    auth/
    tenant/
    check/
    incident/
    audit/
    usage/
  realtime/         ← Layer 4: WebSocket, SSE, pub/sub, streaming
  app.ts            ← Wires all middleware and routes together
  server.ts         ← Starts the HTTP server, connects to the DB
  scheduler.ts      ← Runs background HTTP probes on a timer
```

**Why this structure?**
Each directory has one single job. `config/` never imports from `modules/`; `modules/` never directly imports from other modules (they communicate through the pub/sub bus). This makes it easy to change one part without breaking another, and easy for a new developer to find where a particular piece of behaviour lives.

---

## 3. The Layered Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  INCOMING HTTP REQUEST                                           │
├──────────────────────────────────────────────────────────────────┤
│  MIDDLEWARE PIPELINE (app.ts)                                    │
│  requestId → requestLogger → helmet → cors → compression →      │
│  hpp → json parser → cookieParser → globalRateLimiter           │
├──────────────────────────────────────────────────────────────────┤
│  ROUTE HANDLER (modules/*/routes.ts)                            │
│  authGuard? → rateLimit? → validate? → controller               │
├──────────────────────────────────────────────────────────────────┤
│  CONTROLLER  (modules/*/controller.ts)                          │
│  Reads req → calls service → writes res                         │
├──────────────────────────────────────────────────────────────────┤
│  SERVICE     (modules/*/service.ts)                             │
│  Business rules, state machines, audit logging, pub/sub         │
├──────────────────────────────────────────────────────────────────┤
│  REPOSITORY  (modules/*/repo.ts)                                │
│  Mongoose queries — always scoped to tenantId                   │
├──────────────────────────────────────────────────────────────────┤
│  DATABASE    (MongoDB Atlas / MongoMemoryServer in tests)       │
└──────────────────────────────────────────────────────────────────┘

          ↕  PUB/SUB BUS (realtime/pubsub.ts)
┌──────────────────────────────────────────────────────────────────┐
│  SCHEDULER   (scheduler.ts)                                     │
│  setInterval → runProbe → publish('probe:events')               │
├──────────────────────────────────────────────────────────────────┤
│  REAL-TIME   (realtime/ws.ts + sse.ts + stream.ts)              │
│  WebSocket rooms, SSE streams, chunked JSON timeline            │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. A Request's Journey — Start to Finish

Let's trace a single request — a user asking for a list of their checks — all the way through the system.

**The browser sends:** `GET /api/v1/checks?page=1&limit=10`

1. **`requestId` middleware** generates a UUID (`abc-123`) and attaches it to the request object. It also sets an `X-Request-Id: abc-123` response header. Every log line and every error response will carry this ID, making it trivial to trace a single request through all logs.

2. **`requestLogger` middleware** records the start time and registers a callback to log the result when the response finishes.

3. **`helmet`** sets security-related HTTP response headers before any content is sent.

4. **`cors`** checks that the request origin is on the allowed list. If not, it rejects the request.

5. **`express.json()`** would parse a JSON request body (not applicable for GET, skipped).

6. **`globalLimiter`** checks how many requests this IP has made in the last minute. If over 200, it returns 429 Too Many Requests.

7. **`/api/v1/checks` router** is matched. Express looks at the routes defined in `check.routes.ts`.

8. **`authGuard()`** middleware extracts the JWT from the `Authorization: Bearer` header or from the `token` cookie, verifies its signature and expiry, and attaches the decoded `{ sub, email, role, tenantId }` to `req.user`.

9. **`validate(ListChecksQuerySchema)`** parses `req.query` against the Zod schema. It confirms `page` is a valid number, `limit` is within bounds, etc.

10. **`checkController.list()`** reads `req.user.tenantId` and `req.query`, calls `checkService.listChecks()`.

11. **`checkService.listChecks()`** calls `checkRepo.findAll(tenantId, query)`.

12. **`checkRepo.findAll()`** builds a Mongoose query that always includes `{ tenantId }` in the filter, runs it with `.lean()` (returns plain objects, not full Mongoose documents — faster and lighter), and returns the paginated results.

13. **`sendPaginated()`** wraps the results in the standard `{ data: { items, total, page, limit, pages } }` envelope and sends a 200 response.

14. **`requestLogger`**'s finish callback fires: it calculates `durationMs`, logs the structured access line, and feeds the duration into the p50/p95 rolling window.

The browser receives a response in ~5–20 ms (local) or ~50–200 ms (Atlas, depending on region).

---

## 5. Config Layer

### 5.1 `env.ts` — Environment Variables

**File:** `src/config/env.ts`

#### User perspective
Users and operators configure the application using a `.env` file (a plain text file with `KEY=value` pairs). They don't touch source code to change the database address or the secret key — they only change the `.env` file.

#### Developer perspective
`process.env` in Node.js is a plain object where every value is a string. If `process.env.PORT` is `"4000"`, it's a string — not the number `4000`. Every part of the codebase that reads an env var would need to parse it, check it's not undefined, and validate its format. That's error-prone and duplicated.

`env.ts` solves this by doing all parsing and validation **once**, at startup, before a single request is handled. It uses **Zod** to define exactly what each variable should look like:

```typescript
const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(31).default(12),
  // ... more fields
});
```

`z.coerce.number()` calls `Number()` on the raw string before checking if it's a valid number — so `"4000"` becomes `4000` automatically.

If any variable is missing or wrong, the process **exits immediately** with a clear list of every problem:

```
[PulseBoard] ❌  Invalid environment variables:
  • MONGO_URI: MONGO_URI is required
  • JWT_SECRET: JWT_SECRET is required
```

This is called **fail-fast**: it's far better to crash at startup with a useful message than to serve traffic for hours and crash mid-request with a cryptic error.

The final `env` object is **frozen** (`Object.freeze`): no module can accidentally write `env.PORT = 9999` at runtime.

#### Key concept: `z.coerce`
`z.coerce.number()` is Zod's way of saying "try to convert the value to a number first". Without `coerce`, Zod would reject the string `"4000"` even though it represents a valid number.

---

### 5.2 `db.ts` — Database Connection

**File:** `src/config/db.ts`

#### User perspective
This file is the "cable" between the application and the database. Users never interact with it, but without it the app cannot store or retrieve any data.

#### Developer perspective
`db.ts` exports two functions:

- **`connectDB()`** — called once in `server.ts` before the HTTP server starts listening. If the connection fails, the process exits (fail-fast again — serving HTTP traffic without a database would result in random 500 errors everywhere).
- **`disconnectDB()`** — called during graceful shutdown to flush any pending writes before the process exits.

```typescript
mongoose.set('strictQuery', true);
```

This line tells Mongoose: "if a query tries to filter on a field that doesn't exist in the schema, ignore that filter rather than passing it through to MongoDB". This prevents accidental broad queries (e.g. a typo in a field name returning all documents).

The file also registers **connection event listeners** so that connection drops and reconnects appear in the logs without any extra polling code:

```typescript
mongoose.connection.on('disconnected', () => {
  logger.warn('[DB] MongoDB disconnected');
});
```

#### Key concept: Mongoose vs MongoDB
**MongoDB** is the actual database server (it stores data). **Mongoose** is a library that sits between the Node.js application and MongoDB, providing schemas (so documents have a known shape), automatic validation, and a JavaScript API. Think of MongoDB as a spreadsheet and Mongoose as the typed form that controls what goes into each cell.

---

### 5.3 `logger.ts` — Application Logging

**File:** `src/config/logger.ts`

#### User perspective
Users see log output when they run `npm run dev`. In production, logs are collected by a log aggregator (Datadog, Loki, CloudWatch, etc.) and are critical for debugging incidents.

#### Developer perspective
`console.log` is not appropriate for production applications — it has no timestamps, no log levels, no structured format, and no way to adjust verbosity per environment. **Pino** is a high-performance structured logger.

The logger strategy switches based on `NODE_ENV`:

- **Development/test**: uses `pino-pretty`, which formats logs with colours and human-readable timestamps — easy to read in a terminal.
- **Production**: emits structured JSON — one JSON object per log line, which log aggregation systems can index and query efficiently.

The exported `logger` singleton is used everywhere in the codebase:

```typescript
logger.info('[DB] Connecting to MongoDB…');
logger.error({ err }, '[Server] Failed to start');
logger.debug({ tenantId }, '[SSE] Client connected');
```

The first argument can be an **object** containing extra context (like `{ err }` or `{ tenantId }`). This is called **structured logging** — instead of `"Error: connection refused"`, you get a searchable JSON field `err` that contains the full error object.

---

## 6. Common Layer — Shared Building Blocks

### 6.1 `errors.ts` — Error Types

**File:** `src/common/errors.ts`

#### User perspective
When something goes wrong, users receive a consistent, structured error message. They never see a raw Node.js stack trace.

#### Developer perspective
Without a shared error hierarchy, each piece of code would return errors in different shapes — sometimes `{ message: "..." }`, sometimes `{ error: "..." }`, sometimes just a string. The global error handler would have no reliable way to determine the HTTP status code.

`errors.ts` defines a base class `AppError` that all domain errors extend:

```typescript
export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,       // e.g. 'NOT_FOUND', 'VALIDATION_ERROR'
    public readonly details?: unknown,  // Zod issue array for validation errors
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}
```

And six concrete subclasses:

| Class | HTTP Status | Code |
|---|---|---|
| `ValidationError` | 400 | `VALIDATION_ERROR` |
| `UnauthorizedError` | 401 | `UNAUTHORIZED` |
| `ForbiddenError` | 403 | `FORBIDDEN` |
| `NotFoundError` | 404 | `NOT_FOUND` |
| `ConflictError` | 409 | `CONFLICT` |
| `InternalError` | 500 | `INTERNAL_ERROR` |

A service throws `new NotFoundError('Check not found')` and the global error handler automatically knows to send a 404 response with the right envelope.

#### Key concept: `extends Error`
In JavaScript/TypeScript, `extends` creates a **subclass** — a specialised version of an existing class. `NotFoundError extends AppError` means every `NotFoundError` IS an `AppError` (and IS also an `Error`). The `instanceof` operator checks this:

```typescript
if (err instanceof AppError) { /* our error, we know its shape */ }
```

---

### 6.2 `http.ts` — Response Envelopes

**File:** `src/common/http.ts`

#### User perspective
Every API response has the same predictable shape — either `{ data: ... }` for success or `{ error: { code, message, details? } }` for failure. Frontend developers and API consumers can write consistent client code that always looks at the same field.

#### Developer perspective
Without shared response helpers, each controller would construct its own response shape. They'd drift apart over time — one might return `{ result: ... }` another `{ payload: ... }`. Consistency is hard to maintain.

`http.ts` exports three functions:

```typescript
// 200 success with a single object
sendSuccess(res, data, statusCode = 200)
// → { "data": { ... } }

// Paginated list with metadata
sendPaginated(res, items, total, page, limit)
// → { "data": { "items": [...], "total": 42, "page": 1, "limit": 20, "pages": 3 } }

// Structured error (used by the error handler)
sendError(res, statusCode, code, message, details?)
// → { "error": { "code": "NOT_FOUND", "message": "Check not found" } }
```

Controllers never call `res.json()` directly — they call one of these three helpers.

---

### 6.3 `paginate.ts` — Pagination Helper

**File:** `src/common/paginate.ts`

#### User perspective
When a user asks for a list of checks, they can add `?page=2&limit=10` to get the second page of ten items. Without pagination, a request for all checks in a large account would return thousands of items and be very slow.

#### Developer perspective
Every `GET` list endpoint needs to parse the same two query parameters — `page` and `limit` — and convert them into a MongoDB `skip` and `limit`. This is always the same calculation so it belongs in a shared helper.

```typescript
export function parsePagination(query: Record<string, unknown>) {
  const page  = Math.max(1, Number(query.page)  || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const skip  = (page - 1) * limit;
  return { page, limit, skip };
}
```

- `Math.max(1, ...)` ensures `page` is never less than 1 (ignores `?page=0` or `?page=-5`).
- `Math.min(100, ...)` caps `limit` at 100 (prevents a request for 100,000 documents).
- `skip = (page - 1) * limit` — to get page 3 of 20 items, you skip the first 40.

---

## 7. Middleware — The Request Pipeline

In Express.js, **middleware** is a function that runs between the incoming request and the route handler. Each middleware can:
- Read or modify `req` (the request object) or `res` (the response object).
- Call `next()` to pass control to the next middleware.
- Call `next(error)` to skip to the global error handler.
- Send a response directly (which ends the chain).

The middleware in `app.ts` runs in the **exact order they are registered**. This order matters enormously — if `cookieParser` ran before `requestId`, the request ID would not be set when cookies are parsed (not a problem here, but illustrates the dependency chain).

---

### 7.1 `requestId.ts` — Request Tracing

**File:** `src/common/middleware/requestId.ts`

Every HTTP request receives a unique identifier before anything else happens. This UUID travels with the request through every log line, every error response, and — if the backend calls other services — through outgoing HTTP headers.

```typescript
export function requestId(req: Request, res: Response, next: NextFunction): void {
  // Honour an ID from an upstream proxy (e.g. API gateway), or generate one.
  const id = (req.headers['x-request-id'] as string) || uuidv4();
  req.requestId = id;             // attach to req so other middleware can read it
  res.setHeader('X-Request-Id', id); // echo it back to the caller
  next();                         // pass control to the next middleware
}
```

**Why does this matter?** When a bug report says "I got an error at 14:32", a developer can search the logs for the specific `requestId` and see every log line that was written during that single request — from authentication to database query to response. Without this, finding the cause of a specific error requires guessing.

---

### 7.2 `requestLogger.ts` — Access Logging

**File:** `src/common/middleware/requestLogger.ts`

#### User perspective
Every request is recorded. If something goes wrong, the access log shows exactly what was called, when, and how long it took.

#### Developer perspective
This middleware does NOT log at the start of the request — it registers a **callback on the response `finish` event**. This means it captures the complete picture: request method, URL, status code, and — most importantly — the actual response time.

```typescript
export function requestLogger(req, res, next) {
  const startMs = Date.now();

  res.on('finish', () => {                   // fires when the response is sent
    const durationMs = Date.now() - startMs;
    recordDuration(durationMs);              // feed the p50/p95 tracker

    logger.info({
      requestId: req.requestId,
      method:    req.method,
      url:       req.originalUrl,
      statusCode: res.statusCode,
      durationMs,
    }, `${req.method} ${req.originalUrl} ${res.statusCode}`);
  });

  next();
}
```

**p50/p95 latency tracking:** The file maintains a circular buffer of the last 500 response times. Every 60 seconds it logs the p50 (median) and p95 (95th-percentile) latency. These statistics tell you: "half of all requests complete in under X ms, and 95% complete in under Y ms." A rising p95 is an early warning sign of a performance problem.

**`res.on('finish', ...)`** is a Node.js event. When Express finishes writing the HTTP response to the network socket, it emits the `'finish'` event on the `res` object. The callback registered here runs at that point.

---

### 7.3 `validate.ts` — Input Validation

**File:** `src/common/middleware/validate.ts`

#### User perspective
If a user sends an API request with a missing or malformed field (e.g. leaving out the `url` when creating a check), they receive a clear 400 error explaining exactly which field is wrong and why — not a cryptic 500 error.

#### Developer perspective
Without validation middleware, every service function would need to check inputs itself. They'd duplicate code, and some checks would inevitably be forgotten, opening security holes (e.g. a `role` field silently accepted and persisted).

```typescript
export function validate(schema: AnyZodObject) {
  return (req, _res, next) => {
    // GET requests carry data in ?query=params, not in the body
    const target = req.method === 'GET' ? req.query : req.body;

    // .strict() makes unknown keys a validation error — prevents
    // clients from sneaking in fields like { role: 'owner' }
    const result = schema.strict().safeParse(target);

    if (!result.success) {
      next(new ValidationError('Validation failed', result.error.issues));
      return;
    }

    // Replace req.body with the parsed data so any Zod transforms
    // (e.g. .trim(), .toLowerCase()) are applied before the handler runs
    if (req.method !== 'GET') req.body = result.data;

    next();
  };
}
```

**Why `.strict()`?** Zod schemas are "pass-through" by default — unknown keys are silently ignored. Calling `.strict()` turns unknown keys into a validation error. This prevents a client from sending `{ "url": "https://example.com", "tenantId": "other-tenant-id" }` on a check-creation request and having the rogue `tenantId` silently persist.

**`safeParse` vs `parse`:** `parse` throws on failure. `safeParse` returns `{ success: true, data }` or `{ success: false, error }`. We use `safeParse` so we can handle the failure gracefully (by calling `next(error)`) rather than letting an uncaught exception propagate.

---

### 7.4 `authGuard.ts` — Authentication & Authorisation

**File:** `src/common/middleware/authGuard.ts`

This is one of the most important files in the codebase. It does two things: **authentication** (who are you?) and **authorisation** (are you allowed to do this?).

#### How JWT authentication works

When a user logs in, the server creates a **JSON Web Token** (JWT) — a cryptographically signed string that encodes the user's identity. The signature uses `JWT_SECRET` so only this server can produce or verify it. The client stores this token and sends it with every subsequent request.

```
Token structure (three parts separated by dots):
  eyJhbGciOiJIUzI1NiJ9       ← Header (algorithm: HS256)
  .eyJzdWIiOiJ1c2VyLWlkIn0   ← Payload (claims: sub, email, role, tenantId)
  .SflKxwRJSMeKKF2QT4fwpMeJ  ← Signature (HMAC-SHA256 of header + payload)
```

`authGuard` calls `jwt.verify(token, env.JWT_SECRET, { issuer, audience })`. If the signature is valid, the expiry has not passed, and the `iss`/`aud` claims match, `verify` returns the decoded payload. If anything is wrong, it throws an exception that we catch and convert to a 401.

#### The role hierarchy

```typescript
const ROLE_HIERARCHY: Record<Role, number> = {
  owner:    4,
  admin:    3,
  operator: 2,
  viewer:   1,
};
```

`authGuard('operator')` allows any user whose role weight is ≥ 2. An `owner` (weight 4) passes. A `viewer` (weight 1) gets a 403 Forbidden. This means you never have to update the guard when you add roles — you just adjust the weights.

```typescript
if (minRole !== undefined && ROLE_HIERARCHY[payload.role] < ROLE_HIERARCHY[minRole]) {
  throw new ForbiddenError(`Requires ${minRole} role or higher`);
}
```

#### Token extraction order

```typescript
// Check HttpOnly cookie first (more secure for browsers)
if (req.cookies?.token) {
  token = req.cookies.token;
} else {
  // Fall back to Authorization: Bearer <token> (for API clients / CLI tools)
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7); // remove "Bearer " prefix
  }
}
```

**Why HttpOnly cookies are safer:** A cookie marked `HttpOnly` cannot be read by JavaScript running on the page. This prevents an attacker who injects malicious scripts into the page (XSS attack) from stealing the user's authentication token. Bearer tokens stored in `localStorage` are vulnerable to XSS; HttpOnly cookies are not.

---

### 7.5 `rateLimit.ts` — Abuse Prevention

**File:** `src/common/middleware/rateLimit.ts`

#### User perspective
Rate limiting prevents a malicious user from hammering the login endpoint with thousands of password guesses per second (a brute-force attack) or flooding the API with requests that would slow it down for everyone else.

#### Developer perspective
Three limiters are defined using `express-rate-limit`:

| Limiter | Window | Max requests | Applied to |
|---|---|---|---|
| `globalLimiter` | 1 minute | 200 | Every route |
| `authLimiter` | 1 minute | 10 | `/api/v1/auth` only |
| `usageLimiter` | 1 minute | 60 | `/api/v1/usage` only |

The limiter uses a **sliding window** — the counter does not reset at the top of every minute; it counts the last 60 seconds from the current moment. This prevents a burst of 200 requests in the last second of one minute window and 200 more in the first second of the next.

When the limit is exceeded, the response is `429 Too Many Requests` with a `Retry-After` header telling the client how long to wait.

---

### 7.6 `errorHandler.ts` — Global Error Handling

**File:** `src/common/middleware/errorHandler.ts`

#### User perspective
No matter what goes wrong internally, the user always receives a consistent, safe JSON error response. They never see a raw Node.js stack trace or internal database error messages.

#### Developer perspective
Express recognises a 4-argument function `(err, req, res, next)` as an **error handler**. When any middleware or route handler calls `next(err)`, Express skips all regular middleware and goes directly to the error handler.

```typescript
export function errorHandler(err, req, res, next) {
  // Branch 1: Our own typed errors — we know exactly what to return
  if (err instanceof AppError) {
    return sendError(res, err.statusCode, err.code, err.message, err.details);
  }

  // Branch 2: Zod validation errors (thrown by .parse() not .safeParse())
  if (err instanceof ZodError) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Validation failed', err.issues);
  }

  // Branch 3: Mongoose validation or duplicate-key error
  if (err instanceof mongoose.Error.ValidationError) {
    return sendError(res, 400, 'VALIDATION_ERROR', err.message);
  }

  // Branch 4: Unknown error — log it (it's a bug) and return a generic 500
  logger.error({ err, requestId: req.requestId }, '[error] Unhandled error');
  return sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred');
}
```

**Why only log 5xx errors?** 4xx errors are client mistakes (bad input, wrong password) — they are expected and normal. Logging every 401 or 404 would drown the logs in noise. 5xx errors are server bugs that need developer attention.

**Security note:** The generic "An unexpected error occurred" message for unknown errors deliberately hides internal details. Showing a raw database error like `MongoServerError: duplicate key error collection: pulseboard.users` would reveal schema information to an attacker.

---

## 8. Type System

### 8.1 `express.d.ts` — Express Augmentation

**File:** `src/types/express.d.ts`

#### Developer perspective
By default, TypeScript's type definition for Express's `Request` object does not include `req.user` or `req.requestId` — they're not part of the Express standard. If `authGuard` assigns `req.user = { sub, email, role, tenantId }`, TypeScript would report an error saying `Property 'user' does not exist on type 'Request'`.

**Module augmentation** solves this. The file extends the Express type definitions with our custom properties:

```typescript
import type { Role } from '../common/middleware/authGuard';

declare global {
  namespace Express {
    interface Request {
      user:          { sub: string; email: string; role: Role; tenantId: string };
      requestId:     string;
      idempotencyKey: string;
    }
  }
}
```

Now TypeScript knows that `req.user.tenantId` is a `string`. If a controller tries to read `req.user.typo`, TypeScript catches it at compile time, before the code runs. This is **one of the biggest benefits of TypeScript** — entire classes of runtime bugs become compile-time errors.

---

## 9. App Wiring

### 9.1 `app.ts` — The Express Application

**File:** `src/app.ts`

`app.ts` creates the Express application and wires together the complete middleware pipeline and all module routers. It is imported by tests (via Supertest) without ever binding a real TCP port.

#### Middleware order — why it matters

```
1. requestId       Must be FIRST — every log line after needs the request ID
2. requestLogger   Second — needs requestId to be set
3. helmet          Security headers — before any content is served
4. cors            Must handle OPTIONS preflight before body parsing
5. compression     After CORS headers are set
6. hpp             Sanitise duplicate query params before handlers read them
7. json parser     Parse request body before validators or controllers
8. cookieParser    Parse cookies before authGuard reads req.cookies.token
9. globalLimiter   After parsing so the limiter can read client identity
── routes ──
10. /healthz /readyz  No auth, no versioning, no rate limit
11. /api/v1 router    All versioned application routes
12. 404 handler       Catches any unmatched routes
13. errorHandler      MUST be last — handles all next(err) calls
```

Each step depends on the previous. If `cookieParser` ran before `requestId`, the request ID would be absent in cookie-related log entries. If `globalLimiter` ran before `json parser`, the limiter could not read a JSON body to extract client identity.

#### The `/api/v1` router

```typescript
const apiRouter = express.Router();
apiRouter.use('/auth',      authLimiter, authRouter);
apiRouter.use('/tenants',   tenantRouter);
apiRouter.use('/checks',    checkRouter);
apiRouter.use('/incidents', incidentRouter);
apiRouter.use('/audit',     auditRouter);
apiRouter.use('/usage',     usageLimiter, usageRouter);
app.use('/api/v1', apiRouter);
```

Rate limiters that apply to a single sub-path (auth, usage) are added here — before the module router — rather than in `rateLimit.ts`. This keeps module-specific configuration in the app wiring file, not spread across individual route files.

#### Health checks

```typescript
app.get('/healthz', (_req, res) => res.status(200).json({ status: 'ok' }));

app.get('/readyz', (_req, res) => {
  const isConnected = mongoose.connection.readyState === 1;
  if (isConnected) res.status(200).json({ status: 'ok',   db: 'connected' });
  else             res.status(503).json({ status: 'fail', db: 'disconnected' });
});
```

`/healthz` (liveness) answers: "Is the process alive?" It always returns 200. Container orchestrators (Kubernetes, ECS) restart a pod if this fails.

`/readyz` (readiness) answers: "Is the app ready to serve real traffic?" It checks the database connection. The orchestrator stops routing traffic to a pod while this returns 503 — useful on cold starts before Mongoose has finished connecting.

---

### 9.2 `server.ts` — The HTTP Server

**File:** `src/server.ts`

`server.ts` is the entry point that actually starts the server. It is **never imported by tests** — only by the `npm run dev` and `npm start` commands.

#### Why separate from `app.ts`?

If `server.ts` were merged with `app.ts`, every test that imports `app` would:
- Attempt to connect to MongoDB.
- Try to bind port 4000 (causing port conflicts when running multiple tests).
- Start the probe scheduler (sending real HTTP requests during tests).

Keeping them separate means `app.ts` is a pure configuration object; `server.ts` owns all the side effects.

#### The bootstrap sequence

```typescript
(async () => {
  await connectDB();                        // 1. Ensure DB is ready

  server.listen(env.PORT, () => {
    wsController = attachWS(server);         // 3. Attach WebSocket server
    startScheduler().then(stop => {
      stopScheduler = stop;                  // 4. Start probe scheduler
    });
    stopIncidentSubscriptions =
      initIncidentSubscriptions();           // 5. Wire probe events → incidents

    // 6. Print startup banner
    logger.info(`Server → http://localhost:${env.PORT}`);
  });
})();                                        // IIFE — async without top-level await
```

**Step 3 must happen after `server.listen()`** because `attachWS` needs the underlying TCP socket to exist for WebSocket upgrade handshakes.

**Step 5 must happen after step 4** because `initIncidentSubscriptions` subscribes to `probe:events`, which the scheduler produces. If subscriptions were wired before the scheduler started, the events the scheduler produces before subscriptions are in place would be missed.

#### Graceful shutdown

```typescript
async function shutdown(signal: string) {
  terminateAllSse();          // end all open SSE streams
  server.close(async () => {
    stopScheduler?.();        // cancel all probe timers
    stopIncidentSubscriptions?.();
    wsController?.close();    // send WS close frames
    await disconnectDB();     // flush pending writes
    process.exit(0);
  });
  server.closeAllConnections(); // close keep-alive sockets immediately
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT',  () => void shutdown('SIGINT'));
```

When Docker or Kubernetes stops a container it sends `SIGTERM`. Without a shutdown handler the process would die instantly, potentially losing in-flight database writes, leaving WebSocket clients with broken connections, and corrupting any streaming responses. The shutdown sequence closes things in the reverse order they were opened.

A 10-second hard-kill timeout ensures the process does not hang forever if a keep-alive connection refuses to close:

```typescript
const killTimer = setTimeout(() => {
  logger.error('Shutdown timed out — forcing exit');
  process.exit(1);
}, 10_000).unref(); // .unref() — timer doesn't prevent the clean exit path
```

`.unref()` on a timer means "don't let this timer alone keep the Node.js event loop running". If the clean shutdown completes successfully (clearing the killTimer), the process can exit normally.

---

## 10. Auth Module

The auth module handles user identity: registering accounts, logging in, and identifying the current user.

### 10.1 `user.model.ts` — User Schema

**File:** `src/modules/auth/user.model.ts`

```typescript
const UserSchema = new Schema<IUser>({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
  hash:     { type: String, required: true, select: false }, // ← never returned in queries
  role:     { type: String, enum: ['owner','admin','operator','viewer'], default: 'viewer' },
}, { timestamps: true });
```

**`select: false` on `hash`:** By default, Mongoose returns every field when you query a document. Adding `select: false` to the `hash` field means password hashes are **never** returned by a query unless explicitly requested with `.select('+hash')`. This is a defence-in-depth measure — even if a developer forgets to omit the hash from a response, `select: false` prevents it from being included.

**`lowercase: true` and `trim: true`:** Email addresses stored in the database are always lowercase and stripped of surrounding whitespace. This ensures `User@Example.com` and `user@example.com` are treated as the same address.

**`ref: 'Tenant'`:** This tells Mongoose that `tenantId` is a reference to a document in the `Tenant` collection. It enables `.populate('tenantId')` to fetch the full tenant document in a single query.

---

### 10.2 `auth.validation.ts` — Input Schemas

**File:** `src/modules/auth/auth.validation.ts`

```typescript
export const LoginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(8),
});

export const RegisterSchema = LoginSchema.extend({
  name:     z.string().min(1),
  tenantId: z.string().min(1),
});
```

`LoginSchema.extend(...)` creates a new schema that includes all fields from `LoginSchema` plus the additional fields. This prevents duplication — if the password minimum length changes, it changes in one place.

The exported `LoginDto` and `RegisterDto` types are **inferred** from the schemas using `z.infer<typeof LoginSchema>`. This means the TypeScript type is automatically derived from the runtime schema — they can never diverge.

---

### 10.3 `auth.service.ts` — Business Logic

**File:** `src/modules/auth/auth.service.ts`

This file contains the three core authentication operations. It is **HTTP-unaware** — it receives typed DTOs, interacts with the database, and either returns data or throws a typed `AppError`. It knows nothing about cookies or response headers.

#### `register(dto)`

```typescript
// 1. Check email uniqueness — give a clear 409 before the DB does it
const existing = await User.findOne({ email: dto.email }).lean().exec();
if (existing) throw new ConflictError('Email is already registered');

// 2. Hash the password — NEVER store plaintext
const hash = await bcrypt.hash(dto.password, env.BCRYPT_ROUNDS);

// 3. Create the user with the lowest privilege role
const created = await User.create({ tenantId, email, hash, role: 'viewer' });
```

**Why hash the password in the service, not in the model?** Using a pre-save hook in the model mixes infrastructure (database) with security (hashing). If the model is used in a context where hashing should not happen (e.g. tests with a pre-hashed value), the hook fires anyway. Keeping hashing in the service keeps the model thin and predictable.

**Why bcrypt with 12 rounds?** The "rounds" (also called the "cost factor") control how many times the hashing algorithm iterates. Each additional round doubles the computation time. With 12 rounds, hashing a password takes ~250 ms on modern hardware. An attacker trying to brute-force stolen password hashes would need 250 ms per attempt, making it infeasible to try billions of guesses.

#### `login(dto)`

```typescript
// 1. Fetch user WITH hash (normally excluded)
const user = await User.findOne({ email: dto.email }).select('+hash').lean().exec();

// 2. IMPORTANT: same error for "not found" AND "wrong password"
if (!user) throw new UnauthorizedError('Invalid email or password');

// 3. Timing-safe comparison
const match = await bcrypt.compare(dto.password, user.hash);
if (!match) throw new UnauthorizedError('Invalid email or password');

// 4. Sign the JWT with minimum necessary claims
const token = jwt.sign(
  { sub: user._id.toString(), email, role, tenantId },
  env.JWT_SECRET,
  { expiresIn: ttlToSeconds(env.JWT_TTL), issuer: 'pulseboard', audience: 'pulseboard-api' },
);
```

**Why the same error for not-found and wrong-password?** If "user not found" returned a different error than "wrong password", an attacker could use the difference to test which email addresses have accounts (**user enumeration**). By returning `'Invalid email or password'` in both cases, the attacker learns nothing.

**`issuer` and `audience`:** These claims in the JWT tell the verifier: "this token was issued by `pulseboard` for the `pulseboard-api` audience." If a token issued for a different purpose (e.g. a mobile app) is used against this API, the `audience` check fails and the token is rejected.

---

### 10.4 `auth.controller.ts` — HTTP Handlers

**File:** `src/modules/auth/auth.controller.ts`

Controllers are "thin" — they handle only HTTP concerns.

```typescript
export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { token, user } = await authService.login(req.body);

    // Set an HttpOnly cookie so JS can't read it (XSS protection)
    res.cookie('token', token, {
      httpOnly: true,
      secure:   env.NODE_ENV === 'production', // HTTPS only in prod
      sameSite: 'lax',                         // CSRF protection
      maxAge:   ttlToMs(env.JWT_TTL),
    });

    sendSuccess(res, { token, user });
  } catch (err) {
    next(err); // forward to global error handler
  }
}
```

**`secure: env.NODE_ENV === 'production'`:** The `Secure` cookie flag means "only send this cookie over HTTPS". In development, we run over plain HTTP so we disable it; in production, it must be enabled to prevent the token being intercepted over unencrypted connections.

**`sameSite: 'lax'`:** The `SameSite` attribute controls when the browser sends the cookie with cross-site requests. `'lax'` (the default in modern browsers) prevents the cookie from being sent on cross-site `POST` requests — a protection against **Cross-Site Request Forgery (CSRF)** attacks.

---

### 10.5 `auth.routes.ts` — Route Declarations

**File:** `src/modules/auth/auth.routes.ts`

```typescript
router.post('/register', validate(RegisterSchema), register);
router.post('/login',    validate(LoginSchema),    login);
router.post('/logout',                             logout);
router.get('/me',        authGuard(),              me);
```

This file is deliberately kept tiny. It only declares which HTTP verbs and paths map to which middlewares and handlers. All logic lives in other files.

---

## 11. Tenant Module

A **tenant** in PulseBoard is an isolated workspace — a brand, a client, or a team. One user can belong to multiple tenants (e.g. a manager overseeing several brands). The tenant module creates and lists these workspaces.

### 11.1 `tenant.model.ts` — Tenant Schema

```typescript
const TenantSchema = new Schema<ITenant>({
  name:    { type: String, required: true, trim: true, maxlength: 100 },
  slug:    { type: String, required: true, unique: true, lowercase: true, trim: true },
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });
```

The `slug` is a URL-friendly identifier (e.g. `"acme-corp"`). It is unique, lowercase, and contains only letters, numbers, and hyphens. It is used in URLs and as a human-readable tenant identifier.

---

### 11.2 `membership.model.ts` — Membership Schema

**File:** `src/modules/tenant/membership.model.ts`

The `Membership` collection is a **join table** — a bridge between Users and Tenants. Rather than storing a user's tenants as an array on the User document, each user-tenant pair gets its own Membership document:

```typescript
const MembershipSchema = new Schema<IMembership>({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  userId:   { type: Schema.Types.ObjectId, ref: 'User',   required: true },
  role:     { type: String, enum: [...], required: true },
  joinedAt: { type: Date, default: Date.now },
});

MembershipSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
MembershipSchema.index({ userId: 1 }); // fast lookup of "my tenants"
```

The compound unique index on `{ tenantId, userId }` at the database level enforces that a user can only have one membership per tenant — even if there is a bug in the service that tries to insert a duplicate.

---

### 11.3 `tenant.validation.ts` — Input Schemas

```typescript
export const CreateTenantSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  slug: z.string().min(1).max(50)
         .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers, and hyphens'),
});
```

The regex `^[a-z0-9-]+$` rejects slugs containing spaces, uppercase letters, underscores, or special characters. This is validated at the API layer so invalid slugs never reach the database.

---

### 11.4 `tenant.service.ts` — Business Logic

**File:** `src/modules/tenant/tenant.service.ts`

```typescript
export async function createTenant(dto: CreateTenantDto, actorId: string) {
  // Check slug uniqueness (application-level check gives a clearer error than DB)
  const existing = await Tenant.findOne({ slug: dto.slug }).lean().exec();
  if (existing) throw new ConflictError(`Slug '${dto.slug}' is already taken`);

  // Create the tenant
  const tenant = await Tenant.create({ ...dto, ownerId: actorId });

  // Automatically create an owner membership
  await Membership.create({ tenantId: tenant._id, userId: actorId, role: 'owner' });

  // Fire-and-forget audit log — never throws
  await auditService.log({
    tenantId:         tenant._id.toString(),
    actorId,
    action:           'tenant.created',
    targetCollection: 'tenants',
    targetId:         tenant._id.toString(),
    meta:             { slug: dto.slug },
  });

  return toPublic(tenant);
}
```

Creating a tenant also automatically creates an owner membership. The creator always becomes the owner of the workspace they created. This happens in the service layer — not in the controller — because it's a business rule, not an HTTP concern.

---

### 11.5 `tenant.controller.ts` & `tenant.routes.ts`

The controller reads `req.user.sub` (the creator's user ID from the JWT) and passes it to the service. The routes file wires:

```typescript
router.post('/', authGuard('admin'), validate(CreateTenantSchema), create);
router.get('/',  authGuard(),                                       list);
```

Only `admin` and `owner` roles can create tenants. Any authenticated user can list the tenants they belong to (for a workspace-switcher UI).

---

## 12. Check Module

A **check** is a configured HTTP probe: "visit `https://example.com` every 30 seconds and expect a 200 response in under 500 ms". The check module handles the CRUD API; the scheduler (section 13) handles the actual probing.

### 12.1 `check.model.ts` — Check Schema

```typescript
const CheckSchema = new Schema<ICheck>({
  tenantId:       { type: Schema.Types.ObjectId, required: true },
  name:           { type: String, required: true, trim: true },
  url:            { type: String, required: true },
  expectedStatus: { type: Number, default: 200 },
  maxLatencyMs:   { type: Number, required: true },
  enabled:        { type: Boolean, default: true },
  lastResult: {
    ok:         Boolean,
    statusCode: Number,
    latencyMs:  Number,
    checkedAt:  Date,
    error:      String,
  },
}, { timestamps: true });

CheckSchema.index({ tenantId: 1, createdAt: -1 });
CheckSchema.index({ name: 'text' }); // enables text search with ?q=...
```

`lastResult` is a **denormalized** field — it stores the result of the most recent probe directly on the check document. This means displaying a list of checks with their current status requires a single database query (rather than a join with a separate probe-results collection). The trade-off is that historical probe data is not stored — only the latest result.

**Text index:** MongoDB's text index allows full-text search on the `name` field. When the API receives `?q=prod`, the query becomes `{ $text: { $search: 'prod' } }` — this matches any check whose name contains the word "prod".

---

### 12.2 `check.validation.ts` — Input Schemas

```typescript
export const CreateCheckSchema = z.object({
  name:           z.string().min(1).max(200).trim(),
  url:            z.string().url('Must be a valid URL'),
  expectedStatus: z.number().int().min(100).max(599).default(200),
  maxLatencyMs:   z.number().int().min(1),
  enabled:        z.boolean().default(true),
});

export const UpdateCheckSchema = CreateCheckSchema.partial(); // all fields optional

export const ListChecksQuerySchema = z.object({
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(100).default(20),
  q:      z.string().optional(),
  status: z.enum(['enabled', 'disabled']).optional(),
  sort:   z.string().optional(),
});
```

`.partial()` makes every field optional — useful for `PATCH` requests where you only send the fields you want to update.

`z.string().url()` validates that the value looks like a real URL (has a scheme, a host, etc.). A request with `url: "not-a-url"` gets rejected with a clear validation error.

---

### 12.3 `check.repo.ts` — Database Layer

**File:** `src/modules/check/check.repo.ts`

The repository is the **only** place that talks to the database. Every function takes `tenantId` as its first argument and includes it in every query — this is the enforcement point for multi-tenant isolation.

```typescript
export async function findAll(tenantId: string, query: ListChecksQueryDto) {
  const { page, limit, skip } = parsePagination(query);

  const filter: FilterQuery<ICheck> = { tenantId };

  // Full-text search
  if (query.q) filter.$text = { $search: query.q };

  // Status filter
  if (query.status === 'enabled')  filter.enabled = true;
  if (query.status === 'disabled') filter.enabled = false;

  // Sort direction
  const sort: Record<string, 1 | -1> = query.sort?.startsWith('-')
    ? { [query.sort.slice(1)]: -1 }
    : { [query.sort ?? 'createdAt']: -1 };

  const [items, total] = await Promise.all([
    Check.find(filter).sort(sort).skip(skip).limit(limit).lean().exec(),
    Check.countDocuments(filter).exec(),
  ]);

  return { items: items.map(toPublic), total, page, limit };
}
```

**`Promise.all`:** This runs two async operations **simultaneously** — the data query and the count query. Without `Promise.all`, they'd run sequentially, doubling the database round-trip time.

**`.lean()`:** Returns plain JavaScript objects instead of full Mongoose document instances. Mongoose documents have many methods attached (`save()`, `validate()`, etc.) that are unnecessary for a read-only list. `.lean()` makes reads significantly faster and lighter.

---

### 12.4 `check.service.ts` — Business Logic & Probe

**File:** `src/modules/check/check.service.ts`

The service wraps the repository and adds:
1. Audit logging on every mutation.
2. Publishing `'checks:changed'` on the pub/sub bus after every create/update/delete, which triggers the scheduler to reload its in-memory check list.
3. The `runProbe` function — the actual HTTP probe logic.

```typescript
export async function runProbe(check: CheckDocument): Promise<ProbeResult> {
  const start = Date.now();
  try {
    const response = await axios.get(check.url, {
      timeout: env.PROBE_TIMEOUT_MS,
      validateStatus: () => true, // don't throw on non-2xx — we want to capture any status
    });
    const latencyMs = Date.now() - start;
    const ok = response.status === check.expectedStatus && latencyMs <= check.maxLatencyMs;
    return { ok, statusCode: response.status, latencyMs };
  } catch (error) {
    // Network error (DNS failure, timeout, connection refused)
    return { ok: false, latencyMs: Date.now() - start, error: String(error) };
  }
}
```

**`validateStatus: () => true`:** By default, Axios throws an error for any non-2xx status code. Returning `true` from `validateStatus` means Axios treats all status codes as successful — we receive the response object regardless. This is essential because a check might have `expectedStatus: 404` (verifying that a deleted page is really gone).

---

### 12.5 `check.controller.ts` & `check.routes.ts`

Controllers are thin:

```typescript
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await listChecks(req.user.tenantId, req.query as ListChecksQueryDto);
    sendPaginated(res, result.items, result.total, result.page, result.limit);
  } catch (err) {
    next(err);
  }
}
```

The controller reads only from `req` and writes only to `res`. It does not contain any if/else business logic.

Routes:

```typescript
router.get('/',    authGuard(), validate(ListChecksQuerySchema), list);
router.post('/',   authGuard(), validate(CreateCheckSchema),     create);
router.get('/:id', authGuard(),                                  getById);
router.patch('/:id', authGuard(), validate(UpdateCheckSchema),   update);
router.delete('/:id', authGuard('operator'),                     remove);
```

`DELETE` requires `operator` role. The business rationale: a `viewer` should be able to see checks but must not accidentally or maliciously delete them.

---

## 13. The Scheduler — Automated HTTP Probing

**File:** `src/scheduler.ts`

This is the "heartbeat" of PulseBoard — the background process that visits every enabled check URL on a timer and reports the results.

#### Startup sequence

```typescript
export async function startScheduler() {
  // Subscribe to mutations so we reload when checks change
  subscribe('checks:changed', handleChecksChanged);

  // Load all enabled checks and start their timers
  await reloadChecks();

  return stopScheduler; // return cleanup function for graceful shutdown
}
```

#### Loading and scheduling checks

```typescript
async function reloadChecks() {
  // Cancel all existing timers (prevents duplicate probes after reload)
  for (const timer of timers.values()) clearInterval(timer);
  timers.clear();
  checkSnapshots.clear();

  // Fetch only enabled checks
  const checks = await Check.find({ enabled: true }).lean().exec();

  for (const check of checks) {
    scheduleCheck(check);
  }
}

function scheduleCheck(check: ScheduledCheck) {
  // Store a snapshot of the current lastResult for state comparison
  checkSnapshots.set(check._id.toString(), check.lastResult?.ok);

  // Jitter: random delay before the first probe to prevent all checks
  // firing simultaneously on startup ("thundering herd")
  const jitter = Math.random() * 5_000;

  setTimeout(() => {
    // Probe immediately after jitter delay
    void probeAndHandle(check);

    // Then probe on a regular interval
    const timer = setInterval(() => void probeAndHandle(check), env.CHECK_INTERVAL_MS);
    timers.set(check._id.toString(), timer);
  }, jitter);
}
```

**Why jitter?** If 100 checks are scheduled at exactly the same time, 100 outbound HTTP requests fire simultaneously. This spikes outbound bandwidth, may trigger rate-limiting on monitored services, and makes the scheduler's database writes contend. A random 0–5 second delay distributes the load evenly.

#### State transition detection

```typescript
async function handleProbeResult(check: ScheduledCheck, result: ProbeResult) {
  const prevOk = checkSnapshots.get(check._id.toString());
  const newOk  = result.ok;

  // Persist the latest result to the database
  await Check.findByIdAndUpdate(check._id, { lastResult: { ...result, checkedAt: new Date() } });

  // Detect state transitions — only emit events when the state CHANGES
  if (prevOk !== false && !newOk) {
    // Was passing (or never run) — now failing → open an incident
    publish('probe:events', { event: 'check:fail', checkId: ..., tenantId: ... });
  } else if (prevOk === false && newOk) {
    // Was failing — now passing → resolve the incident
    publish('probe:events', { event: 'check:recover', checkId: ..., tenantId: ... });
  }
  // Same state → no event → no duplicate incident creation

  // Update the in-memory snapshot for the next comparison
  checkSnapshots.set(check._id.toString(), newOk);
}
```

**Why deduplicate events?** Without deduplication, every probe of a failing check would emit `check:fail` — creating a new incident every 30 seconds. By comparing the new result with the previous result and only emitting an event when the state **changes**, each failure creates exactly one incident.

---

## 14. Incident Module

An **incident** is an automatically-managed record of an outage. It has a lifecycle: `open` (something is wrong) → `monitoring` (team is watching recovery) → `resolved` (back to normal).

### 14.1 `incident.model.ts` — Incident Schema

```typescript
const IncidentSchema = new Schema<IIncident>({
  tenantId:     { type: Schema.Types.ObjectId, required: true },
  checkId:      { type: Schema.Types.ObjectId, ref: 'Check', required: true },
  status:       { type: String, enum: ['open','monitoring','resolved'], default: 'open' },
  openedAt:     { type: Date, required: true },
  resolvedAt:   { type: Date },
  lastChangeAt: { type: Date, required: true },
  notes: [{
    by:   { type: Schema.Types.ObjectId, ref: 'User' },
    at:   { type: Date, default: Date.now },
    text: { type: String, required: true },
  }],
});

IncidentSchema.index({ tenantId: 1, lastChangeAt: -1 }); // list: sort by most recent
IncidentSchema.index({ checkId: 1 });                    // deduplication lookup
IncidentSchema.index({ tenantId: 1, status: 1 });        // filter by status
```

`notes` is an array of subdocuments. Each note records who added it (`by`), when (`at`), and what they wrote (`text`). Notes are append-only — never modified.

Three indexes are created because the system performs three distinct query patterns:
1. List incidents sorted by recency (requires `tenantId + lastChangeAt` index).
2. Check if an open incident already exists for a check (requires `checkId` index).
3. Filter incidents by status (requires `tenantId + status` index).

---

### 14.2 `incident.validation.ts` — Input Schemas

```typescript
export const UpdateIncidentSchema = z.object({
  status: z.enum(['open','monitoring','resolved']).optional(),
  note:   z.object({ text: z.string().min(1).max(5000) }).optional(),
});
```

Note that the schema allows any status value — the **state machine validation** (which transitions are actually allowed) happens in the service, not the schema. The schema validates the format; the service validates the semantics.

---

### 14.3 `incident.repo.ts` — Database Layer

The deduplication lookup is one of the most important functions:

```typescript
export async function findOpenByCheckId(tenantId: string, checkId: string) {
  return Incident.findOne({
    tenantId,
    checkId,
    status: { $in: ['open', 'monitoring'] },
  }).lean().exec();
}
```

`$in: ['open', 'monitoring']` matches documents where status is either `'open'` or `'monitoring'`. An incident in either of these states is considered "active" — opening a second one for the same check would be a duplicate.

---

### 14.4 `incident.service.ts` — Business Logic

**File:** `src/modules/incident/incident.service.ts`

#### Automatic lifecycle — triggered by the scheduler

```typescript
export async function openIncident(tenantId: string, checkId: string) {
  // Idempotency check — don't create a second incident if one is already open
  const existing = await incidentRepo.findOpenByCheckId(tenantId, checkId);
  if (existing) return; // no-op — incident already exists

  const now = new Date();
  const incident = await incidentRepo.create(tenantId, {
    checkId, status: 'open', openedAt: now, lastChangeAt: now,
  });

  // Append to the audit trail
  await auditService.log({ ..., action: 'incident.opened', targetId: incident._id });

  // Broadcast to all WebSocket and SSE clients watching this tenant
  publish(`incidents:${tenantId}`, {
    event: 'incident:opened', incidentId: incident._id, tenantId, checkId,
  });
}
```

#### Manual lifecycle — triggered by the REST API

```typescript
const ALLOWED_TRANSITIONS: Record<IncidentStatus, Set<IncidentStatus>> = {
  open:       new Set(['monitoring', 'resolved']),
  monitoring: new Set(['resolved']),
  resolved:   new Set(), // terminal — no further transitions
};

export async function updateIncident(tenantId, id, dto, actorId) {
  const incident = await incidentRepo.findById(tenantId, id);
  if (!incident) throw new NotFoundError('Incident not found');

  if (dto.status) {
    const allowed = ALLOWED_TRANSITIONS[incident.status];
    if (!allowed.has(dto.status)) {
      throw new ValidationError(
        `Cannot transition from '${incident.status}' to '${dto.status}'`
      );
    }
  }

  const update: Partial<IIncident> = { lastChangeAt: new Date() };
  if (dto.status) update.status = dto.status;
  if (dto.status === 'resolved') update.resolvedAt = new Date();

  const updated = await incidentRepo.updateById(tenantId, id, update, dto.note);
  publish(`incidents:${tenantId}`, { event: 'incident:updated', incidentId: id, tenantId });
  return updated;
}
```

**The state machine** is defined as a data structure (`ALLOWED_TRANSITIONS`) rather than a chain of `if/else` statements. Adding a new allowed transition only requires adding an entry to the object — no control-flow logic to modify.

#### Wiring to the scheduler

```typescript
export function initIncidentSubscriptions(): () => void {
  const handler: PubSubHandler = (event: ProbeEvent) => {
    if (event.event === 'check:fail') {
      void openIncident(event.tenantId, event.checkId);
    } else if (event.event === 'check:recover') {
      void resolveIncident(event.tenantId, event.checkId);
    }
  };

  subscribe('probe:events', handler);
  return () => unsubscribe('probe:events', handler); // cleanup for graceful shutdown
}
```

`void` before the async calls marks them as intentionally fire-and-forget. We don't `await` them here because the pub/sub handler is synchronous — we dispatch the async operation and return immediately.

---

### 14.5 `incident.controller.ts` & `incident.routes.ts`

The controller includes three streaming handlers in addition to the standard REST handlers:

**`exportIncidents`** — CSV export:
```
Content-Type: text/csv
Content-Disposition: attachment; filename="incidents-2026-01-01-2026-01-31.csv"
```
Uses a Mongoose cursor to stream rows one at a time, so a 10,000-row export never loads all rows into memory simultaneously.

**`streamTimeline`** — delegates to `realtime/stream.ts` for chunked JSON streaming of the audit trail for a specific incident.

**`streamFeed`** — delegates to `realtime/sse.ts` for the SSE incident event stream.

Routes (order matters):

```typescript
router.get('/stream',             incidentController.streamFeed);     // must be before /:id
router.get('/export',   authGuard('viewer'), exportIncidents);        // must be before /:id
router.get('/',         authGuard(), validate(ListIncidentsQuerySchema), list);
router.get('/:id',      authGuard(), getById);
router.patch('/:id',    authGuard('operator'), validate(UpdateIncidentSchema), update);
router.get('/:id/timeline/stream', authGuard(), streamTimeline);
```

`/stream` and `/export` **must** be declared before `/:id`. Express matches routes top-to-bottom. If `/:id` were first, a request to `/stream` would be treated as `{ id: 'stream' }` and try to look up an incident with that ID.

---

## 15. Audit Module

The audit module provides an **append-only, tamper-evident log** of every mutation in the system. If something goes wrong — data changed unexpectedly, a user claims they didn't do something — the audit log provides an authoritative record.

### 15.1 `audit.model.ts` — Audit Log Schema

```typescript
const AuditLogSchema = new Schema({
  tenantId:         { type: Schema.Types.ObjectId, required: true },
  actorId:          { type: Schema.Types.ObjectId, default: null }, // null = system action
  action:           { type: String, required: true }, // e.g. 'check.created'
  targetCollection: { type: String, required: true }, // e.g. 'checks'
  targetId:         { type: String, required: true },
  meta:             { type: Schema.Types.Mixed },     // arbitrary extra context
  ts:               { type: Date, default: Date.now },
}, {
  timestamps: false,  // we manage `ts` ourselves
  versionKey: false,  // no __v field — documents are never updated
});
```

`timestamps: false` and `versionKey: false` reinforce that audit log documents are **never updated**. Mongoose's automatic `updatedAt` and `__v` (version key) fields are disabled because they imply mutability. An audit log that can be updated is not trustworthy.

---

### 15.2 `audit.service.ts` — Log & Query

```typescript
export async function log(entry: AuditEntry): Promise<void> {
  try {
    await AuditLog.create(entry);
  } catch (err) {
    // NEVER throw — an audit log failure must not abort the primary operation
    logger.error({ err }, '[audit] Failed to write audit log');
  }
}
```

**Fire-and-forget with swallowed errors.** If the audit log write fails (e.g. a transient MongoDB hiccup), the user's primary operation (creating a check, opening an incident) still succeeds. This is a deliberate trade-off: the primary operation is more important than the audit trail. In a system where the audit log is legally required (finance, healthcare), you would use a distributed queue to guarantee delivery instead.

---

### 15.3 `audit.controller.ts` & `audit.routes.ts`

```typescript
router.get('/', authGuard('admin'), getAuditLog);
```

Only `admin` and `owner` roles can read the audit log. The controller parses `from`, `to`, `action`, and `targetId` query parameters and passes them to `auditService.query()`.

---

## 16. Usage Module

The usage module ingests arbitrary usage events (page views, feature activations, API calls) from clients. The defining feature is **idempotency** — sending the same event twice produces exactly one record in the database.

### 16.1 `usage.model.ts` — Usage Event Schema

```typescript
const UsageEventSchema = new Schema({
  idempotencyKey: { type: String, required: true, unique: true }, // DB-level dedup
  tenantId:       { type: Schema.Types.ObjectId, required: true },
  kind:           { type: String, required: true },
  payload:        { type: Schema.Types.Mixed },
  ts:             { type: Date, default: Date.now },
}, { timestamps: false, versionKey: false });

UsageEventSchema.index({ idempotencyKey: 1 }, { unique: true });
```

The unique index on `idempotencyKey` at the **database level** is the ultimate enforcement point. Even if multiple server instances receive the same request simultaneously (due to a network retry that arrives before the first one completes), the database's uniqueness constraint ensures only one document is created.

---

### 16.2 `usage.validation.ts` — Input Schemas & Header Guard

```typescript
export const CreateUsageEventSchema = z.object({
  kind:    z.string().min(1).max(100),
  payload: z.record(z.unknown()).optional(),
});

export function requireIdempotencyKey(req, _res, next) {
  const key = req.headers['idempotency-key'];
  if (!key || typeof key !== 'string' || key.trim() === '') {
    return next(new ValidationError('Idempotency-Key header is required'));
  }
  req.idempotencyKey = key.trim();
  next();
}
```

`requireIdempotencyKey` is a middleware function that checks for the `Idempotency-Key` header. If it's missing, it returns a 400 before the handler runs. If present, it attaches the value to `req.idempotencyKey` for the controller to read.

---

### 16.3 `usage.service.ts` — Idempotent Ingestion

```typescript
export async function ingestEvent(tenantId, idempotencyKey, dto) {
  try {
    const event = await UsageEvent.create({ idempotencyKey, tenantId, ...dto });
    return { event, created: true };
  } catch (err: unknown) {
    if (err instanceof MongoServerError && err.code === 11000) {
      // Duplicate key — this is a retry. Return the existing record.
      const existing = await UsageEvent.findOne({ idempotencyKey }).lean().exec();
      return { event: existing, created: false };
    }
    throw err; // unexpected error — propagate it
  }
}
```

**Error code 11000** is MongoDB's error code for a duplicate key violation. When a retry arrives with the same `Idempotency-Key`, the insert fails with this code. The service catches it specifically, fetches the original record, and returns it as if the insert succeeded. The client receives `200 OK` with the original data — their retry was handled correctly and they can move on.

This is the **insert-and-catch** idempotency pattern. The alternative (check-then-insert) has a race condition: two requests with the same key could both pass the check and both attempt the insert. The insert-and-catch pattern relies on the database's atomic uniqueness enforcement to avoid the race.

---

### 16.4 `usage.controller.ts` & `usage.routes.ts`

```typescript
export async function ingest(req, res, next) {
  try {
    const { event, created } = await ingestEvent(
      req.user.tenantId,
      req.idempotencyKey,  // set by requireIdempotencyKey middleware
      req.body,
    );
    sendSuccess(res, event, created ? 201 : 200);
  } catch (err) { next(err); }
}
```

Routes:
```typescript
router.post('/events',
  authGuard(),
  requireIdempotencyKey,      // 400 if header missing
  validate(CreateUsageEventSchema),
  ingest,
);
```

---

## 17. Real-Time Layer

The real-time layer allows the server to **push data to clients** without the client needing to repeatedly ask for updates ("polling"). Three mechanisms are used depending on the use case.

### 17.1 `pubsub.ts` — In-Process Event Bus

**File:** `src/realtime/pubsub.ts`

The pub/sub (publish/subscribe) bus is the glue that decouples the scheduler, the incident service, the WebSocket server, and the SSE handler. None of these modules import each other directly — they communicate only through named channels on the bus.

```typescript
import { EventEmitter } from 'events';

const bus = new EventEmitter();
bus.setMaxListeners(0); // disable the default warning for > 10 listeners

export type PubSubHandler<T = unknown> = (payload: T) => void;

export function publish<T>(channel: string, payload: T): void {
  bus.emit(channel, payload);
}

export function subscribe<T>(channel: string, handler: PubSubHandler<T>): void {
  bus.on(channel, handler);
}

export function unsubscribe<T>(channel: string, handler: PubSubHandler<T>): void {
  bus.off(channel, handler);
}
```

**Why an EventEmitter?** Node.js's built-in `EventEmitter` class is a simple, in-memory pub/sub system. When you call `bus.emit('probe:events', payload)`, every function registered with `bus.on('probe:events', ...)` is called synchronously with the payload. It's fast (no network), reliable (no serialization), and requires zero dependencies.

**The trade-off:** In-process pub/sub only works when all components run in the same Node.js process. If you scale to multiple server instances (horizontal scaling), events published on one instance are not seen by listeners on another instance. For multi-instance scaling, this would need to be replaced with Redis Pub/Sub or NATS.

**Channel conventions:**
- `probe:events` — scheduler → incident service (check:fail / check:recover events)
- `incidents:{tenantId}` — incident service → WebSocket and SSE (lifecycle events)
- `checks:changed` — check service → scheduler (trigger reload after CRUD mutations)

---

### 17.2 `ws.ts` — WebSocket Server

**File:** `src/realtime/ws.ts`

#### What WebSockets are

Regular HTTP is **request/response**: the client asks, the server answers. The connection closes after each exchange. WebSockets are a **persistent, bidirectional** channel: after the initial HTTP handshake ("upgrade"), the connection stays open and either side can send data at any time. This makes them ideal for the operator dashboard, which needs to receive updates the moment an incident opens.

#### Rooms

```typescript
const rooms = new Map<string, Set<LiveSocket>>();
// rooms.get('tenant-abc') → Set of all WebSocket clients watching that tenant
```

When a client connects:
```typescript
wss.on('connection', (ws: LiveSocket, req) => {
  const url = new URL(req.url!, 'http://localhost');
  const tenantId = url.searchParams.get('tenantId') ?? 'public';

  const set = rooms.get(tenantId) ?? new Set<LiveSocket>();
  set.add(ws);
  rooms.set(tenantId, set);

  // Subscribe to incident events for this tenant (first client in room only)
  if (set.size === 1) {
    subscribe(`incidents:${tenantId}`, broadcastToRoom.bind(null, tenantId));
  }

  ws.on('close', () => {
    set.delete(ws);
    if (set.size === 0) {
      rooms.delete(tenantId);
      unsubscribe(`incidents:${tenantId}`, ...);
    }
  });
});
```

#### Heartbeat — detecting dead connections

TCP connections can silently disappear (the browser tab was closed, the mobile device switched networks). The server might not know for minutes. Zombie sockets accumulate in the room and waste memory.

```typescript
const heartbeat = setInterval(() => {
  for (const [, room] of rooms) {
    for (const ws of room) {
      if (!ws.isAlive) {
        ws.terminate(); // forcibly close
        continue;
      }
      ws.isAlive = false; // will be reset when pong arrives
      ws.ping();
    }
  }
}, PING_INTERVAL_MS); // every 30 s
```

Every 30 seconds, the server sends a ping frame to every connected client. The `ws` library automatically responds with a pong. If a client doesn't respond to the ping before the next cycle (meaning `isAlive` is still `false`), it is terminated.

#### Backpressure

```typescript
function broadcastToRoom(tenantId: string, payload: unknown) {
  const room = rooms.get(tenantId);
  if (!room) return;

  const msg = JSON.stringify(payload);
  for (const ws of room) {
    if (ws.readyState !== WebSocket.OPEN) continue;

    // If the send buffer is too large, the client is too slow — skip
    if (ws.bufferedAmount > 64 * 1024) continue; // 64 KB threshold

    ws.send(msg);
  }
}
```

`bufferedAmount` is the number of bytes queued to be sent to the client. If it's above 64 KB, the client's network connection is congested or the client is processing slowly. Continuing to queue data would waste server memory. Instead, the message is dropped for that client — they will see the next event when their buffer drains.

---

### 17.3 `sse.ts` — Server-Sent Events

**File:** `src/realtime/sse.ts`

#### What SSE is

**Server-Sent Events** are a simpler alternative to WebSockets for **one-directional** server-to-client streaming. The browser makes a normal HTTP GET request, but instead of the server sending a complete response and closing the connection, it keeps the connection open and streams lines of text in the SSE format.

This makes SSE perfect for a **public status page** — it requires no authentication, works through any HTTP proxy, and browsers handle reconnection automatically.

#### The SSE protocol format

```
data: {"event":"incident:opened","incidentId":"..."}\n\n   ← event
:\n\n                                                        ← keep-alive comment
data: {"event":"incident:resolved","incidentId":"..."}\n\n  ← event
```

Each message is `data: <content>\n\n` (double newline terminates the event). A line starting with `:` is a comment — ignored by the browser, but it keeps the connection alive and prevents proxy servers from closing idle connections.

#### Handler

```typescript
export function incidentSSE(req: Request, res: Response): void {
  const tenantId = req.query.tenantId as string;
  if (!tenantId) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '...' } });
    return;
  }

  // Set SSE headers BEFORE subscribing
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable Nginx proxy buffering
  res.flushHeaders(); // send headers immediately — browser knows stream is open

  activeSseConnections.add(res); // track for graceful shutdown

  const channel = `incidents:${tenantId}`;
  const handler: PubSubHandler = (payload) => sseWrite(res, payload);
  subscribe(channel, handler);

  // Keep-alive every 20 s — prevents proxy idle timeouts
  const heartbeat = setInterval(() => sseKeepAlive(res), 20_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe(channel, handler); // prevent memory leak
    activeSseConnections.delete(res);
    if (!res.writableEnded) res.end();
  });
}
```

**`res.flushHeaders()`** sends the response headers to the client immediately without waiting for any body. This is required for SSE — the browser needs to receive the `Content-Type: text/event-stream` header to know to treat this as a streaming response.

**`X-Accel-Buffering: no`** instructs Nginx (if present in front of the app) not to buffer the response. Without this, Nginx would wait until a certain amount of data accumulates before forwarding it to the client — breaking the real-time nature of SSE.

**Cleanup on disconnect:** The `'close'` event fires when the client closes the connection (tab closed, navigation, network drop). Without cleanup, the `handler` would remain registered on the pub/sub bus, and the `heartbeat` interval would keep running — both are memory leaks that accumulate over time.

---

### 17.4 `stream.ts` — Streaming HTTP Response

**File:** `src/realtime/stream.ts`

For large datasets (an incident that has hundreds of audit log entries covering days of events), loading everything into memory, serialising it to JSON, and sending it in one response is wasteful. The timeline streaming endpoint sends data **progressively** using a Mongoose cursor.

```typescript
export async function streamTimeline(req: Request, res: Response) {
  const { id } = req.params;
  const tenantId = req.user.tenantId;

  // Verify the incident exists and belongs to this tenant
  const incident = await Incident.findOne({ _id: id, tenantId }).lean().exec();
  if (!incident) throw new NotFoundError('Incident not found');

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.write('{"items":[');

  let first = true;
  const cursor = AuditLog
    .find({ targetId: id, tenantId })
    .sort({ ts: 1 })
    .cursor(); // ← Mongoose cursor: one document at a time

  for await (const doc of cursor) {
    if (res.writableEnded) break; // client disconnected mid-stream

    res.write((first ? '' : ',') + JSON.stringify(toPublic(doc)));
    first = false;
  }

  if (!res.writableEnded) {
    res.write(']}');
    res.end();
  }
}
```

**`Transfer-Encoding: chunked`:** HTTP/1.1 allows the server to send a response in pieces (chunks) without knowing the total size upfront. Each chunk is prefixed with its size in hexadecimal. The browser reassembles the chunks and parses the complete JSON when `res.end()` is called.

**`.cursor()`:** Instead of loading all matching documents into an array, a Mongoose cursor fetches one document at a time from the database, waits for `res.write()` to drain, then fetches the next. Memory usage stays constant regardless of result set size.

**`res.writableEnded` guard:** If the client disconnects mid-stream (navigates away), the cursor loop checks `res.writableEnded` and exits cleanly without throwing errors.

---

## 18. The Full Event Flow — From Probe Failure to Browser

Let's trace the complete flow when a monitored service goes down:

```
1. SCHEDULER (scheduler.ts)
   setInterval fires → probeAndHandle(check) is called

2. runProbe() (check.service.ts)
   axios.get('https://example.com', { timeout: 10000, validateStatus: () => true })
   ← Connection refused (the site is down)
   Returns: { ok: false, latencyMs: 10001, error: 'connect ECONNREFUSED' }

3. handleProbeResult() (scheduler.ts)
   prevOk was undefined (first probe) or true (was passing)
   newOk is false
   prevOk !== false && !newOk → TRANSITION to fail

   publish('probe:events', {
     event: 'check:fail',
     checkId: 'abc123',
     tenantId: 'tenant-xyz',
   });

4. initIncidentSubscriptions handler (incident.service.ts)
   Receives 'probe:events' event
   Calls: openIncident('tenant-xyz', 'abc123')

5. openIncident() (incident.service.ts)
   findOpenByCheckId('tenant-xyz', 'abc123') → null (no existing incident)
   Incident.create({ status: 'open', openedAt: now, ... })
   auditService.log({ action: 'incident.opened', ... }) ← fire and forget

   publish('incidents:tenant-xyz', {
     event: 'incident:opened',
     incidentId: 'inc-456',
     tenantId: 'tenant-xyz',
     checkId: 'abc123',
   });

6a. WebSocket broadcast (ws.ts)
    Room 'tenant-xyz' has 2 connected dashboard clients
    broadcastToRoom('tenant-xyz', { event: 'incident:opened', ... })
    → ws.send(JSON.stringify(payload)) to both clients
    → Dashboard updates INSTANTLY — the red incident card appears

6b. SSE broadcast (sse.ts)
    The tenant's public status page has 1 SSE connection
    handler({ event: 'incident:opened', ... }) is called
    res.write('data: {"event":"incident:opened",...}\n\n')
    → Status page shows "OUTAGE" status in real time
```

The entire flow from the probe returning a failure to the browser updating typically takes **under 100 milliseconds** — fast enough to appear instant to users.

---

## 19. Database Design at a Glance

```
┌─────────────────┐     ┌──────────────────┐     ┌───────────────────────┐
│   tenants       │────<│   memberships    │>────│   users               │
│─────────────────│     │──────────────────│     │───────────────────────│
│ _id             │     │ tenantId (FK)    │     │ _id                   │
│ name            │     │ userId   (FK)    │     │ tenantId (FK)         │
│ slug (unique)   │     │ role             │     │ email (unique)        │
│ ownerId (FK)    │     │ joinedAt         │     │ hash (select: false)  │
│ createdAt       │     └──────────────────┘     │ role                  │
└─────────────────┘                              │ createdAt, updatedAt  │
         │                                       └───────────────────────┘
         │
         │  (tenantId on every document below)
         │
┌─────────────────┐     ┌──────────────────┐     ┌───────────────────────┐
│   checks        │────<│   incidents      │     │   audit_logs          │
│─────────────────│     │──────────────────│     │───────────────────────│
│ _id             │     │ _id              │     │ _id                   │
│ tenantId        │     │ tenantId         │     │ tenantId              │
│ name            │     │ checkId (FK) ───>│     │ actorId (nullable)    │
│ url             │     │ status           │     │ action                │
│ expectedStatus  │     │ openedAt         │     │ targetCollection      │
│ maxLatencyMs    │     │ resolvedAt?      │     │ targetId              │
│ enabled         │     │ lastChangeAt     │     │ meta                  │
│ lastResult?     │     │ notes[]          │     │ ts                    │
│ createdAt       │     └──────────────────┘     └───────────────────────┘
└─────────────────┘

┌───────────────────────────────────────────┐
│   usage_events                            │
│───────────────────────────────────────────│
│ idempotencyKey (unique)                   │
│ tenantId                                  │
│ kind                                      │
│ payload                                   │
│ ts                                        │
└───────────────────────────────────────────┘
```

**Key rules enforced at both app and DB level:**
- Every document (except `tenants` and `memberships`) has a `tenantId` field.
- Every repository query adds `{ tenantId }` to the filter — no unscoped queries exist.
- Unique indexes enforce uniqueness at the DB level even if the app has a bug.
- `.lean()` is used on all read queries for performance.
- No `updatedAt` on `audit_logs` or `usage_events` — these are append-only.

---

## 20. Security Architecture

Every layer of the application contributes to security:

| Layer | Mechanism | Defends against |
|---|---|---|
| OS / network | TLS, MongoDB IP allowlist | Eavesdropping, external DB access |
| HTTP headers | `helmet()` + CSP | Clickjacking, MIME-sniffing, XSS |
| CORS | Allow only `CORS_ORIGIN` | Cross-origin data theft |
| Rate limiting | Global 200/min, auth 10/min, usage 60/min | Brute-force, DDoS |
| Input validation | Zod `.strict()` on every route | Injection, unexpected fields |
| Authentication | JWT with `iss`/`aud`, short TTL (15 min) | Token forgery, replay attacks |
| Cookie transport | `HttpOnly`, `Secure`, `SameSite: lax` | XSS token theft, CSRF |
| Authorisation | Role hierarchy guard on every protected route | Privilege escalation |
| Password storage | bcrypt with 12 rounds, `select: false` on hash | Offline brute-force |
| Tenant isolation | `tenantId` in every DB query | Cross-tenant data leakage |
| Error responses | Generic 500 message, never expose internals | Information disclosure |
| Audit trail | Append-only log on every mutation | Tamper evidence, forensics |

---

## 21. Future Upgrades & Limitations

### Current Limitations

#### 1. Single-process pub/sub
The in-process `EventEmitter` pub/sub works perfectly for a single server instance. However, if you run two or more instances (horizontal scaling for high availability or traffic handling), an event published on Instance A is not seen by subscribers on Instance B. A check that opens an incident on Instance A would broadcast to WebSocket clients connected to Instance A only — clients on Instance B would never receive the update.

**Upgrade path:** Replace `pubsub.ts` with Redis Pub/Sub (using `ioredis` or `redis` npm packages). The interface (`publish`, `subscribe`, `unsubscribe`) is already abstracted — only the implementation inside `pubsub.ts` would change. No other file would need to be modified.

#### 2. Single-process scheduler
The probe scheduler runs on every server instance. With horizontal scaling, each instance would independently probe every check — tripling the outbound HTTP traffic if there are three instances, and creating duplicate incidents.

**Upgrade path:** Either (a) run the scheduler in a dedicated worker process and communicate with the API servers via the shared Redis pub/sub, or (b) use a distributed lock (Redis `SET NX PX` or `redlock`) so only one instance holds the scheduler lock at a time. The `startScheduler` / `stopScheduler` interface already supports being called from `server.ts` conditionally.

#### 3. No probe history
`check.lastResult` stores only the **most recent** probe result. There is no time-series store of historical probe data. Users cannot see a chart of the last 24 hours of response times for a check.

**Upgrade path:** Add a `probe_results` collection that appends every result. For long-term storage, use MongoDB's TTL indexes (`expireAfterSeconds`) to automatically delete records older than N days. For serving charts, aggregate with MongoDB's `$group` pipeline on time buckets (5-minute averages).

#### 4. No JWT refresh tokens
JWTs expire after `JWT_TTL` (default 15 minutes). When they expire, users are logged out. There is no refresh token mechanism to silently renew a session.

**Upgrade path:** Issue a short-lived access token (15 min JWT) and a long-lived refresh token (7-day opaque random string stored in the database in a `refresh_tokens` collection). Add a `POST /auth/refresh` endpoint that validates the refresh token and issues a new access token.

#### 5. No WebSocket authentication
The WebSocket server accepts any `tenantId` from the query string without verifying it belongs to the connecting user. An authenticated user for Tenant A could connect as Tenant B and receive Tenant B's incident events.

**Upgrade path:** Parse and verify a JWT from the WebSocket handshake URL or headers. In `ws.ts`'s `upgrade` event handler (before the connection is accepted), call `jwt.verify(token, env.JWT_SECRET)` and reject connections where the token's `tenantId` doesn't match the requested room.

#### 6. No email / webhook notifications
Currently, incident alerts are only visible in the dashboard (WebSocket) or on a status page (SSE). There are no outbound notifications — no email, Slack, PagerDuty, or webhook when an incident opens.

**Upgrade path:** Subscribe to `'probe:events'` in a new `notifications.service.ts`. When a `check:fail` event arrives, look up the tenant's notification preferences (a new collection) and dispatch notifications using a third-party email API (SendGrid, Resend) or webhook `POST` requests.

#### 7. In-memory rate limiting
`express-rate-limit` uses an in-memory store by default. When the server restarts, all rate-limit counters reset. With horizontal scaling, each instance has its own counters — a client could send 200 requests to Instance A and 200 more to Instance B, bypassing the intended 200/min limit.

**Upgrade path:** Replace the default store with `rate-limit-redis` which stores counters in Redis. This is a one-line change in `rateLimit.ts`.

#### 8. No check alert thresholds (consecutive failures)
A check is considered "down" after a single failed probe. A transient network blip — one timeout that immediately recovers — would open an incident.

**Upgrade path:** Add a `failureThreshold` field to the Check model (e.g. `3`). In the scheduler's `handleProbeResult`, only emit `check:fail` after `N` consecutive failures. Track a `consecutiveFailures` counter in `checkSnapshots`.

---

### Future Upgrade Possibilities

#### Multi-region scheduling
Deploy the scheduler to multiple geographic regions (e.g. us-east, eu-west, ap-southeast). Each region independently probes checks from its location. This validates that a service is accessible globally (not just from one region) and reduces probe latency.

#### Real-time latency charts
Add a `GET /api/v1/checks/:id/metrics` endpoint that returns aggregated probe data (p50, p95, p99 latency over configurable time windows). The frontend can render these as time-series charts using a charting library.

#### Status page as a product feature
The current public SSE feed exposes raw incident events. A dedicated `GET /api/v1/status/:slug` endpoint could return a pre-formatted status page response (current check statuses, active incidents, recent history), consumable by a framework-agnostic embedded status widget or a fully hosted status page.

#### Webhook integrations
Add a `webhooks` collection: `{ tenantId, url, secret, events: ['incident.opened', ...] }`. When a matching event is published on the pub/sub bus, make a signed `POST` request to the configured URL. This enables PagerDuty, OpsGenie, Slack, and any custom webhook receiver to receive incident events.

#### Role-based check visibility
Currently, all authenticated users in a tenant can see all checks. A finer-grained model where checks can be tagged to specific teams (sub-groups within a tenant) and users can be restricted to their team's checks is a natural evolution for larger organisations.

#### Audit log export
The audit log is currently only queryable via REST API. Adding `GET /api/v1/audit/export` (similar to the incident CSV export) would allow compliance teams to download the complete audit trail for a given period.

#### Prometheus / OpenTelemetry metrics
The p50/p95 latency tracker in `requestLogger.ts` logs to the application log. For production observability, expose a `GET /metrics` endpoint in Prometheus format (using `prom-client`). This allows Grafana dashboards to visualise request rates, error rates, and latency without parsing log files.

---

*This document covers every file in the PulseBoard backend as of Phase 15. As the codebase evolves, update the relevant section to keep this document in sync.*
