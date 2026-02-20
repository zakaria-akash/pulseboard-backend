/**
 * tests/auth/auth.test.ts — Auth Route Integration Tests
 *
 * Covers:
 *   POST /api/v1/auth/login  — happy path (200 + cookie) and wrong-password (401)
 *   GET  /api/v1/auth/me     — no token (401) and valid token (200 + user)
 */

import request from 'supertest';
import app from '../../src/app';
import { setup, teardown, type SeedData } from '../fixtures/seed';

let seed: SeedData;

beforeAll(async () => {
  seed = await setup();
}, 30_000);

afterAll(async () => {
  await teardown();
});

describe('Auth routes', () => {
  it('POST /auth/login returns 200 + cookie on valid credentials', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: seed.userA.email, password: seed.userA.password });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('token');
    expect(res.body.data).toHaveProperty('user');
    expect(res.body.data.user).toHaveProperty('email', seed.userA.email);
    // HttpOnly cookie should be set
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('POST /auth/login returns 401 on wrong password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: seed.userA.email, password: 'wrong-password-123' });

    expect(res.status).toBe(401);
    expect(res.body.error).toHaveProperty('code', 'UNAUTHORIZED');
  });

  it('GET /auth/me returns 401 without token', async () => {
    const res = await request(app).get('/api/v1/auth/me');

    expect(res.status).toBe(401);
  });

  it('GET /auth/me returns 200 with valid token', async () => {
    // First login to get a real token
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: seed.userA.email, password: seed.userA.password });

    const { token } = loginRes.body.data as { token: string };

    const meRes = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.data.user).toHaveProperty('email', seed.userA.email);
    expect(meRes.body.data.user).not.toHaveProperty('hash');
  });
});
