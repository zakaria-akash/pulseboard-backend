
# PulseBoard — Software Requirements Specification (SRS)

**Document Version:** 1.0  
**Date:** 2026-02-19  
**Product:** PulseBoard — Uptime & Incident Control Room  
**Tech Stack:** Next.js (App Router) + Express.js + MongoDB (Atlas), TypeScript-only, WebSockets/SSE/Streaming

---

## 1. Introduction

### 1.1 Purpose
This SRS defines the functional and non-functional requirements of **PulseBoard**, a web application that monitors the health of websites and online services, opens/updates **incidents** automatically, and provides a **real-time dashboard** (“control room”) plus **exportable history** for post‑incident review. The audience includes product owners, developers, QA engineers, DevOps, and stakeholders in multi-brand organizations.

### 1.2 Scope
PulseBoard enables operators to:
- Configure **health checks** (HTTP reachability, status code expectation, latency threshold).
- Receive **live updates** when checks fail or recover.
- Automatically **open and resolve incidents**, capture timelines/notes, and broadcast updates via **WebSockets** and **SSE**.
- View and export **history** for analysis, reporting, and compliance.
- Support **multi‑tenant** setups (e.g., groups with 25+ brands), ensuring strict data isolation.

### 1.3 Definitions, Acronyms, Abbreviations
- **Check:** A configured probe against a URL or service with expected outcomes.
- **Incident:** A tracked state of service degradation/outage with lifecycle: `open → monitoring → resolved`.
- **Tenant:** An isolated brand/account; corporate users may oversee multiple tenants.
- **SSE:** Server‑Sent Events; one‑way streaming for low‑overhead live feeds.
- **WS:** WebSockets; bidirectional real‑time messaging.

### 1.4 References
- Internal architectural docs (frontend/backend guides generated for PulseBoard).

---

## 2. Overall Description

### 2.1 Product Perspective
PulseBoard is a two‑repo, two‑port full‑stack system:
- **Frontend** (Next.js, `:3000`) renders the dashboard, public status, check/incident screens, and history export; leverages **SSR/SSG/ISR** and **RSC streaming**.
- **Backend** (Express, `:4000`) exposes versioned **REST APIs** (`/api/v1`), a **WS** endpoint (`/ws`), **SSE** feeds, and streaming endpoints for large timelines. A lightweight scheduler triggers periodic checks and emits events.

### 2.2 Product Functions (Summary)
- CRUD for **Checks** and **Incidents**; automated incident creation on failures.
- **Activity feed** and **incident timeline** with streaming.
- **Real-time dashboard** using WebSockets (operators) and **SSE** (public/status page).
- **Audit logs** for all mutations; **CSV export** for history.
- **Authentication & authorization** with roles (`owner`, `admin`, `operator`, `viewer`).

### 2.3 User Classes and Characteristics
- **Owner/Admin (Corporate):** Cross‑tenant visibility; manage tenants, users, policies.
- **Operator (Brand IT/Support):** Configure checks, acknowledge incidents, add notes.
- **Viewer (Read‑only):** Observe status and history; export reports.
- **Public User:** Access public status page (no auth).

### 2.4 Operating Environment
- Browser support: latest Chrome, Edge, Firefox, Safari (desktop & mobile).  
- Server: Node.js LTS, MongoDB Atlas (TLS), container‑ready.

### 2.5 Design and Implementation Constraints
- **TypeScript only** (strict) across front and back; no JavaScript files.
- Two separate repositories and ports; communication only via HTTP/WS.
- Multi‑tenant isolation at repository/service layers; all queries must filter by `tenantId`.
- Privacy/security: Helmet, CORS (frontend origin only), rate limiting, bcrypt, JWT.

### 2.6 Assumptions and Dependencies
- Reliable outbound network to perform checks against external URLs.
- MongoDB Atlas availability and network access (allowlists, credentials).
- Optional: SMTP/SMS providers for alerts (future phase; not MVP).

---

## 3. System Features and Requirements

### 3.1 Checks Management
**Description:** Operators create HTTP checks with expected status code and latency threshold; enable/disable per check.  
**Functional Requirements:**
1. The system SHALL allow creating, updating, listing, and deleting checks (`name`, `url`, `expectedStatus`, `maxLatencyMs`, `enabled`).
2. The system SHALL run checks on a schedule (configurable global interval; per‑check jitter to avoid thundering herd).
3. The system SHALL record results (pass/fail, latency, timestamp) and store the latest outcome in the check record.
4. The system SHOULD deduplicate transient duplicates and avoid alert storms.

### 3.2 Incident Lifecycle
**Description:** Incidents are automatically opened on failure and updated on recovery.  
**Functional Requirements:**
1. The system SHALL open an incident when a check transitions from pass→fail (or meets failure conditions for N consecutive runs if configured). 
2. The system SHALL update incident status to `monitoring` or `resolved` upon recovery conditions. 
3. The system SHALL allow operators to add notes and change status with reason. 
4. The system SHALL broadcast incident events via WS (operators) and SSE (public/status page).

### 3.3 Real‑Time Dashboard and Streams
**Description:** Live operational view (control room).  
**Functional Requirements:**
1. The system SHALL provide a WS endpoint (`/ws`) with rooms segmented by `tenantId`.
2. The system SHALL provide SSE endpoint(s) for low‑overhead public feeds with heartbeat comments every ~20 seconds.
3. The system SHALL provide streaming HTTP responses for large timelines (`/incidents/:id/timeline/stream`).
4. The system SHALL handle disconnects gracefully and clean up listeners.

### 3.4 Multi‑Tenant Access and Roles
**Functional Requirements:**
1. The system SHALL isolate all data by `tenantId` at repository/service layers.
2. The system SHALL enforce role‑based access on sensitive endpoints (`owner/admin/operator/viewer`).
3. The system SHALL allow a corporate owner/admin to switch/view multiple tenants.

### 3.5 Activity History and Export
**Functional Requirements:**
1. The system SHALL maintain append‑only audit logs for all mutations (who, when, what, meta). 
2. The system SHALL allow CSV export of incidents and check results within a date range. 
3. The system SHOULD provide pagination and filtering on history queries.

---

## 4. External Interface Requirements

### 4.1 User Interfaces (UX/a11y)
- Semantic landmarks (`header`, `nav`, `main`, `aside`, `footer`), **skip link**, visible focus rings, and color contrast ≥ 4.5:1.
- Forms with `<label htmlFor>` and `aria-describedby` for errors; dialogs use `role="dialog"` and `aria-modal="true"` with focus trap.
- Motion reduced honoring `prefers-reduced-motion`.
- Design system: Tailwind v4 utilities + styled‑components tokens (Button/Input/Card/Table variants).

### 4.2 APIs
- REST base: `/api/v1` with JSON envelopes `{ data }` or `{ error }`.
- Representative endpoints: `/checks`, `/incidents`, `/incidents/stream` (SSE), `/incidents/:id/timeline/stream`, `/auth/login`, `/auth/me`, `/usage/events` (idempotent).

### 4.3 Authentication
- JWT in HttpOnly cookie **or** Bearer tokens; short TTL; optional refresh rotation.

---

## 5. Non‑Functional Requirements

### 5.1 Security
- Helmet with CSP tuned for Next assets; HPP; CORS only for `http://localhost:3000` (configurable); rate limits (global + stricter for `/auth` and `/usage`).
- Passwords hashed with bcrypt (≥ 12 rounds). 
- Input validation via Zod on **every route**; unknown fields rejected. 
- Multi‑tenant isolation enforced at repository/service layer and covered by tests.

### 5.2 Performance and Scalability
- MongoDB indexes on `tenantId`, timestamps, and text fields where applicable; use `.lean()` for reads. 
- Pagination for listing endpoints; optional keyset pagination for very deep lists. 
- WebSocket/SSE backpressure handling; fall back to SSE for high fan‑out scenarios. 
- Streaming responses for large incident timelines to improve TTFB and memory usage.

### 5.3 Reliability and Availability
- Health endpoints: `/healthz` (liveness) and `/readyz` (DB connectivity). 
- Idempotency on `/usage/events` with `Idempotency-Key`; duplicate‑alert prevention in check engine. 
- Graceful shutdown: stop accepting new connections, close WS/SSE, drain in‑flight requests.

### 5.4 Maintainability and Testability
- Strict TypeScript; ESLint/Prettier; modular structure (FE components; BE controllers/services/repos). 
- Unit tests for services, Supertest E2E for routes, a11y checks for UI, and tests for SSE connect/close and idempotency logic. 
- CI gates: `typecheck`, `lint`, `test` required before merge.

### 5.5 Usability
- Minimal, professional UI; responsive layouts; consistent component library; clear empty/error states; skeleton loading.

---

## 6. Data Requirements
- **Users:** `{ _id, tenantId, email (unique), hash, role, createdAt, updatedAt }`.
- **Checks:** `{ _id, tenantId, name, url, expectedStatus, maxLatencyMs, enabled, lastResult?, createdAt, updatedAt }`.
- **Incidents:** `{ _id, tenantId, checkId, status, openedAt, resolvedAt?, lastChangeAt, notes[] }`.
- **Audit Logs:** `{ tenantId, actorId, action, target, meta, ts }`.
- **Usage Events (idempotent):** `{ idempotencyKey, tenantId, kind, ts }`.

All collections MUST index `tenantId` and primary query fields; migrations or seed scripts SHALL be versioned.

---

## 7. Constraints, Risks, and Mitigations
- **Network volatility for checks:** add jitter, timeouts, and retries with exponential backoff; dedupe transient failures. 
- **Scaling real‑time:** use tenant rooms and message size limits; consider external pub/sub (Redis/NATS) when horizontally scaling. 
- **Data leaks across tenants:** enforce `tenantId` at repository layer; add tests and logging (request id + tenant id). 
- **Long‑running exports:** perform server streaming or background job (future); for MVP use streaming CSV.

---

## 8. Acceptance Criteria (MVP)
- Users can create checks; checks run and results appear in the dashboard. 
- Failures automatically open incidents; recoveries update/resolve incidents. 
- Operator dashboard receives **WS** updates; public status receives **SSE**; timelines **stream**. 
- CSV export works for selected date ranges. 
- All endpoints validated with Zod; TypeScript strict builds pass; core tests pass; a11y checks pass on key pages.

---

## 9. Future Enhancements (Out of Scope for MVP)
- Email/SMS/Slack alerting; advanced policies (multi‑threshold, maintenance windows). 
- Synthetic transaction checks; regional check runners. 
- SLO/SLA reporting; anomaly detection; AI incident summaries. 
- Public status page branding and embed widgets.

---

**End of SRS**
