/**
 * tests/usage/idempotency.test.ts — Usage Event Idempotency Tests
 *
 * Covers:
 *   - Same Idempotency-Key sent twice → second returns 200 with same payload
 *   - Missing Idempotency-Key header → 400
 */

import request from 'supertest';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import app from '../../src/app';
import { env } from '../../src/config/env';
import { setup, teardown, type SeedData } from '../fixtures/seed';

let seed: SeedData;

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

describe('Usage events — idempotency', () => {
  it('same Idempotency-Key sent twice returns 200 with same payload', async () => {
    const token = makeToken(seed.userA.id, seed.tenantA.id);
    const idempotencyKey = uuidv4();
    const body = { kind: 'page_view', payload: { page: '/dashboard' } };

    // First delivery → 201 Created
    const first = await request(app)
      .post('/api/v1/usage/events')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(body);

    expect(first.status).toBe(201);
    expect(first.body.data).toHaveProperty('kind', 'page_view');

    // Second delivery with same key → 200 OK (idempotent, not 409 Conflict)
    const second = await request(app)
      .post('/api/v1/usage/events')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(body);

    expect(second.status).toBe(200);
    // The stored event is identical — same _id
    expect(second.body.data._id).toBe(first.body.data._id);
  });

  it('missing Idempotency-Key header returns 400', async () => {
    const token = makeToken(seed.userA.id, seed.tenantA.id);

    const res = await request(app)
      .post('/api/v1/usage/events')
      .set('Authorization', `Bearer ${token}`)
      // Intentionally no Idempotency-Key header
      .send({ kind: 'page_view' });

    expect(res.status).toBe(400);
    expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
  });
});
