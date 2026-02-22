
# PulseBoard — Backend Guide (Express.js + TypeScript + MongoDB, MVC‑ish with WS/SSE/Streaming)

This guide defines the **platform, tools, architecture, and implementation details** for the **backend** repository of PulseBoard. It emphasizes **strict TypeScript**, **professional REST**, **Zod validation**, **MVC‑ish boundaries**, **tenant isolation**, and **real‑time** (WebSockets, SSE, and streaming HTTP).

---

## 1) Platform & Tools

- **Runtime**: Node.js LTS
- **Framework**: Express.js + TypeScript (`"strict": true`)
- **DB**: MongoDB Atlas (Mongoose `strictQuery`, lean reads)
- **Validation**: Zod (reject unknown fields)
- **Auth**: JWT (HttpOnly cookie or Bearer); bcrypt (≥ 12 rounds)
- **Security**: Helmet, CORS (frontend origin only), compression, hpp, cookie‑parser, rate limiting, request timeout (30 s)
- **API Docs**: Swagger / OpenAPI 3.0 (`swagger-jsdoc` + `swagger-ui-express`); served at `GET /api/v1/docs`
- **Logging**: pino/winston + request IDs
- **Real‑time**: `ws` (WebSockets), **SSE** endpoints, **streaming** responses
- **Testing**: Jest + Supertest

**Env (.env)**
```env
NODE_ENV=development
PORT=4000
MONGODB_URI="mongodb+srv://<user>:<pass>@<cluster>/pulseboard"
JWT_SECRET="change-me"
CORS_ORIGIN=http://localhost:3000
```

---

## 2) Project Structure (MVC‑ish)

```
src/
  app.ts                      # express app wiring (helmet, cors, routes, errors)
  server.ts                   # db connect + http + ws server
  config/                     # env, db, logger, security, swagger (OpenAPI spec)
  common/
    http.ts, errors.ts, paginate.ts
    middleware/
      validate.ts, errorHandler.ts, authGuard.ts, rateLimit.ts, requestId.ts
  realtime/
    ws.ts, sse.ts, stream.ts, pubsub.ts
  modules/
    auth/
      auth.routes.ts, auth.controller.ts, auth.service.ts, auth.validation.ts, user.model.ts
    tenant/
      tenant.model.ts, membership.model.ts
    check/
      check.routes.ts, check.controller.ts, check.service.ts, check.repo.ts, check.model.ts, check.validation.ts
    incident/
      incident.routes.ts, incident.controller.ts, incident.service.ts, incident.repo.ts, incident.model.ts, incident.validation.ts
    audit/
      audit.model.ts, audit.service.ts
    usage/
      usage.routes.ts, usage.controller.ts, usage.service.ts, usage.model.ts
  tests/
```

---

## 3) Data Model & Indexing (multi‑tenant)

- **Common rule**: repositories **must inject `tenantId`** into every query; never query unscoped collections.

**users**
```ts
{ _id, tenantId, email (unique), hash, role: 'owner'|'admin'|'operator'|'viewer', createdAt, updatedAt }
// indexes: { email: 1, unique }, { tenantId: 1 }
```
**checks**
```ts
{ _id, tenantId, name, url, expectedStatus: number, maxLatencyMs: number, enabled: boolean, lastResult?, createdAt, updatedAt }
// indexes: { tenantId: 1, createdAt: -1 }, text index on name
```
**incidents**
```ts
{ _id, tenantId, checkId, status: 'open'|'monitoring'|'resolved', openedAt, resolvedAt?, lastChangeAt, notes: [{ by, at, text }] }
// indexes: { tenantId: 1, lastChangeAt: -1 }, { checkId: 1 }
```
**audit_logs**
```ts
{ tenantId, actorId, action, targetCollection, targetId, meta, ts }
// index: { tenantId: 1, ts: -1 }
```
**usage_events** (idempotent)
```ts
{ idempotencyKey, tenantId, kind, ts }
// unique: { idempotencyKey: 1 }
```

---

## 4) Professional REST Conventions

- **Versioning**: `/api/v1` prefix.
- **Pagination**: `?page=1&limit=20` → `{ items, total, page, limit }`.
- **Filtering/Sorting**: `?status=resolved&from=...&to=...&sort=-createdAt`.
- **Idempotency**: `POST /usage/events` requires `Idempotency-Key` to dedupe retries.
- **Errors**: consistent envelopes `{ error: { code, message, details? } }` with correct status codes.
- **Responses**: success envelope `{ data: ... }`.

---

## 5) Core Middleware & Helpers (samples)

**Validation**
```ts
// common/middleware/validate.ts
import { AnyZodObject } from 'zod';
import { Request, Response, NextFunction } from 'express';
export const validate = (schema: AnyZodObject) => (req: Request, _res: Response, next: NextFunction) => {
  const parsed = schema.safeParse(req.method === 'GET' ? req.query : req.body);
  if (!parsed.success) return next(parsed.error);
  if (req.method !== 'GET') (req as any).body = parsed.data;
  next();
};
```

**Auth Guard**
```ts
// common/middleware/authGuard.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
export const authGuard = (role?: 'owner'|'admin'|'operator'|'viewer') => (req: Request, res: Response, next: NextFunction) => {
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Login required' }});
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as { sub: string; role: string; tenantId: string };
    (req as any).user = payload;
    if (role && payload.role !== role) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Insufficient role' }});
    next();
  } catch {
    return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Invalid token' }});
  }
};
```

Request Timeout:

- `requestTimeout` — 30 s socket timeout via `res.setTimeout()`; SSE-safe (keep-alive writes reset the timer every 20 s); responds `408 REQUEST_TIMEOUT` only if `!res.headersSent`

Swagger UI:

- `GET /api/v1/docs` — interactive Swagger UI (served by `swagger-ui-express`)
- `GET /api/v1/docs.json` — raw OpenAPI 3.0 JSON spec (generated by `swagger-jsdoc` from `@swagger` JSDoc annotations in route files)

---

## 6) Real‑Time & Streaming

**WebSocket server**
```ts
// realtime/ws.ts
import { WebSocketServer } from 'ws';
import type { Server } from 'http';

export function attachWS(httpServer: Server){
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const rooms = new Map<string, Set<WebSocket>>();

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url!, 'http://localhost');
    const tenantId = url.searchParams.get('tenantId') ?? 'public';
    const set = rooms.get(tenantId) ?? new Set();
    set.add(ws); rooms.set(tenantId, set);

    ws.on('close', () => { set.delete(ws); if (!set.size) rooms.delete(tenantId); });
  });

  function broadcast(tenantId: string, payload: unknown){
    const set = rooms.get(tenantId); if (!set) return;
    const msg = JSON.stringify(payload);
    for (const ws of set) if (ws.readyState === ws.OPEN) ws.send(msg);
  }

  return { broadcast };
}
```

**SSE endpoint**
```ts
// realtime/sse.ts
import { Request, Response } from 'express';
import { subscribeIncidents } from './pubsub';

export function incidentSSE(req: Request, res: Response){
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const tenantId = String(req.query.tenantId || 'public');
  const heartbeat = setInterval(() => res.write(`:keep-alive\n\n`), 20000);
  const send = (evt: any) => res.write(`event: incident\ndata: ${JSON.stringify(evt)}\n\n`);
  const unsubscribe = subscribeIncidents(tenantId, send);

  req.on('close', () => { clearInterval(heartbeat); unsubscribe(); res.end(); });
}
```

**Streaming endpoint**
```ts
// realtime/stream.ts
import { Request, Response } from 'express';
export async function streamTimeline(req: Request, res: Response){
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.write('{"items":[');
  let first = true;
  for await (const chunk of getTimelineChunks(req.params.id)){
    res.write((first ? '' : ',') + JSON.stringify(chunk));
    first = false;
  }
  res.write(']}'); res.end();
}
```

---

## 7) Checks Engine (basics)

- A lightweight scheduler (e.g., `node-cron` or a simple setInterval per enabled check with jitter) triggers HTTP probes.
- Probe results emit events: **pass/fail/recover**; dedupe duplicates to avoid alert storms.
- On **fail** → open or update an incident and broadcast WS/SSE; append audit.
- On **recover** → update incident to `monitoring` or `resolved` and broadcast; append audit.

> For multi‑instance scaling, externalize pub/sub (Redis/NATS) and ensure a single scheduler (or shard by hash).

---

## 8) Security & Reliability

- Helmet + CSP; CORS minimal; rate limits (global + auth + usage).
- bcrypt for passwords; JWT short TTL; refresh rotation optional.
- Zod on **every route**; reject unknown fields.
- Indexes for tenant + timestamps; use `.lean()` for reads.
- Health checks: `/healthz` (liveness), `/readyz` (DB connectivity).
- Graceful shutdown: stop accepting, close WS/SSE, drain in‑flight.
- Audit logs for all mutations.

---

## 9) Testing

- **E2E**: Supertest for routes (happy/sad), SSE connect/close, idempotency duplicate POST.
- **Unit**: services with mocked repositories; business rules (autocreate incident, status transitions, tenant scoping).
- **Fixtures**: seed tenant, user, sample checks & incidents.

---

## 10) Run & Verify

```bash
pnpm run dev  # http://localhost:4000
```

**Smoke test**
- `GET /api/v1/checks` → `{ items: [], total: 0, page, limit }`
- `POST /api/v1/auth/login` → sets HttpOnly cookie or returns Bearer
- `GET /api/v1/incidents/stream?tenantId=demo` → keep‑alive comments every ~20s
- WS: `ws://localhost:4000/ws?tenantId=demo` → receive updates on incident changes

---

## 11) Strict Restrictions (backend)
1. TS only; `strict: true`.
2. Controllers thin; services hold business; repositories isolate DB queries.
3. Zod validates **every** request; reject unknown fields.
4. Idempotency for retriable POSTs (usage events); prevent duplicate alerts.
5. All queries must filter by `tenantId`.
6. Emit audit logs on mutation.
7. Enforce rate limits & CORS; secure cookies in production.
8. Provide both WS and SSE endpoints; clean up on disconnect.

