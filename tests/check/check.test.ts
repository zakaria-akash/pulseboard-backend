/**
 * tests/check/check.test.ts — Check Route Integration Tests
 *
 * Covers:
 *   GET  /api/v1/checks         — paginated list for the authenticated tenant
 *   POST /api/v1/checks         — create a check (201)
 *   GET  /api/v1/checks/:id     — cross-tenant isolation (404)
 *   POST /api/v1/checks         — validation failure returns 400 + Zod details
 *
 * Tokens are generated directly with `jsonwebtoken` (bypassing the auth endpoint)
 * so this test suite does not consume the authLimiter quota.
 */

import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../src/app';
import { env } from '../../src/config/env';
import { setup, teardown, type SeedData } from '../fixtures/seed';

let seed: SeedData;

/** Creates a signed JWT for the given user without hitting the login endpoint. */
function makeToken(userId: string, tenantId: string, role = 'owner'): string {
  return jwt.sign({ sub: userId, email: 'test@example.com', role, tenantId }, env.JWT_SECRET, {
    expiresIn: 3600,
  });
}

beforeAll(async () => {
  seed = await setup();
}, 30_000);

afterAll(async () => {
  await teardown();
});

describe('Check routes', () => {
  it('GET /checks returns paginated list for authenticated tenant', async () => {
    const token = makeToken(seed.userA.id, seed.tenantA.id);

    const res = await request(app).get('/api/v1/checks').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('items');
    expect(Array.isArray(res.body.data.items)).toBe(true);
    // The seeded Check A should be in the list
    const ids = (res.body.data.items as { _id: string }[]).map((c) => c._id);
    expect(ids).toContain(seed.checkA.id);
  });

  it('POST /checks creates a check and returns 201', async () => {
    const token = makeToken(seed.userA.id, seed.tenantA.id);

    const res = await request(app)
      .post('/api/v1/checks')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'New Integration Check', url: 'https://api.example.com', maxLatencyMs: 3000 });

    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty('name', 'New Integration Check');
    expect(res.body.data).toHaveProperty('tenantId', seed.tenantA.id);
  });

  it('Cross-tenant access returns 404', async () => {
    // User B (tenant B) tries to read User A's check — should get 404
    const tokenB = makeToken(seed.userB.id, seed.tenantB.id);

    const res = await request(app)
      .get(`/api/v1/checks/${seed.checkA.id}`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(404);
  });

  it('POST /checks with missing url returns 400 with Zod details', async () => {
    const token = makeToken(seed.userA.id, seed.tenantA.id);

    const res = await request(app)
      .post('/api/v1/checks')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'No URL Check', maxLatencyMs: 3000 }); // url is required

    expect(res.status).toBe(400);
    expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    // Zod details should point to the missing url field
    expect(res.body.error).toHaveProperty('details');
  });
});
