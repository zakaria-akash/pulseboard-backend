/**
 * tests/fixtures/seed.ts — Test Database Seeding
 *
 * Starts an in-memory MongoDB instance (mongodb-memory-server), connects
 * Mongoose to it, seeds a minimal dataset, and returns the seeded IDs so
 * test files can reference specific documents.
 *
 * ── Design ────────────────────────────────────────────────────────────────────
 *   Each test file that imports `setup()` gets a fresh, isolated in-memory
 *   database. `teardown()` disconnects Mongoose and stops the server so no
 *   resources leak between test suites.
 *
 * ── Seeded data ───────────────────────────────────────────────────────────────
 *   Tenant A  — "Tenant Alpha" / slug "tenant-alpha"
 *     └── User A  — owner-a@example.com / role: owner
 *     └── Check A — https://example.com / maxLatencyMs: 5000
 *     └── Incident A — status: open (linked to Check A)
 *
 *   Tenant B  — "Tenant Beta"  / slug "tenant-beta"
 *     └── User B  — owner-b@example.com / role: owner
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *   import { setup, teardown, type SeedData } from '../fixtures/seed';
 *
 *   let seed: SeedData;
 *   beforeAll(async () => { seed = await setup(); }, 30_000);
 *   afterAll(async () => { await teardown(); });
 */

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import bcrypt from 'bcrypt';
import { Tenant } from '../../src/modules/tenant/tenant.model';
import { User } from '../../src/modules/auth/user.model';
import { Check } from '../../src/modules/check/check.model';
import { Incident } from '../../src/modules/incident/incident.model';

// Module-level server reference so `teardown()` can stop it.
let mongod: MongoMemoryServer;

// ── Exported seed data shape ───────────────────────────────────────────────────

export interface SeedData {
  tenantA: { id: string; slug: string };
  tenantB: { id: string; slug: string };
  userA: { id: string; email: string; password: string; tenantId: string };
  userB: { id: string; email: string; password: string; tenantId: string };
  checkA: { id: string; tenantId: string; name: string };
  incidentA: { id: string; tenantId: string; checkId: string };
}

// ── setup ─────────────────────────────────────────────────────────────────────

/**
 * Starts an in-memory MongoDB, connects Mongoose, seeds test data.
 * Call in `beforeAll` — takes ~2–10 s on first run (binary download).
 */
export async function setup(): Promise<SeedData> {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri);

  // ── Tenants ──────────────────────────────────────────────────────────────
  // Use a placeholder ownerId; we update it after creating the users.
  const placeholder = new mongoose.Types.ObjectId();

  const tenantADoc = await Tenant.create({
    name: 'Tenant Alpha',
    slug: 'tenant-alpha',
    ownerId: placeholder,
  });

  const tenantBDoc = await Tenant.create({
    name: 'Tenant Beta',
    slug: 'tenant-beta',
    ownerId: placeholder,
  });

  // ── Users ─────────────────────────────────────────────────────────────────
  const passwordA = 'PasswordA1!';
  const hashA = await bcrypt.hash(passwordA, 4);
  const userADoc = await User.create({
    tenantId: tenantADoc._id,
    email: 'owner-a@example.com',
    hash: hashA,
    role: 'owner',
  });

  const passwordB = 'PasswordB1!';
  const hashB = await bcrypt.hash(passwordB, 4);
  const userBDoc = await User.create({
    tenantId: tenantBDoc._id,
    email: 'owner-b@example.com',
    hash: hashB,
    role: 'owner',
  });

  // Back-fill real ownerId on both tenants.
  await Tenant.findByIdAndUpdate(tenantADoc._id, { ownerId: userADoc._id });
  await Tenant.findByIdAndUpdate(tenantBDoc._id, { ownerId: userBDoc._id });

  // ── Check ──────────────────────────────────────────────────────────────────
  const checkADoc = await Check.create({
    tenantId: tenantADoc._id,
    name: 'Example Check',
    url: 'https://example.com',
    expectedStatus: 200,
    maxLatencyMs: 5000,
    enabled: true,
  });

  // ── Incident ───────────────────────────────────────────────────────────────
  const now = new Date();
  const incidentADoc = await Incident.create({
    tenantId: tenantADoc._id,
    checkId: checkADoc._id,
    status: 'open',
    openedAt: now,
    lastChangeAt: now,
    notes: [],
  });

  return {
    tenantA: { id: tenantADoc._id.toString(), slug: 'tenant-alpha' },
    tenantB: { id: tenantBDoc._id.toString(), slug: 'tenant-beta' },
    userA: {
      id: userADoc._id.toString(),
      email: 'owner-a@example.com',
      password: passwordA,
      tenantId: tenantADoc._id.toString(),
    },
    userB: {
      id: userBDoc._id.toString(),
      email: 'owner-b@example.com',
      password: passwordB,
      tenantId: tenantBDoc._id.toString(),
    },
    checkA: {
      id: checkADoc._id.toString(),
      tenantId: tenantADoc._id.toString(),
      name: 'Example Check',
    },
    incidentA: {
      id: incidentADoc._id.toString(),
      tenantId: tenantADoc._id.toString(),
      checkId: checkADoc._id.toString(),
    },
  };
}

// ── teardown ──────────────────────────────────────────────────────────────────

/**
 * Disconnects Mongoose and stops the in-memory MongoDB server.
 * Call in `afterAll`.
 */
export async function teardown(): Promise<void> {
  await mongoose.disconnect();
  await mongod.stop();
}
