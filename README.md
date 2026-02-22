# PulseBoard — Backend API

> **Uptime & Incident Control Room** — REST API, WebSockets, SSE, and streaming endpoints.
>
> Part of the PulseBoard monorepo. The companion frontend lives at `pulseboard-frontend` on port `3000`.

**Stack:** Node.js 20 · Express.js · TypeScript (strict) · MongoDB Atlas (Mongoose) · Zod · WebSockets · SSE · Jest/Supertest

---

## Table of Contents

- [Features](#features)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [NPM Scripts](#npm-scripts)
- [API Reference](#api-reference)
- [Real-Time Channels](#real-time-channels)
- [Authentication & Roles](#authentication--roles)
- [Architecture Notes](#architecture-notes)

---

## Features

- **Checks engine** — periodic HTTP probes with configurable expected status code and latency SLA; random jitter prevents thundering-herd on startup.
- **Incident automation** — incidents open automatically on `check:fail`, resolve on `check:recover`; manual status transitions and operator notes via REST.
- **Real-time broadcast** — WebSocket rooms (per tenant) for the operator dashboard; SSE feed for public/status pages.
- **Streaming timelines** — incident audit timeline streamed via Mongoose cursor for zero-memory-overhead large responses.
- **CSV export** — incident history export with configurable date range (max 90 days), streamed directly to the response.
- **Idempotent event ingestion** — `POST /usage/events` deduplicates retries via `Idempotency-Key` header + MongoDB unique index.
- **Multi-tenant isolation** — every repository query is scoped by `tenantId`; cross-tenant reads return 404.
- **Audit trail** — append-only log of every mutation; queryable by admins and owners.
- **Production hardening** — Helmet + CSP, CORS, rate limiting (global / auth / usage), bcrypt (≥ 12 rounds), JWT with `iss`/`aud` verification, request IDs, p50/p95 latency logging, graceful shutdown.

---

## Project Structure

```
pulse-board-backend/
├── src/
│   ├── app.ts                        # Express app factory (middleware + routes)
│   ├── server.ts                     # DB connect · HTTP server · WebSocket · signals
│   ├── scheduler.ts                  # Probe scheduler (setInterval + jitter)
│   ├── config/
│   │   ├── env.ts                    # Zod-validated env singleton
│   │   ├── db.ts                     # Mongoose connect/disconnect
│   │   └── logger.ts                 # Pino logger (pretty in dev, JSON in prod)
│   ├── common/
│   │   ├── errors.ts                 # AppError hierarchy (400–500)
│   │   ├── http.ts                   # sendSuccess / sendPaginated / sendError
│   │   ├── paginate.ts               # ?page=&limit= parser (max 100)
│   │   └── middleware/
│   │       ├── authGuard.ts          # JWT verification + role hierarchy guard
│   │       ├── validate.ts           # Zod schema middleware (.strict())
│   │       ├── errorHandler.ts       # Global 4-arg Express error handler
│   │       ├── rateLimit.ts          # globalLimiter / authLimiter / usageLimiter
│   │       ├── requestId.ts          # X-Request-Id injection (UUID v4)
│   │       └── requestLogger.ts      # Structured access log + p50/p95 tracker
│   ├── realtime/
│   │   ├── pubsub.ts                 # In-process EventEmitter pub/sub
│   │   ├── ws.ts                     # WebSocket server (rooms, ping/pong)
│   │   ├── sse.ts                    # SSE handler (heartbeat, graceful shutdown)
│   │   └── stream.ts                 # Chunked JSON timeline via Mongoose cursor
│   ├── modules/
│   │   ├── auth/                     # login · logout · /me
│   │   ├── tenant/                   # tenant + membership
│   │   ├── check/                    # checks CRUD + probe function
│   │   ├── incident/                 # lifecycle · notes · CSV export · streaming
│   │   ├── audit/                    # append-only mutation log
│   │   └── usage/                    # idempotent event ingestion
│   └── types/
│       └── express.d.ts              # req.user / req.requestId augmentation
├── tests/
│   ├── fixtures/
│   │   └── seed.ts                   # MongoMemoryServer + seed helper
│   ├── setup.ts                      # process.env bootstrap for Jest
│   ├── auth/auth.test.ts
│   ├── check/check.test.ts
│   ├── incident/incident.test.ts
│   ├── usage/idempotency.test.ts
│   └── realtime/sse.test.ts
├── .github/workflows/ci.yml          # CI gates (typecheck · lint · format · test)
├── .husky/                           # pre-commit (lint-staged) · pre-push (typecheck+test)
├── tsconfig.json                     # Node16 module resolution, noEmit
├── tsconfig.build.json               # Production tsc emit to dist/
├── tsconfig.dev.json                 # CommonJS override for ts-node-dev
├── jest.config.ts
├── eslint.config.js
└── .prettierrc
```

---

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | ≥ 20.0.0 |
| npm | ≥ 10.0.0 |
| MongoDB | Atlas cluster **or** local `mongod` ≥ 6 |

---

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in the required values (see [Environment Variables](#environment-variables) below). At minimum you need `MONGO_URI` and `JWT_SECRET`.

### 3. Start the development server

```bash
npm run dev
```

The server starts on `http://localhost:4000`. On first run, `ts-node-dev` compiles TypeScript in-process — no build step needed.

### 4. Verify

```bash
curl http://localhost:4000/healthz
# { "status": "ok" }

curl http://localhost:4000/readyz
# { "status": "ok", "db": "connected" }
```

### Production build

```bash
npm run build       # emit to dist/
npm start           # node dist/server.js
```

---

## Environment Variables

All variables are validated at startup with Zod. Missing required variables cause an immediate `process.exit(1)` with a descriptive error listing every missing field.

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | no | `development` | `development` · `test` · `production` |
| `PORT` | no | `4000` | HTTP server port |
| `MONGO_URI` | **yes** | — | Full MongoDB connection string (Atlas or local) |
| `JWT_SECRET` | **yes** | — | Secret used to sign and verify JWTs |
| `JWT_TTL` | no | `15m` | JWT lifetime accepted by `jsonwebtoken` (e.g. `15m`, `2h`, `7d`) |
| `BCRYPT_ROUNDS` | no | `12` | bcrypt cost factor — minimum 12 in production; set to `4` in CI for speed |
| `CORS_ORIGIN` | no | `http://localhost:3000` | Comma-separated list of allowed CORS origins |
| `CHECK_INTERVAL_MS` | no | `60000` | Probe scheduler interval in milliseconds |
| `PROBE_TIMEOUT_MS` | no | `10000` | Per-request timeout for outbound HTTP probes |

**Example `.env`:**

```env
NODE_ENV=development
PORT=4000

MONGO_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/pulseboard?retryWrites=true&w=majority

JWT_SECRET=change-me-to-a-long-random-secret-min-32-chars
JWT_TTL=15m

BCRYPT_ROUNDS=12
CORS_ORIGIN=http://localhost:3000

CHECK_INTERVAL_MS=30000
PROBE_TIMEOUT_MS=10000
```

> **Never commit `.env`.** Only `.env.example` (with placeholder values) is tracked by git.

---

## NPM Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start dev server with `ts-node-dev` (hot-reload, no build step) |
| `npm run build` | Compile TypeScript to `dist/` via `tsconfig.build.json` |
| `npm start` | Run the compiled production build from `dist/server.js` |
| `npm run typecheck` | Type-check the entire codebase with `tsc --noEmit` (zero tolerance) |
| `npm run lint` | Run ESLint across `src/` and `tests/` |
| `npm run lint:fix` | Auto-fix all fixable ESLint violations |
| `npm run format` | Format all TypeScript files with Prettier |
| `npm run format:check` | Verify formatting (used in CI — fails if any file would change) |
| `npm test` | Run all tests with Jest (`--runInBand --forceExit`) |
| `npm run test:watch` | Jest in interactive watch mode |
| `npm run test:coverage` | Run tests and enforce coverage thresholds |

---

## API Reference

All routes are prefixed with `/api/v1`. Success responses use the `{ data }` envelope; errors use `{ error: { code, message, details? } }`.

### Health

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/healthz` | none | Liveness probe — always `200` if the process is running |
| `GET` | `/readyz` | none | Readiness probe — `200` when MongoDB is connected, `503` otherwise |

### Auth `/api/v1/auth`

Rate-limited to **10 requests / minute** per IP.

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/login` | none | Validate credentials; set HttpOnly `token` cookie + return `{ token, user }` |
| `POST` | `/auth/logout` | none | Clear the `token` cookie |
| `GET` | `/auth/me` | any role | Return the authenticated user's public profile (no hash) |

**Login request body:**
```json
{ "email": "owner@example.com", "password": "MyPassword1!" }
```

### Tenants `/api/v1/tenants`

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/tenants` | any role | List tenants the requesting user belongs to |
| `POST` | `/tenants` | admin + | Create a new tenant |

### Checks `/api/v1/checks`

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/checks` | any role | Paginated, filterable list of checks for the user's tenant |
| `POST` | `/checks` | any role | Create a check |
| `GET` | `/checks/:id` | any role | Get a single check |
| `PATCH` | `/checks/:id` | any role | Partial update (all fields optional) |
| `DELETE` | `/checks/:id` | operator + | Permanently delete a check |

**Query parameters for `GET /checks`:**

| Param | Type | Description |
|---|---|---|
| `page` | number | Page number (default `1`) |
| `limit` | number | Page size (default `20`, max `100`) |
| `q` | string | Full-text search on check name |
| `status` | `enabled` \| `disabled` | Filter by enabled state |
| `sort` | string | Field to sort by, prefix with `-` for descending (e.g. `-createdAt`) |

**Create / update check body fields:**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | create only | Human-readable label |
| `url` | string (URL) | create only | Target URL to probe |
| `expectedStatus` | number | no | Expected HTTP status code (default `200`) |
| `maxLatencyMs` | number | no | Maximum acceptable response time in ms |
| `enabled` | boolean | no | Whether the scheduler probes this check (default `true`) |

### Incidents `/api/v1/incidents`

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/incidents/stream` | **none** | SSE feed of incident lifecycle events for a tenant |
| `GET` | `/incidents/export` | viewer + | Download incident history as CSV (max 90-day range) |
| `GET` | `/incidents` | any role | Paginated, filterable list of incidents |
| `GET` | `/incidents/:id` | any role | Get a single incident |
| `PATCH` | `/incidents/:id` | operator + | Change status or append a note |
| `GET` | `/incidents/:id/timeline/stream` | any role | Stream incident audit timeline as chunked JSON |

**Query parameters for `GET /incidents`:**

| Param | Type | Description |
|---|---|---|
| `page` | number | Page number |
| `limit` | number | Page size (max `100`) |
| `status` | `open` \| `monitoring` \| `resolved` | Filter by status |
| `from` | ISO date | Opened-at lower bound |
| `to` | ISO date | Opened-at upper bound |
| `checkId` | string | Filter by originating check |
| `sort` | string | Sort field (default `-lastChangeAt`) |

**Query parameters for `GET /incidents/export`:**

| Param | Type | Required | Description |
|---|---|---|---|
| `from` | ISO date | **yes** | Start of the date range |
| `to` | ISO date | **yes** | End of the date range (max 90 days from `from`) |
| `status` | string | no | Filter by incident status |

CSV columns: `id, checkName, status, openedAt, resolvedAt, noteCount`

**PATCH `/incidents/:id` body:**

```json
{
  "status": "monitoring",
  "note": { "text": "Investigating root cause — team notified." }
}
```

Status machine: `open → monitoring → resolved` (no backwards transitions).

### Audit `/api/v1/audit`

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/audit` | admin + | Paginated, filterable audit log for the tenant |

### Usage `/api/v1/usage`

Rate-limited to **60 requests / minute** per IP.

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/usage/events` | any role | Ingest a usage event (idempotent via `Idempotency-Key`) |

**Required header:** `Idempotency-Key: <uuid>` — first delivery returns `201 Created`; a retry with the same key returns `200 OK` with the original record (never `409`).

**Request body:**
```json
{ "kind": "page_view", "payload": { "page": "/dashboard" } }
```

---

## Real-Time Channels

### WebSocket — operator dashboard

```
ws://localhost:4000/ws?tenantId=<objectId>
```

Clients join a **tenant room** on connect. The server broadcasts JSON payloads whenever an incident lifecycle event fires. A **ping/pong heartbeat** runs every 30 s to detect and evict dead connections. On high buffer pressure (`bufferedAmount > 64 KB`) messages are dropped rather than queuing indefinitely.

**Received message shape:**
```json
{ "event": "incident:opened", "incidentId": "...", "tenantId": "...", "checkId": "..." }
{ "event": "incident:resolved", "incidentId": "...", "tenantId": "...", "checkId": "..." }
{ "event": "incident:updated",  "incidentId": "...", "tenantId": "..." }
```

### SSE — public / status page

```
GET /api/v1/incidents/stream?tenantId=<objectId>
```

No authentication required — designed for a public status page. A keep-alive comment (`:`) is emitted every **20 s** to prevent proxy idle-connection timeouts. Clients receive `text/event-stream` with `data: <JSON>` lines.

> The frontend should use `EventSource` for SSE and a native `WebSocket` for the dashboard feed.

---

## Authentication & Roles

### Token extraction order

1. **HttpOnly cookie** `token` — preferred; protects against XSS token theft.
2. **`Authorization: Bearer <token>`** — fallback for API clients, CLI tools, and service-to-service calls.

### JWT payload

```json
{ "sub": "<userId>", "email": "...", "role": "owner", "tenantId": "<tenantId>", "iss": "pulseboard", "aud": "pulseboard-api" }
```

Both `iss` and `aud` claims are verified on every request.

### Role hierarchy

```
owner (4)  ──┐
admin (3)  ──┤  each level includes all permissions below it
operator (2) ──┤
viewer (1) ──┘
```

`authGuard('operator')` passes for `operator`, `admin`, and `owner`; it rejects `viewer` with **403 Forbidden**.

| Role | Can do |
|---|---|
| `viewer` | Read checks, incidents, timelines, export CSV |
| `operator` | All viewer actions + delete checks, update incidents, add notes |
| `admin` | All operator actions + read audit log, create tenants |
| `owner` | All admin actions |

---

## Architecture Notes

### Why `app.ts` is separate from `server.ts`

`app.ts` exports a pure Express application with no side effects. Tests import `app` directly via Supertest — no MongoDB connection, no port binding, no WebSocket server. `server.ts` owns all of that and is never imported by tests.

### Pub/sub bridge

The probe scheduler publishes on `probe:events`. `initIncidentSubscriptions()` subscribes and calls `openIncident` / `resolveIncident` accordingly. Those functions in turn publish on `incidents:{tenantId}`, which the WebSocket server and SSE handler both consume. This keeps the layers decoupled — the scheduler knows nothing about HTTP or WebSockets.

### Thundering-herd prevention

On startup (or after `checks:changed` fires), each check's first probe is delayed by a random `0–5 000 ms` jitter. Without this, reloading 100 checks simultaneously would produce 100 outbound HTTP requests in the same millisecond.

### Idempotency pattern

`POST /usage/events` attempts an insert. If MongoDB returns error code `11000` (duplicate key on `idempotencyKey`), the handler fetches and returns the existing record. The HTTP status is `200` rather than `409` — the client's intent was already fulfilled on the first delivery.

### Graceful shutdown sequence

```
SIGTERM / SIGINT
  └─ terminateAllSse()           close all SSE response streams
  └─ server.close()              stop accepting new HTTP connections
       └─ stopScheduler()        cancel all probe timers
       └─ stopIncidentSubscriptions()  remove pubsub listeners
       └─ wsController.close()   send WS close frames; wait for drain
       └─ disconnectDB()         flush Mongoose writes; close connection pool
       └─ process.exit(0)
  └─ 10 s hard-kill timeout      force exit if drain stalls
```
