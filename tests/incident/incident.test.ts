/**
 * tests/incident/incident.test.ts — Incident Lifecycle Integration Tests
 *
 * Covers:
 *   - Auto-open on check:fail (via pubsub bridge)
 *   - Deduplication: duplicate check:fail does not open a second incident
 *   - Valid status transition: open → monitoring (200)
 *   - Invalid status transition: monitoring → open (400)
 *   - Add note: note appears in incident.notes[]
 *
 * Incidents are created automatically by the probe event bridge, not via HTTP.
 * To test that flow we publish directly to the 'probe:events' pubsub channel
 * (same channel the scheduler uses) after calling initIncidentSubscriptions().
 */

import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import app from '../../src/app';
import { env } from '../../src/config/env';
import { publish } from '../../src/realtime/pubsub';
import { initIncidentSubscriptions } from '../../src/modules/incident/incident.service';
import { Incident } from '../../src/modules/incident/incident.model';
import { setup, teardown, type SeedData } from '../fixtures/seed';

let seed: SeedData;
let stopSubscriptions: () => void;

function makeToken(userId: string, tenantId: string, role = 'owner'): string {
  return jwt.sign({ sub: userId, email: 'test@example.com', role, tenantId }, env.JWT_SECRET, {
    expiresIn: 3600,
    issuer: 'pulseboard',
    audience: 'pulseboard-api',
  });
}

beforeAll(async () => {
  seed = await setup();
  stopSubscriptions = initIncidentSubscriptions();
}, 30_000);

afterAll(async () => {
  stopSubscriptions();
  await teardown();
});

describe('Incident lifecycle', () => {
  it('check:fail event opens an incident automatically', async () => {
    // Use a brand-new check ObjectId that has no existing incident
    const freshCheckId = new mongoose.Types.ObjectId().toString();

    publish('probe:events', {
      event: 'check:fail',
      checkId: freshCheckId,
      tenantId: seed.tenantA.id,
    });

    // Allow the fire-and-forget async DB insert to complete
    await new Promise<void>((resolve) => setTimeout(resolve, 150));

    const incident = await Incident.findOne({
      tenantId: seed.tenantA.id,
      checkId: freshCheckId,
    })
      .lean()
      .exec();

    expect(incident).not.toBeNull();
    expect(incident?.status).toBe('open');
  });

  it('duplicate check:fail does not open a second incident', async () => {
    const freshCheckId = new mongoose.Types.ObjectId().toString();

    // Fire the event twice
    publish('probe:events', {
      event: 'check:fail',
      checkId: freshCheckId,
      tenantId: seed.tenantA.id,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    publish('probe:events', {
      event: 'check:fail',
      checkId: freshCheckId,
      tenantId: seed.tenantA.id,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    const count = await Incident.countDocuments({
      tenantId: seed.tenantA.id,
      checkId: freshCheckId,
    }).exec();

    expect(count).toBe(1);
  });

  it('valid status transition open → monitoring succeeds', async () => {
    const token = makeToken(seed.userA.id, seed.tenantA.id, 'operator');

    const res = await request(app)
      .patch(`/api/v1/incidents/${seed.incidentA.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'monitoring' });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('status', 'monitoring');
  });

  it('invalid status transition monitoring → open returns 400', async () => {
    // incidentA was just moved to 'monitoring' in the previous test
    const token = makeToken(seed.userA.id, seed.tenantA.id, 'operator');

    const res = await request(app)
      .patch(`/api/v1/incidents/${seed.incidentA.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'open' });

    expect(res.status).toBe(400);
    expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
  });

  it('adding a note appends to incident notes[]', async () => {
    const token = makeToken(seed.userA.id, seed.tenantA.id, 'operator');

    const res = await request(app)
      .patch(`/api/v1/incidents/${seed.incidentA.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ note: { text: 'Investigating the root cause' } });

    expect(res.status).toBe(200);
    const notes = res.body.data.notes as { text: string }[];
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[notes.length - 1]).toHaveProperty('text', 'Investigating the root cause');
  });
});
