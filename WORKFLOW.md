# PulseBoard Backend — Implementation Workflow

> **Stack:** Node.js LTS · Express.js · TypeScript (strict) · MongoDB Atlas (Mongoose) · Zod · WebSockets · SSE · Jest/Supertest
> **Port:** `4000` · **Package manager:** `npm`

This document defines the exact, ordered sequence of implementation steps. No step should be started until its prerequisites are complete. Each phase is a discrete, testable milestone.

---

## Phase 0 — Toolchain Bootstrap

**Goal:** A fully configured, compilable, lint-clean, test-runnable empty project before a single domain line is written.

### Steps

1. **Install dependencies**

   ```bash
   npm install   # installs from package.json already created
   ```

2. **TypeScript config (`tsconfig.json`)**
   - `"strict": true`, `"target": "ES2022"`, `"module": "CommonJS"`
   - `"outDir": "dist"`, `"rootDir": "src"`
   - `"resolveJsonModule": true`, `"esModuleInterop": true`
   - `"skipLibCheck": true`, `"forceConsistentCasingInFileNames": true`
   - Exclude `dist`, `node_modules`, `tests`

3. **ESLint config (`eslint.config.js` — flat config)**
   - Parser: `@typescript-eslint/parser`
   - Plugin: `@typescript-eslint/eslint-plugin`
   - Extends: `plugin:@typescript-eslint/recommended`, `eslint-config-prettier`
   - Rules: `no-console` warn, `@typescript-eslint/no-explicit-any` warn, `@typescript-eslint/explicit-function-return-type` off

4. **Prettier config (`.prettierrc`)**
   - `printWidth: 100`, `singleQuote: true`, `trailingComma: 'all'`, `semi: true`

5. **Husky + lint-staged**

   ```bash
   npx husky init
   ```

   - Pre-commit hook: `npx lint-staged`
   - Pre-push hook: `npm run typecheck && npm test -- --passWithNoTests`

6. **Jest config (`jest.config.ts`)**
   - Preset: `ts-jest`
   - `testEnvironment: 'node'`
   - `testMatch: ['**/tests/**/*.test.ts']`
   - `coverageDirectory: 'coverage'`
   - `collectCoverageFrom: ['src/**/*.ts']`

7. **`.env` and `.env.example`**

   ```env
   NODE_ENV=development
   PORT=4000
   MONGODB_URI=mongodb+srv://<user>:<pass>@<cluster>/pulseboard
   JWT_SECRET=change-me-to-a-long-random-string
   JWT_TTL=15m
   CORS_ORIGIN=http://localhost:3000
   BCRYPT_ROUNDS=12
   CHECK_INTERVAL_MS=30000
   ```

   - Add `.env` to `.gitignore`; commit only `.env.example`

8. **Create full `src/` directory skeleton** (empty files/folders, no logic yet)

   ```
   src/
     app.ts
     server.ts
     config/
       env.ts, db.ts, logger.ts
     common/
       http.ts
       errors.ts
       paginate.ts
       middleware/
         validate.ts
         errorHandler.ts
         authGuard.ts
         rateLimit.ts
         requestId.ts
     realtime/
       ws.ts
       sse.ts
       stream.ts
       pubsub.ts
     modules/
       auth/
         auth.routes.ts, auth.controller.ts, auth.service.ts,
         auth.validation.ts, user.model.ts
       tenant/
         tenant.model.ts, membership.model.ts,
         tenant.service.ts, tenant.routes.ts, tenant.controller.ts
       check/
         check.routes.ts, check.controller.ts, check.service.ts,
         check.repo.ts, check.model.ts, check.validation.ts
       incident/
         incident.routes.ts, incident.controller.ts, incident.service.ts,
         incident.repo.ts, incident.model.ts, incident.validation.ts
       audit/
         audit.model.ts, audit.service.ts
       usage/
         usage.routes.ts, usage.controller.ts, usage.service.ts,
         usage.model.ts, usage.validation.ts
     types/
       express.d.ts
   tests/
     fixtures/
       seed.ts
     auth/
       auth.test.ts
     check/
       check.test.ts
     incident/
       incident.test.ts
     usage/
       idempotency.test.ts
     realtime/
       sse.test.ts
   ```

9. **Smoke-check Phase 0**

   ```bash
   npm run typecheck   # zero errors
   npm run lint        # zero errors
   npm test            # passes (no tests yet, --passWithNoTests)
   ```

---

## Phase 1 — Config Layer

**Goal:** All configuration (env, DB, logger) is centralised and typed; nothing hard-codes values.

### Steps

1. **`src/config/env.ts`**
   - Parse and validate all env vars at startup using Zod
   - Export a typed `env` object; throw on missing required vars
   - Fields: `NODE_ENV`, `PORT`, `MONGODB_URI`, `JWT_SECRET`, `JWT_TTL`, `CORS_ORIGIN`, `BCRYPT_ROUNDS`, `CHECK_INTERVAL_MS`

2. **`src/config/db.ts`**
   - Export `connectDB(): Promise<void>` using `mongoose.connect(env.MONGODB_URI)`
   - Set `mongoose.set('strictQuery', true)`
   - Log connection state via logger; export `disconnectDB()` for graceful shutdown

3. **`src/config/logger.ts`**
   - Create a `pino` logger instance
   - In `development`: use `pino-pretty` transport
   - In `production`: structured JSON
   - Export singleton `logger`

---

## Phase 2 — Common Layer

**Goal:** Shared helpers and middleware used across all modules.

### Steps

1. **`src/common/errors.ts`** — Custom error hierarchy
   - `AppError extends Error` with `statusCode`, `code` (string enum), `details?`
   - Subclasses: `ValidationError (400)`, `UnauthorizedError (401)`, `ForbiddenError (403)`, `NotFoundError (404)`, `ConflictError (409)`, `InternalError (500)`

2. **`src/common/http.ts`** — Response envelope helpers
   - `sendSuccess(res, data, statusCode = 200)`  → `{ data }`
   - `sendPaginated(res, items, total, page, limit)` → `{ data: { items, total, page, limit, pages } }`
   - `sendError(res, error)` → `{ error: { code, message, details? } }`

3. **`src/common/paginate.ts`** — Pagination query parser
   - Parse `?page=1&limit=20` from query string
   - Return `{ skip, limit, page }` with sensible bounds (max limit 100)

4. **`src/common/middleware/requestId.ts`**
   - Attach `X-Request-Id` (UUID v4) to every request; set response header
   - Attach `requestId` and `tenantId` to pino child logger for tracing

5. **`src/common/middleware/validate.ts`**
   - `validate(schema: AnyZodObject)` middleware factory
   - For `GET`: validate `req.query`; for others: validate `req.body` and replace it with `parsed.data`
   - On failure: throw `ValidationError` with Zod issue details
   - Use `schema.strict()` to reject unknown fields

6. **`src/common/middleware/authGuard.ts`**
   - Extract JWT from `req.cookies.token` or `Authorization: Bearer <token>`
   - Verify with `JWT_SECRET`; on failure throw `UnauthorizedError`
   - Attach typed `req.user = { sub, email, role, tenantId }` to request
   - `authGuard(minRole?)` factory: validate role hierarchy (owner > admin > operator > viewer)

7. **`src/types/express.d.ts`** — Augment Express `Request`
   - Add `user: { sub: string; email: string; role: Role; tenantId: string }`
   - Add `requestId: string`

8. **`src/common/middleware/rateLimit.ts`**
   - `globalLimiter`: 200 req/min per IP
   - `authLimiter`: 10 req/min per IP (applied to `/api/v1/auth`)
   - `usageLimiter`: 60 req/min per IP (applied to `/api/v1/usage`)

9. **`src/common/middleware/errorHandler.ts`**
   - Express 4-argument error handler
   - Handle `AppError`, `ZodError` (fallback), `mongoose.Error`, and unknown errors
   - Always respond with `{ error: { code, message, details? } }` envelope
   - Log internal errors (500) with `logger.error`; include `requestId`

---

## Phase 3 — App & Server Wiring (skeleton)

**Goal:** A bootable Express server that passes health checks. No domain logic yet.

### Steps

1. **`src/app.ts`**
   - Apply middleware in order:
     1. `requestId` middleware
     2. `helmet()` with CSP
     3. `cors({ origin: env.CORS_ORIGIN, credentials: true })`
     4. `compression()`
     5. `hpp()`
     6. `express.json()` + `express.urlencoded({ extended: false })`
     7. `cookieParser()`
     8. `globalLimiter`
   - Mount health routes: `GET /healthz` → `200 { status: 'ok' }` and `GET /readyz` → DB ping
   - Mount versioned API: `app.use('/api/v1', apiRouter)`
   - Mount `errorHandler` last

2. **`src/server.ts`**
   - `connectDB()` → then `http.createServer(app)` → then `server.listen(PORT)`
   - Call `attachWS(httpServer)` after server starts
   - Graceful shutdown on `SIGTERM`/`SIGINT`: stop accepting, close WS, close DB

3. **Smoke-test**

   ```bash
   npm run dev
   curl http://localhost:4000/healthz   # { "status": "ok" }
   curl http://localhost:4000/readyz    # { "status": "ok", "db": "connected" }
   ```

---

## Phase 4 — Auth Module

**Goal:** Register/login users with bcrypt + JWT; `GET /me` returns session user.

### Steps

1. **`user.model.ts`** — Mongoose schema
   - Fields: `tenantId (ObjectId, ref Tenant)`, `email (unique)`, `hash (String, select: false)`, `role (enum)`, `createdAt`, `updatedAt`
   - Indexes: `{ email: 1, unique: true }`, `{ tenantId: 1 }`
   - Pre-save hook is NOT used for hashing (done in service to keep model thin)

2. **`auth.validation.ts`** — Zod schemas
   - `LoginSchema`: `{ email: z.string().email(), password: z.string().min(8) }`
   - `RegisterSchema`: extends LoginSchema + `{ name: z.string(), tenantId: z.string() }`

3. **`auth.service.ts`**
   - `register(dto)`: check email uniqueness → bcrypt hash (BCRYPT_ROUNDS) → save user → return sanitised user (no hash)
   - `login(dto)`: find user by email (select `+hash`) → bcrypt compare → on match, sign JWT `{ sub, email, role, tenantId }` with TTL → return `{ token, user }`
   - `getMe(userId)`: lean user lookup, return sanitised user

4. **`auth.controller.ts`** — Thin; delegates to service
   - `login`: call service → set HttpOnly `token` cookie + return `{ data: { token, user } }`
   - `logout`: clear `token` cookie
   - `me`: call `getMe(req.user.sub)` → return `{ data: user }`

5. **`auth.routes.ts`**
   - `POST /login` — `validate(LoginSchema)` → `login`
   - `POST /logout` → `logout`
   - `GET /me` — `authGuard()` → `me`

6. **Rate-limit `/api/v1/auth` with `authLimiter`**

---

## Phase 5 — Tenant Module

**Goal:** Tenant and membership records; corporate users can own multiple tenants.

### Steps

1. **`tenant.model.ts`**
   - Fields: `name`, `slug (unique)`, `ownerId (ObjectId)`, `createdAt`
   - Index: `{ slug: 1, unique: true }`

2. **`membership.model.ts`**
   - Fields: `tenantId`, `userId`, `role (enum)`, `joinedAt`
   - Index: `{ tenantId: 1, userId: 1, unique: true }`
   - This is the join table enabling multi-brand membership

3. **`tenant.service.ts`**
   - `createTenant(dto, actorId)`: create tenant + owner membership + emit audit log
   - `listTenants(userId)`: return tenants where user has membership
   - `getTenantById(tenantId, userId)`: scoped lookup

4. **`tenant.routes.ts`** (admin-only)
   - `POST /tenants` — `authGuard('admin')` → create
   - `GET /tenants` — `authGuard()` → list own tenants

---

## Phase 6 — Check Module

**Goal:** Full CRUD for checks; all queries tenant-scoped.

### Steps

1. **`check.model.ts`**
   - Fields: `tenantId`, `name`, `url`, `expectedStatus (default 200)`, `maxLatencyMs`, `enabled (default true)`, `lastResult?: { status, latencyMs, checkedAt, ok }`, `createdAt`, `updatedAt`
   - Indexes: `{ tenantId: 1, createdAt: -1 }`, text index on `name`

2. **`check.validation.ts`** — Zod schemas
   - `CreateCheckSchema`: `name`, `url (z.string().url())`, `expectedStatus`, `maxLatencyMs`, `enabled`
   - `UpdateCheckSchema`: `CreateCheckSchema.partial()`
   - `ListChecksQuerySchema`: `page`, `limit`, `q`, `status (enabled|disabled)`, `sort`

3. **`check.repo.ts`** — Database layer (always inject `tenantId`)
   - `findAll(tenantId, query)`: paginated, filtered, text-searched with `.lean()`
   - `findById(tenantId, id)`: single check
   - `create(tenantId, dto)`: insert
   - `updateById(tenantId, id, dto)`: findOneAndUpdate
   - `deleteById(tenantId, id)`: findOneAndDelete

4. **`check.service.ts`** — Business logic
   - Delegates to repo; calls `audit.service.log()` on create/update/delete
   - Throws `NotFoundError` on missing check

5. **`check.controller.ts`** — Thin; reads `req.user.tenantId`
   - `list`, `create`, `getById`, `update`, `remove`

6. **`check.routes.ts`**
   - All routes under `authGuard()`
   - `GET /checks` — `validate(ListChecksQuerySchema)` → `list`
   - `POST /checks` — `validate(CreateCheckSchema)` → `create`
   - `GET /checks/:id` → `getById`
   - `PATCH /checks/:id` — `validate(UpdateCheckSchema)` → `update`
   - `DELETE /checks/:id` — `authGuard('operator')` → `remove`

---

## Phase 7 — Checks Engine (Scheduler)

**Goal:** Periodic HTTP probes; emit pass/fail/recover events; drive incident automation.

### Steps

1. **HTTP probe function (`check.service.ts` or dedicated `probe.ts`)**
   - Use `axios.get(url, { timeout: 10000, validateStatus: () => true })` to capture all status codes
   - Record `{ ok, latencyMs, statusCode, error? }`
   - `ok = statusCode === expectedStatus && latencyMs <= maxLatencyMs`

2. **Scheduler (`src/scheduler.ts`)**
   - On startup, load all `enabled` checks from DB
   - Schedule each with `node-cron` or `setInterval` + random jitter (0–5 s) to avoid thundering herd
   - After each probe, call `handleProbeResult(check, result)`:
     - Update `check.lastResult`
     - Compare previous `ok` with new `ok`
     - If transitioned `pass → fail`: emit `'check:fail'` event
     - If transitioned `fail → pass`: emit `'check:recover'` event
     - If same state: no event (deduplication)
   - Re-load checks periodically or on mutation (listen to `'checks:changed'` internal event)

3. **Event bus (`src/realtime/pubsub.ts`)**
   - Simple in-process `EventEmitter`-based pub/sub (extensible to Redis later)
   - `publish(channel, payload)` / `subscribe(channel, handler)` / `unsubscribe`
   - Channels: `incidents:{tenantId}` for real-time incident events

---

## Phase 8 — Incident Module

**Goal:** Auto lifecycle management; incident CRUD; status transitions; notes; timeline streaming.

### Steps

1. **`incident.model.ts`**
   - Fields: `tenantId`, `checkId (ref Check)`, `status ('open'|'monitoring'|'resolved')`, `openedAt`, `resolvedAt?`, `lastChangeAt`, `notes: [{ by (ObjectId), at, text }]`
   - Indexes: `{ tenantId: 1, lastChangeAt: -1 }`, `{ checkId: 1 }`, `{ tenantId: 1, status: 1 }`

2. **`incident.validation.ts`**
   - `UpdateIncidentSchema`: `{ status?: z.enum([...]), note?: { text: z.string().min(1) } }`
   - `ListIncidentsQuerySchema`: `page`, `limit`, `status`, `from`, `to`, `sort`, `checkId`

3. **`incident.repo.ts`** — Always tenant-scoped
   - `findAll(tenantId, query)`: paginated + date-range filtered with `.lean()`
   - `findById(tenantId, id)`: single incident (optionally populated with check name)
   - `findOpenByCheckId(tenantId, checkId)`: deduplication lookup
   - `create(tenantId, dto)`
   - `updateById(tenantId, id, update)`

4. **`incident.service.ts`** — Core business logic
   - `openIncident(tenantId, checkId)`:
     - Check for existing open incident (deduplicate)
     - Create incident with `status: 'open'`, `openedAt: now`
     - Emit audit log
     - Publish to pubsub `incidents:{tenantId}` → broadcast via WS + SSE
   - `resolveIncident(tenantId, checkId)`:
     - Find open incident for checkId
     - Update status to `monitoring` then `resolved` (or direct based on config)
     - Set `resolvedAt`, update `lastChangeAt`
     - Publish event
   - `updateIncident(tenantId, id, dto, actorId)`:
     - Validate status transition (open → monitoring → resolved; no backward)
     - Append note if provided
     - Emit audit log; publish event
   - `getTimeline(tenantId, incidentId)`: fetch incident + all audit log entries for this incident

5. **`incident.controller.ts`**
   - `list`, `getById`, `update` (add note / change status)
   - `streamTimeline`: delegate to `stream.ts`

6. **`incident.routes.ts`**
   - `GET /incidents` — `validate(ListIncidentsQuerySchema)` → `list`
   - `GET /incidents/stream` → SSE handler (no auth required for public feed; tenantId from query)
   - `GET /incidents/:id` — `authGuard()` → `getById`
   - `PATCH /incidents/:id` — `authGuard('operator')`, `validate(UpdateIncidentSchema)` → `update`
   - `GET /incidents/:id/timeline/stream` — `authGuard()` → `streamTimeline`

7. **Wire scheduler events to incident service**
   - `'check:fail'` → `incidentService.openIncident(tenantId, checkId)`
   - `'check:recover'` → `incidentService.resolveIncident(tenantId, checkId)`

---

## Phase 9 — Audit Module

**Goal:** Append-only, tamper-evident log of all mutations; queryable per tenant.

### Steps

1. **`audit.model.ts`**
   - Fields: `tenantId`, `actorId (ObjectId, nullable for system)`, `action (string)`, `targetCollection`, `targetId`, `meta (Mixed)`, `ts (Date, default now)`
   - Index: `{ tenantId: 1, ts: -1 }`
   - No `updatedAt` (append-only; `timestamps: false` for update fields; use `createdAt` only)

2. **`audit.service.ts`**
   - `log(entry: AuditEntry): Promise<void>` — fire-and-forget insert; never throws (catch + logger.error)
   - `query(tenantId, opts: { from?, to?, action?, targetId?, page, limit })`: paginated read

3. **`GET /api/v1/audit`** — `authGuard('admin')` → audit query (admin/owner only)

---

## Phase 10 — Usage Module

**Goal:** Idempotent event ingestion with `Idempotency-Key` deduplication.

### Steps

1. **`usage.model.ts`**
   - Fields: `idempotencyKey (unique)`, `tenantId`, `kind`, `payload (Mixed)`, `ts`
   - Unique index: `{ idempotencyKey: 1 }` — enforces idempotency at DB level

2. **`usage.validation.ts`**
   - `CreateUsageEventSchema`: `{ kind: z.string(), payload: z.record(z.unknown()).optional() }`
   - Middleware to extract and validate `Idempotency-Key` header (reject if missing)

3. **`usage.service.ts`**
   - `ingestEvent(tenantId, idempotencyKey, dto)`:
     - Attempt insert
     - On `MongoServerError code 11000` (duplicate key): return the existing record (idempotent success)

4. **`usage.controller.ts`** + **`usage.routes.ts`**
   - `POST /usage/events` — `authGuard()`, `usageLimiter`, `validate(CreateUsageEventSchema)` → `ingestEvent`

---

## Phase 11 — Real-Time Layer

**Goal:** WebSocket rooms, SSE incident stream, and streaming timeline HTTP response.

### Steps

1. **`src/realtime/pubsub.ts`**
   - Typed `EventEmitter` wrapper
   - `publish<T>(channel: string, payload: T): void`
   - `subscribe<T>(channel: string, handler: (payload: T) => void): () => void` (returns unsubscribe fn)
   - In-process only (note in code: swap for Redis pub/sub for multi-instance)

2. **`src/realtime/ws.ts`** — WebSocket server
   - `attachWS(httpServer: Server): { broadcast: (tenantId, payload) => void }`
   - Rooms: `Map<tenantId, Set<WebSocket>>`
   - On connect: parse `?tenantId=` from URL, add to room
   - Ping/pong every 30 s to detect dead connections; remove on `pong` timeout
   - On close: clean up room; delete room if empty
   - Subscribe to `incidents:{tenantId}` pubsub → broadcast to WS room

3. **`src/realtime/sse.ts`** — SSE endpoint handler
   - `incidentSSE(req, res)`: set headers, flush, subscribe to pubsub `incidents:{tenantId}`
   - Heartbeat `:keep-alive\n\n` every 20 s via `setInterval`
   - On `req.close`: clear interval, unsubscribe, `res.end()`
   - No auth required (public feed); `tenantId` from query param

4. **`src/realtime/stream.ts`** — Streaming HTTP
   - `streamTimeline(req, res)`: open chunked JSON response
   - Write `{"items":[`, stream audit log docs for the incident id, write `]}`
   - Use async generator + Mongoose cursor (`.cursor()`) for backpressure

---

## Phase 12 — History Export

**Goal:** CSV download for incident history within a date range.

### Steps

1. **`GET /api/v1/incidents/export`** — `authGuard('viewer')` (read-only role acceptable)
   - Query params: `from`, `to` (ISO dates), `status?`
   - Stream CSV via Mongoose cursor + `res.write` (no loading entire result set into memory)
   - Headers: `Content-Type: text/csv`, `Content-Disposition: attachment; filename="incidents-<from>-<to>.csv"`
   - Columns: `id, checkName, status, openedAt, resolvedAt, noteCount`
   - Validate date range (max 90 days)

---

## Phase 13 — Tests

**Goal:** Reliable, isolated test suite covering happy/sad paths, idempotency, tenant isolation, and real-time behaviour.

### Steps

1. **`tests/fixtures/seed.ts`**
   - Create in-memory MongoDB using `mongodb-memory-server` (or connect to test Atlas)
   - Seed: 2 tenants, 1 user per tenant (owner), sample checks and incidents
   - Export `teardown()` for `afterAll`

2. **Auth tests (`tests/auth/auth.test.ts`)**
   - `POST /api/v1/auth/login` happy path → 200 + cookie
   - `POST /api/v1/auth/login` wrong password → 401
   - `GET /api/v1/auth/me` without token → 401
   - `GET /api/v1/auth/me` with valid token → 200 + user

3. **Check tests (`tests/check/check.test.ts`)**
   - CRUD happy paths with valid JWT
   - Tenant isolation: user from tenant A cannot read tenant B's checks → 404
   - Validation failure: missing `url` → 400 with Zod details
   - Pagination: `?page=2&limit=5` returns correct slice

4. **Incident tests (`tests/incident/incident.test.ts`)**
   - Auto-open on `check:fail` event
   - Duplicate `check:fail` does not open second incident
   - Status transition: `open → monitoring` valid; `monitoring → open` invalid → 400
   - Add note: appears in `notes[]`

5. **Idempotency tests (`tests/usage/idempotency.test.ts`)**
   - `POST /usage/events` with same `Idempotency-Key` twice → second returns 200 same payload (not 409)
   - Missing `Idempotency-Key` header → 400

6. **SSE tests (`tests/realtime/sse.test.ts`)**
   - Connect to `/api/v1/incidents/stream?tenantId=<id>` → response headers include `text/event-stream`
   - Client disconnect does not crash server (no lingering listeners)

---

## Phase 14 — Hardening & Polish

**Goal:** Production-ready reliability, observability, and performance.

### Steps

1. **Request ID propagation**
   - Include `requestId` in every log line and every error response
   - Log: `{ requestId, tenantId, method, url, statusCode, durationMs }` on response finish

2. **p50/p95 latency logging**
   - Track response time per route via middleware; log percentiles periodically or via `pino` serialisers

3. **Backpressure**
   - In WS broadcast: check `ws.bufferedAmount` before sending; drop or queue if too high
   - In streaming: use `res.writableEnded` guard

4. **Graceful shutdown**
   - Stop scheduler
   - Close WS server (send close frames to all clients)
   - Terminate all open SSE responses
   - `mongoose.disconnect()`
   - Exit process after drain timeout (default 10 s)

5. **Health checks finalisation**
   - `/healthz`: always `200` (liveness — process is running)
   - `/readyz`: `mongoose.connection.readyState === 1` → 200; else 503

6. **Security review checklist**
   - Helmet CSP does not break WS or SSE
   - CORS allows only `CORS_ORIGIN`; credentials mode matches cookie usage
   - JWT `iss` and `aud` claims verified
   - All routes behind `authGuard` except: `/healthz`, `/readyz`, `/auth/login`, `/auth/logout`, `/incidents/stream` (public SSE)

---

## Phase 15 — CI Gates

**Goal:** No broken code merges; gates enforce quality before merge.

### Steps

1. **CI pipeline steps (GitHub Actions or equivalent)**

   ```yaml
   - npm ci
   - npm run typecheck
   - npm run lint
   - npm run format:check
   - npm run test:coverage
   ```

2. **Coverage thresholds in `jest.config.ts`**
   - Lines: 70%, Functions: 70%, Branches: 60%

3. **Branch protection**: require CI green before merge to `main`

---

## Implementation Order Summary

```
Phase 0   Toolchain Bootstrap         ← zero code, all config
Phase 1   Config Layer                ← env, db, logger
Phase 2   Common Layer                ← errors, http, middleware
Phase 3   App & Server Skeleton       ← bootable, /healthz works
Phase 4   Auth Module                 ← login, JWT, /me
Phase 5   Tenant Module               ← multi-tenant foundation
Phase 6   Check Module                ← CRUD, tenant-scoped
Phase 7   Checks Engine               ← scheduler, probes, events
Phase 8   Incident Module             ← lifecycle, auto-open, streaming
Phase 9   Audit Module                ← append-only logs
Phase 10  Usage Module                ← idempotent events
Phase 11  Real-Time Layer             ← WS, SSE, streaming
Phase 12  History Export              ← CSV streaming
Phase 13  Tests                       ← full coverage
Phase 14  Hardening & Polish          ← observability, graceful shutdown
Phase 15  CI Gates                    ← pipeline, thresholds
```

> Each phase should build and lint-clean before moving to the next.
> Real-time (Phase 11) must follow the Incident module (Phase 8) since it depends on the pubsub events established in Phase 7–8.
