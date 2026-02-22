# PulseBoard Backend — Testing Guide

> End-to-end integration tests, in-memory MongoDB, coverage thresholds, and CI gates.

---

## Table of Contents

- [Philosophy](#philosophy)
- [Test Stack](#test-stack)
- [Running Tests](#running-tests)
- [Test Suites](#test-suites)
- [Seed Data](#seed-data)
- [Environment Setup in Tests](#environment-setup-in-tests)
- [Pre-commit & Pre-push Hooks](#pre-commit--pre-push-hooks)
- [CI Pipeline](#ci-pipeline)
- [Coverage Thresholds](#coverage-thresholds)
- [Writing New Tests](#writing-new-tests)

---

## Philosophy

- **Integration over unit** — tests exercise real Express routes, real Mongoose models, and real business logic against an in-memory MongoDB instance. No mocked repositories; no stubs for database calls.
- **Isolation** — every test file spins up its own `MongoMemoryServer` via `setup()` and tears it down with `teardown()`. Suites cannot contaminate each other's data.
- **Realistic tokens** — JWTs are signed in-process with `jsonwebtoken` using the same `JWT_SECRET` / `iss` / `aud` claims the `authGuard` middleware verifies. No special test-mode bypass in production code.
- **Deterministic** — `--runInBand` serialises suites; `--forceExit` prevents Jest from hanging on open handles (SSE connections, timers).

---

## Test Stack

| Package | Role |
|---|---|
| [Jest](https://jestjs.io) | Test runner, assertions, coverage |
| [ts-jest](https://kulshekhar.github.io/ts-jest/) | TypeScript transform — no separate build step |
| [Supertest](https://github.com/ladjs/supertest) | HTTP assertions against the Express app |
| [mongodb-memory-server](https://github.com/nodkz/mongodb-memory-server) | Real `mongod` binary in-process — no external DB needed |
| [bcrypt](https://github.com/kelektiv/node.bcrypt.js) | Password hashing in seed (rounds=4 for speed) |
| [@types/jest](https://www.npmjs.com/package/@types/jest) | Jest global type definitions |

---

## Running Tests

```bash
# Run all tests (serialised, force-exit after all suites finish)
npm test

# Interactive watch mode — reruns affected suites on file save
npm run test:watch

# Run tests and collect coverage with threshold enforcement
npm run test:coverage
```

**Single suite** — pass a path pattern directly to Jest:

```bash
npx jest tests/auth
npx jest tests/incident
npx jest tests/realtime/sse
```

**Single test case** — use `-t` to match by name:

```bash
npx jest tests/check --testNamePattern="Cross-tenant access returns 404"
```

---

## Test Suites

```
tests/
├── fixtures/
│   └── seed.ts              # MongoMemoryServer lifecycle + seed helper
├── setup.ts                 # process.env bootstrap (runs before every suite)
├── auth/
│   └── auth.test.ts         # 4 tests — login, wrong password, /me unauth, /me valid
├── check/
│   └── check.test.ts        # 4 tests — list, create, cross-tenant 404, validation 400
├── incident/
│   └── incident.test.ts     # 5 tests — auto-open, dedup, transition, bad transition, note
├── usage/
│   └── idempotency.test.ts  # 2 tests — duplicate key 200, missing header 400
└── realtime/
    └── sse.test.ts          # 2 tests — content-type, disconnect resilience
```

---

### `tests/auth/auth.test.ts` — Auth routes

Uses real `login` requests to obtain a cookie-based token, then exercises `/me`.

| # | Test | Validates |
|---|---|---|
| 1 | `POST /auth/login` happy path | `200`, `{ data: { token, user } }`, `Set-Cookie` header present |
| 2 | `POST /auth/login` wrong password | `401`, `error.code === 'UNAUTHORIZED'` |
| 3 | `GET /auth/me` without token | `401` |
| 4 | `GET /auth/me` with Bearer token | `200`, user object returned, `hash` field absent |

---

### `tests/check/check.test.ts` — Check CRUD & isolation

Tokens are signed directly via `jsonwebtoken` (bypassing `/auth/login`) to avoid consuming the `authLimiter` quota.

| # | Test | Validates |
|---|---|---|
| 1 | `GET /checks` authenticated | `200`, paginated `{ items, total, page, limit }`, seeded check present |
| 2 | `POST /checks` valid body | `201`, returned doc has correct `name` and `tenantId` |
| 3 | `GET /checks/:id` from wrong tenant | `404` — strict tenant isolation |
| 4 | `POST /checks` missing `url` | `400`, `error.code === 'VALIDATION_ERROR'`, Zod `details` array present |

---

### `tests/incident/incident.test.ts` — Incident lifecycle

Publishes directly to the `probe:events` pubsub channel — the same path the scheduler uses — to trigger the incident service without needing a running scheduler.

> **Order dependency:** tests 3, 4, and 5 operate on the same seeded `incidentA` document in sequence (`open → monitoring` in test 3; backward transition rejected in test 4; note appended in test 5). Jest runs tests within a `describe` block in declaration order.

| # | Test | Validates |
|---|---|---|
| 1 | `check:fail` event opens an incident | Incident document created in DB with `status: 'open'` |
| 2 | Duplicate `check:fail` does not create second incident | `countDocuments === 1` after two identical events |
| 3 | `PATCH /incidents/:id` `open → monitoring` | `200`, `{ status: 'monitoring' }` |
| 4 | `PATCH /incidents/:id` `monitoring → open` (invalid) | `400`, `error.code === 'VALIDATION_ERROR'` |
| 5 | `PATCH /incidents/:id` with note | `200`, `notes` array has new entry with correct `text` |

---

### `tests/usage/idempotency.test.ts` — Idempotent event ingestion

| # | Test | Validates |
|---|---|---|
| 1 | Same `Idempotency-Key` sent twice | First `201`, second `200` — `_id` is identical in both responses |
| 2 | Missing `Idempotency-Key` header | `400`, `error.code === 'VALIDATION_ERROR'` |

---

### `tests/realtime/sse.test.ts` — SSE stream

Supertest cannot hold open a streaming response, so these tests use Node's built-in `http` module to create a real TCP connection against a bound port, inspect response headers, then destroy the socket.

| # | Test | Validates |
|---|---|---|
| 1 | Connect to `/incidents/stream` | `statusCode === 200`, `content-type` contains `text/event-stream` |
| 2 | Abrupt client disconnect | Server remains alive — `/healthz` still returns `200` afterwards |

---

## Testing the New Endpoints

### Swagger UI (`GET /api/v1/docs`)

The Swagger UI can be verified with a simple supertest assertion:

```ts
import request from 'supertest';
import app from '../../src/app';

it('serves Swagger UI at /api/v1/docs', async () => {
  const res = await request(app).get('/api/v1/docs/');
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/html/);
});

it('serves raw OpenAPI spec at /api/v1/docs.json', async () => {
  const res = await request(app).get('/api/v1/docs.json');
  expect(res.status).toBe(200);
  expect(res.body.openapi).toBe('3.0.0');
  expect(res.body.info.title).toBe('PulseBoard API');
});
```

### Request Timeout (408)

The 30-second timeout is not practical to test in normal Jest runs (`--testTimeout` default is 5 s). Verify manually with a slow endpoint simulation, or stub `res.setTimeout` in unit tests. The important assertion is that `!res.headersSent` prevents double-responds on streaming connections.

### Response Compression

Supertest does not decompress gzip by default. To verify compression is active:

```bash
curl -H "Accept-Encoding: gzip" -I http://localhost:4000/api/v1/checks \
  -H "Authorization: Bearer <token>"
# Look for: Content-Encoding: gzip
```

---

## Seed Data

`tests/fixtures/seed.ts` creates the following documents in the in-memory database on every `setup()` call:

```
Tenant Alpha  (slug: "tenant-alpha")
  ├── User A  — owner-a@example.com  / role: owner  / password: "PasswordA1!"
  ├── Check A — https://example.com  / maxLatencyMs: 5000 / enabled: true
  └── Incident A — status: open  (linked to Check A)

Tenant Beta   (slug: "tenant-beta")
  └── User B  — owner-b@example.com  / role: owner  / password: "PasswordB1!"
```

The returned `SeedData` object exposes string IDs and plaintext passwords so tests can build tokens and HTTP requests without hard-coding values:

```typescript
interface SeedData {
  tenantA:   { id: string; slug: string };
  tenantB:   { id: string; slug: string };
  userA:     { id: string; email: string; password: string; tenantId: string };
  userB:     { id: string; email: string; password: string; tenantId: string };
  checkA:    { id: string; tenantId: string; name: string };
  incidentA: { id: string; tenantId: string; checkId: string };
}
```

**Usage pattern in every test file:**

```typescript
import { setup, teardown, type SeedData } from '../fixtures/seed';

let seed: SeedData;

beforeAll(async () => {
  seed = await setup();
}, 30_000);   // extended timeout — first run downloads the mongod binary

afterAll(async () => {
  await teardown();
});
```

> The 30-second `beforeAll` timeout covers the first-ever run, during which `mongodb-memory-server` downloads a real `mongod` binary (~50 MB). Subsequent runs use a cached binary and take 2–4 s.

---

## Environment Setup in Tests

`tests/setup.ts` is listed in `jest.config.ts` under `setupFiles` — it runs **before every test file** and before any app module is imported. It injects the environment variables that `src/config/env.ts` validates at parse time:

```typescript
process.env.MONGO_URI     = 'mongodb://localhost:27017/pulseboard-test-placeholder';
process.env.JWT_SECRET    = 'test-jwt-secret-for-pulseboard-tests-only-32chars!';
process.env.BCRYPT_ROUNDS = '4';   // fast hashing — never use < 10 in production
process.env.NODE_ENV      = 'test';
process.env.CORS_ORIGIN   = 'http://localhost:3000';
```

The `MONGO_URI` placeholder is overwritten at runtime by the `MongoMemoryServer` URI inside `seed.ts`. The app never connects to the placeholder address because `server.ts` (which calls `connectDB`) is never imported in tests.

**`JWT_SECRET` must match** the secret used in `makeToken()` helpers across test files. If you change the secret in `setup.ts`, update all `makeToken` calls or factor them into a shared helper.

---

## Pre-commit & Pre-push Hooks

Husky gates are configured in `.husky/`:

| Hook | Command | Purpose |
|---|---|---|
| `pre-commit` | `npx lint-staged` | Auto-fix ESLint violations and format with Prettier on staged `.ts` files before the commit lands |
| `pre-push` | `npm run typecheck && npm test -- --passWithNoTests` | Full type-check + test suite before any push; `--passWithNoTests` allows pushes from branches that have no tests yet |

`lint-staged` config (in `package.json`):

```json
"lint-staged": {
  "*.ts": ["eslint --fix", "prettier --write"]
}
```

---

## CI Pipeline

GitHub Actions runs on every push to `main` and on every pull request targeting `main` (`.github/workflows/ci.yml`).

```
┌─────────────────────────────────────────────────────────────────────┐
│  Job: Type-check · Lint · Test                                      │
│                                                                     │
│  1. Checkout                                                        │
│  2. Setup Node.js 20                                                │
│  3. npm ci --legacy-peer-deps                                       │
│  4. Gate 1: npm run typecheck         — zero TypeScript errors      │
│  5. Gate 2: npm run lint              — zero ESLint errors          │
│  6. Gate 3: npm run format:check      — all files Prettier-clean    │
│  7. Gate 4: npm run test:coverage     — tests pass + thresholds met │
└─────────────────────────────────────────────────────────────────────┘
```

**CI environment variables** injected at the `test:coverage` step:

```yaml
env:
  MONGOMS_DOWNLOAD_DIR: /tmp/mongodb-memory-server   # cache the mongod binary
  MONGO_URI:      mongodb://localhost:27017/pulseboard-ci
  JWT_SECRET:     ci-jwt-secret-placeholder-must-be-32chars!!
  BCRYPT_ROUNDS:  "4"      # fast hashing keeps CI under 2 min
  NODE_ENV:       test
  CORS_ORIGIN:    http://localhost:3000
```

> A PR cannot be merged to `main` while any gate is red. Configure this under **Settings → Branches → Branch protection rules** — require the `ci` status check to pass.

---

## Coverage Thresholds

Thresholds are enforced by Jest and will fail `npm run test:coverage` (and therefore the CI `test:coverage` gate) if not met.

| Metric | Threshold |
|---|---|
| Lines | 70% |
| Functions | 70% |
| Statements | 70% |
| Branches | 60% |

**Coverage is collected from `src/**/*.ts`**, excluding:

- `src/types/**` — declaration files only; no executable code.
- `src/server.ts` — entry point; covered by integration testing rather than unit tests.

View the HTML coverage report after a local run:

```bash
npm run test:coverage
open coverage/lcov-report/index.html
```

---

## Writing New Tests

### 1. Create the test file

Place it under `tests/<module>/` following the existing pattern:

```
tests/
  mymodule/
    mymodule.test.ts
```

### 2. Bootstrap the DB

Every test file that touches the database must call `setup` / `teardown`:

```typescript
import { setup, teardown, type SeedData } from '../fixtures/seed';

let seed: SeedData;

beforeAll(async () => { seed = await setup(); }, 30_000);
afterAll(async () => { await teardown(); });
```

### 3. Sign tokens without hitting `/auth/login`

Use the `makeToken` pattern (already present in most test files) to skip the auth rate-limiter:

```typescript
import jwt from 'jsonwebtoken';
import { env } from '../../src/config/env';

function makeToken(userId: string, tenantId: string, role = 'owner'): string {
  return jwt.sign({ sub: userId, email: 'test@example.com', role, tenantId }, env.JWT_SECRET, {
    expiresIn: 3600,
    issuer: 'pulseboard',
    audience: 'pulseboard-api',
  });
}
```

### 4. Make HTTP assertions

```typescript
import request from 'supertest';
import app from '../../src/app';

it('returns 200 on a valid request', async () => {
  const token = makeToken(seed.userA.id, seed.tenantA.id);

  const res = await request(app)
    .get('/api/v1/my-endpoint')
    .set('Authorization', `Bearer ${token}`);

  expect(res.status).toBe(200);
  expect(res.body.data).toHaveProperty('myField');
});
```

### 5. Test pub/sub-driven behaviour

For anything that reacts to pubsub events (e.g. incident auto-open), publish directly to the channel and await a brief `setTimeout` for the fire-and-forget DB write to settle:

```typescript
import { publish } from '../../src/realtime/pubsub';

publish('probe:events', { event: 'check:fail', checkId: '...', tenantId: '...' });
await new Promise<void>((resolve) => setTimeout(resolve, 150));

// Now assert on the DB state
const doc = await MyModel.findOne({ ... }).lean();
expect(doc).not.toBeNull();
```

### 6. Checklist before opening a PR

- [ ] `npm run typecheck` — zero TypeScript errors.
- [ ] `npm run lint` — zero ESLint errors.
- [ ] `npm run format:check` — all files Prettier-clean (or run `npm run format` first).
- [ ] `npm run test:coverage` — all tests pass **and** thresholds are met.
- [ ] New test file has both `beforeAll(setup)` and `afterAll(teardown)`.
- [ ] No `process.env.MONGO_URI` hard-coded — rely on `tests/setup.ts`.
- [ ] No `console.log` left in test files (ESLint `no-console: warn` will flag it).
