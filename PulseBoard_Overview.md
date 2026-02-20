
# PulseBoard — Uptime & Incident Control Room (Next.js + Express.js + MongoDB)

**PulseBoard** is a small, production‑minded web app that gives teams a **live dashboard** of their most important websites and online services. It performs simple health checks (e.g., *is our website responding?*), opens **incidents** automatically when something fails, updates the UI **in real time** (control‑room style), and keeps an **exportable history** for post‑incident reviews.

This document covers the **overall product idea, scope, architecture** and a high‑level **implementation plan** that spans both frontend and backend.

> **Stack (strict TypeScript only):**
> - **Frontend:** Next.js (App Router, Server Components) + Tailwind CSS v4 + styled‑components + Redux Toolkit (thunk) + TanStack Query + Zustand
> - **Backend:** Express.js + Mongoose (MongoDB Atlas) + Zod validation + WebSockets + SSE + streaming endpoints
> - **Repos & Ports:** **Two separate repositories** on **two ports** → Frontend `http://localhost:3000`, Backend `http://localhost:4000`

---

## 1) Product Scope

### 1.1 Core User Stories
- As an operator, I can **create a dashboard** and **add checks** for our services (HTTP ping, status code, latency threshold).
- As an operator, I see **live updates** when a check fails/recovers; PulseBoard **auto‑opens incidents** and updates their status.
- As a manager, I can view an **activity feed** and **export a history** of checks and incidents for monthly reviews.
- As a group admin (multi‑brand), I can view **all brands** in a unified overview while each brand only sees its own data (multi‑tenant isolation).

### 1.2 Non‑Functional Requirements
- **Accessibility**: semantic HTML landmarks, keyboard navigation, visible focus rings, color contrast ≥ 4.5:1, `prefers-reduced-motion`.
- **Security**: Helmet, strict CORS, rate limiting, JWT in HttpOnly cookie or Bearer, input validation via Zod, tenant isolation.
- **Performance**: indexed queries, lean reads, pagination, server‑driven streaming for large timelines, backpressure handling for WS/SSE.
- **Reliability**: idempotent event ingestion, duplicate‑alert prevention, health checks (`/healthz`, `/readyz`).
- **Type Safety**: **TypeScript strict** across FE/BE. No JS files.

---

## 2) High‑Level Architecture

```
(opslite/pulseboard-frontend)  # Next.js 14+, TS, Tailwind v4 + styled-components
  app/           # App Router, RSC streaming, Middleware for auth
  components/    # Design system (atoms → organisms)
  store/         # Redux Toolkit slices (auth/session)
  query/         # TanStack Query (server cache)
  utils/         # typed fetcher, ws, sse

(pulseboard-backend)          # Express + TS (MVC‑ish)
  src/
    config/       # env, db, logger, security
    common/       # errors, http, paginate, middleware (validate, authGuard, rateLimit)
    realtime/     # ws.ts, sse.ts, stream.ts, pubsub
    modules/
      auth/       # login/logout/me (JWT)
      tenant/     # tenant + membership
      check/      # checks CRUD + scheduler triggers
      incident/   # auto open/resolve, timelines
      audit/      # append‑only logs
      usage/      # idempotent events
```

**Data Flow (typical)**
1. Scheduler/worker triggers check → backend performs HTTP probe.
2. Backend evaluates result → if failing, **create/update incident** and append to **audit**.
3. Backend **broadcasts** via **WebSocket** (dashboard) and **SSE** (public/status).
4. Frontend (Next.js) updates the **dashboard in real time** and **streams timelines** on detail pages.

---

## 3) Tenancy & Access

- **Multi‑tenant**: All collections are scoped by `tenantId`. Repositories must **inject `tenantId`** automatically in queries.
- **Roles**: `owner`, `admin`, `operator`, `viewer`. Route guards enforce minimal access.
- **Org model**: One corporate account can manage many brands (tenants). Each brand sees only its data.

---

## 4) Real‑Time Channels

- **WebSockets** (`/ws`) for operator dashboard (bi‑directional; rooms per `tenantId`).
- **SSE** (`GET /api/v1/incidents/stream?tenantId=...`) for public/low‑overhead live feeds.
- **Streaming HTTP** for large timelines (`GET /api/v1/incidents/:id/timeline/stream`).
- Heartbeats (SSE), ping/pong (WS), and graceful cleanup on disconnect.

---

## 5) API Surface (excerpt)

**Checks**
- `GET /api/v1/checks` (list) `?page=&limit=&q=&status=`
- `POST /api/v1/checks` (create)
- `PATCH /api/v1/checks/:id` (update)
- `DELETE /api/v1/checks/:id`

**Incidents**
- `GET /api/v1/incidents` (list)
- `GET /api/v1/incidents/:id` (detail)
- `PATCH /api/v1/incidents/:id` (update status, add note)
- `GET /api/v1/incidents/stream` (**SSE**)
- `GET /api/v1/incidents/:id/timeline/stream` (**HTTP streaming**)

**Auth**
- `POST /api/v1/auth/login` → sets HttpOnly cookie or returns Bearer
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`

**Usage (idempotent)**
- `POST /api/v1/usage/events` (must include `Idempotency-Key`)

---

## 6) Security Baseline

- Helmet + CSP tuned for Next static assets.
- CORS: allow only `http://localhost:3000`; `credentials: true` if using cookies.
- Rate limits: global + stricter for `/auth` and `/usage`.
- bcrypt (≥ 12 rounds); JWT with short TTL; optional refresh rotation.
- Validate **every input** with Zod; **reject unknown fields**.
- Atlas: least‑privilege DB user, TLS, IP allowlist.
- Audit trail on all mutations.

---

## 7) Implementation Plan (3–4 days)

**Day 1**
- Repos + scaffolding (strict TS, ESLint, Prettier, Husky).
- Backend: auth, tenant, checks model; `GET/POST /checks`; healthz/readyz; Zod; Helmet; CORS.
- Frontend: App Router pages, SSR list of checks, providers (Redux + Query + Theme), base design tokens.

**Day 2**
- WS server and SSE endpoint; frontend WS + SSE clients; dashboard live updates.
- Incidents module: auto‑open on failure; timelines; streaming endpoint.
- Add Redux slice for session; Zustand for UI.

**Day 3**
- Design system primitives (Button, Input, Card), empty states, pagination, filters.
- Accessibility pass (skip links, focus, color contrast, dialogs).
- Tests: backend (routes + idempotency + SSE), frontend (RTL + a11y checks).

**Day 4 (polish)**
- Metrics logs (p50/p95 per route), request IDs, backpressure tuning.
- Export CSV for incident history; error boundaries; loading/skeleton states.

---

## 8) Environment & Ports

- **Frontend** (`pulseboard-frontend`):
  - `.env.local`
    ```env
    NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api/v1
    NEXT_PUBLIC_WS_URL=ws://localhost:4000/ws
    ```
- **Backend** (`pulseboard-backend`):
  - `.env`
    ```env
    NODE_ENV=development
    PORT=4000
    MONGODB_URI="mongodb+srv://<user>:<pass>@<cluster>/pulseboard"
    JWT_SECRET="change-me"
    CORS_ORIGIN=http://localhost:3000
    ```

---

## 9) Acceptance Criteria (MVP)
- Create checks; see them on dashboard (SSR + Query cache).
- Fail a check → **incident auto‑opens**; dashboard **updates live** via WS.
- Public status page **receives SSE** updates.
- Timeline detail **streams progressively**.
- Export history (CSV) for a range of dates.
- All endpoints validated; tests pass; TypeScript strict passes; a11y checks pass.

---

## 10) Strict Rules & Restrictions
1. **TypeScript only**; `"strict": true` both repos.
2. **Semantic & accessible HTML**; visible focus rings, skip link, labels.
3. **Tailwind v4** utilities for layout/spacing; **styled‑components** for tokens & complex states.
4. **Redux Toolkit + thunk** for session/app flows; **TanStack Query** for server cache; **Zustand** for UI state.
5. **Professional REST**: versioned, paginated, filtered, sorted; consistent `{ data }` or `{ error }` envelopes.
6. **Two repos, two ports**; FE/BE communicate only via HTTP/WS.
7. **Real‑time**: WebSockets (dashboard), SSE (public), streaming endpoints (timelines).
8. **Security**: Helmet, rate limit, CORS minimal, bcrypt + JWT, tenant isolation, audit.

