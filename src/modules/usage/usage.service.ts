/**
 * src/modules/usage/usage.service.ts — Usage Event Business Logic
 *
 * Single function: `ingestEvent`
 *
 * ── Idempotency guarantee ─────────────────────────────────────────────────────
 *   The unique index on `idempotencyKey` makes the DB the authoritative source
 *   of truth for deduplication. The flow is:
 *
 *     1. Attempt an insert with the client-supplied idempotency key.
 *     2a. Insert succeeds  → new event; return it with HTTP 201.
 *     2b. MongoServerError code 11000 (duplicate key)
 *                          → event already ingested; fetch and return the
 *                            original record with HTTP 200 (idempotent success).
 *
 *   No upsert is used — an insert + catch ensures the stored payload is always
 *   from the first delivery and can never be mutated by a retry.
 *
 * ── Why not use findOneAndUpdate with upsert? ─────────────────────────────────
 *   `upsert: true` would work but it replaces the document on conflict, meaning
 *   a retry with a different payload would silently overwrite the original.
 *   The insert-and-catch pattern is explicit about which delivery "wins".
 */

import { Types } from 'mongoose';
import { MongoServerError } from 'mongodb';
import { UsageEvent, type UsageEventPublic } from './usage.model';
import type { CreateUsageEventDto } from './usage.validation';

// ── Helpers ───────────────────────────────────────────────────────────────────

function toPublic(doc: Record<string, unknown>): UsageEventPublic {
  return {
    _id: String(doc._id),
    idempotencyKey: doc.idempotencyKey as string,
    tenantId: String(doc.tenantId),
    kind: doc.kind as string,
    payload: doc.payload as Record<string, unknown> | undefined,
    ts: doc.ts as Date,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Ingests a single usage event idempotently.
 *
 * @param tenantId        Tenant ObjectId string.
 * @param idempotencyKey  Value from the `Idempotency-Key` request header.
 * @param dto             Validated body — `{ kind, payload? }`.
 * @returns               `{ event, created }` where `created` is false when the
 *                        key was already seen (duplicate delivery).
 */
export async function ingestEvent(
  tenantId: string,
  idempotencyKey: string,
  dto: CreateUsageEventDto,
): Promise<{ event: UsageEventPublic; created: boolean }> {
  try {
    const doc = await UsageEvent.create({
      idempotencyKey,
      tenantId: new Types.ObjectId(tenantId),
      kind: dto.kind,
      payload: dto.payload,
    });

    return {
      event: toPublic(doc.toObject() as unknown as Record<string, unknown>),
      created: true,
    };
  } catch (err) {
    // MongoServerError code 11000 = duplicate key violation on idempotencyKey.
    // Treat this as an idempotent success: fetch the original record and return it.
    if (err instanceof MongoServerError && err.code === 11000) {
      const existing = await UsageEvent.findOne({ idempotencyKey }).lean().exec();

      if (existing) {
        return {
          event: toPublic(existing as unknown as Record<string, unknown>),
          created: false,
        };
      }
    }

    // Any other error is unexpected — re-throw for the global error handler.
    throw err;
  }
}
