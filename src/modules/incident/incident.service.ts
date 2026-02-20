/**
 * src/modules/incident/incident.service.ts — Incident Business Logic
 *
 * ── Automatic lifecycle ───────────────────────────────────────────────────────
 *
 *   openIncident(tenantId, checkId)
 *     Called when the probe scheduler detects a check:fail event.
 *     Idempotent: if an open/monitoring incident already exists for this check,
 *     the call is a no-op — no duplicate incidents are created.
 *
 *   resolveIncident(tenantId, checkId)
 *     Called when the scheduler detects a check:recover event.
 *     Finds the open/monitoring incident for this check and moves it to
 *     'resolved'. If no open incident exists (e.g. the check recovered before
 *     the first probe completed), the call is a no-op.
 *
 * ── Manual lifecycle ──────────────────────────────────────────────────────────
 *
 *   updateIncident(tenantId, id, dto, actorId)
 *     Called from the REST API (PATCH /incidents/:id).
 *     Validates the status transition against the state machine:
 *       open       → monitoring, resolved
 *       monitoring → resolved
 *       resolved   → (terminal — no further transitions)
 *     If `dto.note` is provided it is appended to the notes array.
 *
 * ── Probe event bridge ────────────────────────────────────────────────────────
 *
 *   The scheduler publishes on a global 'probe:events' channel whenever a
 *   check changes state. `initIncidentSubscriptions()` must be called once
 *   (from server.ts, after startScheduler) to wire those events to the
 *   automatic lifecycle functions above.
 *
 *   Returns a cleanup function for graceful shutdown.
 *
 * ── Pub/sub events published ──────────────────────────────────────────────────
 *
 *   Channel: `incidents:{tenantId}`
 *   Payloads:
 *     { event: 'incident:opened',   incidentId, tenantId, checkId }
 *     { event: 'incident:resolved', incidentId, tenantId, checkId }
 *     { event: 'incident:updated',  incidentId, tenantId }
 *
 *   Phase 11 (WebSocket / SSE) will subscribe to these channels and forward
 *   the payloads to connected browser clients in real time.
 */

import { ValidationError, NotFoundError } from '../../common/errors';
import { publish, subscribe, unsubscribe, type PubSubHandler } from '../../realtime/pubsub';
import * as incidentRepo from './incident.repo';
import * as auditService from '../audit/audit.service';
import type { AuditLogPublic } from '../audit/audit.model';
import { type IncidentPublic, type IncidentStatus } from './incident.model';
import type { UpdateIncidentDto } from './incident.validation';
import logger from '../../config/logger';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Shape of messages published on the global 'probe:events' channel. */
interface ProbeEvent {
  event: 'check:fail' | 'check:recover';
  checkId: string;
  tenantId: string;
}

// ── State machine ─────────────────────────────────────────────────────────────

/**
 * Permitted status transitions for manual updates.
 * Key = current status; value = set of allowed next statuses.
 */
const ALLOWED_TRANSITIONS: Record<IncidentStatus, Set<IncidentStatus>> = {
  open: new Set(['monitoring', 'resolved']),
  monitoring: new Set(['resolved']),
  resolved: new Set(), // terminal state
};

// ── Automatic lifecycle ───────────────────────────────────────────────────────

/**
 * Opens a new incident for the given check.
 * Idempotent — if an open or monitoring incident already exists for this check
 * the function returns early without creating a duplicate.
 *
 * @param tenantId  Tenant ObjectId string.
 * @param checkId   Check ObjectId string whose probe just failed.
 */
export async function openIncident(tenantId: string, checkId: string): Promise<void> {
  // Deduplication: skip if an incident is already open for this check.
  const existing = await incidentRepo.findOpenByCheckId(tenantId, checkId);
  if (existing) {
    logger.debug({ incidentId: existing._id, checkId }, '[Incident] Already open — skipping');
    return;
  }

  const incident = await incidentRepo.create(tenantId, checkId);

  // Audit log — fire-and-forget; failure must not abort the incident creation.
  void auditService.log({
    tenantId,
    actorId: null, // system-generated
    action: 'incident.open',
    targetCollection: 'incidents',
    targetId: incident._id,
    meta: { checkId },
  });

  // Notify real-time subscribers (Phase 11: WS / SSE).
  publish(`incidents:${tenantId}`, {
    event: 'incident:opened',
    incidentId: incident._id,
    tenantId,
    checkId,
  });

  logger.info({ incidentId: incident._id, checkId, tenantId }, '[Incident] Opened');
}

/**
 * Resolves the open/monitoring incident for the given check.
 * No-op if no matching incident exists (check recovered before one was opened).
 *
 * @param tenantId  Tenant ObjectId string.
 * @param checkId   Check ObjectId string whose probe just recovered.
 */
export async function resolveIncident(tenantId: string, checkId: string): Promise<void> {
  const incident = await incidentRepo.findOpenByCheckId(tenantId, checkId);
  if (!incident) {
    logger.debug({ checkId, tenantId }, '[Incident] No open incident to resolve — skipping');
    return;
  }

  const now = new Date();
  await incidentRepo.updateById(tenantId, incident._id, {
    status: 'resolved',
    resolvedAt: now,
    lastChangeAt: now,
  });

  void auditService.log({
    tenantId,
    actorId: null,
    action: 'incident.resolve',
    targetCollection: 'incidents',
    targetId: incident._id,
    meta: { checkId },
  });

  publish(`incidents:${tenantId}`, {
    event: 'incident:resolved',
    incidentId: incident._id,
    tenantId,
    checkId,
  });

  logger.info({ incidentId: incident._id, checkId, tenantId }, '[Incident] Resolved');
}

// ── Manual lifecycle ──────────────────────────────────────────────────────────

/**
 * Returns the list of incidents for a tenant (paginated + filtered).
 */
export async function listIncidents(
  tenantId: string,
  query: Record<string, unknown>,
): Promise<{ items: IncidentPublic[]; total: number }> {
  return incidentRepo.findAll(tenantId, query);
}

/**
 * Returns a single incident by id, scoped to the tenant.
 * Throws NotFoundError if it doesn't exist or belongs to another tenant.
 */
export async function getIncidentById(tenantId: string, id: string): Promise<IncidentPublic> {
  const incident = await incidentRepo.findById(tenantId, id);
  if (!incident) throw new NotFoundError(`Incident ${id} not found`);
  return incident;
}

/**
 * Applies a manual update (status change and/or note) to an incident.
 *
 * Status transitions are validated against the state machine:
 *   open → monitoring | resolved
 *   monitoring → resolved
 *   resolved → (terminal — ValidationError thrown)
 *
 * @param tenantId  Tenant ObjectId string.
 * @param id        Incident ObjectId string.
 * @param dto       Validated UpdateIncidentDto from the request body.
 * @param actorId   ObjectId string of the authenticated user making the change.
 */
export async function updateIncident(
  tenantId: string,
  id: string,
  dto: UpdateIncidentDto,
  actorId: string,
): Promise<IncidentPublic> {
  // Require at least one field (cannot be enforced by Zod .refine() + validate middleware).
  if (dto.status === undefined && dto.note === undefined) {
    throw new ValidationError('Provide at least one of: status, note');
  }

  const incident = await incidentRepo.findById(tenantId, id);
  if (!incident) throw new NotFoundError(`Incident ${id} not found`);

  // Validate the status transition if a new status was requested.
  if (dto.status && dto.status !== incident.status) {
    const allowed = ALLOWED_TRANSITIONS[incident.status];
    if (!allowed.has(dto.status)) {
      throw new ValidationError(`Invalid status transition: ${incident.status} → ${dto.status}`);
    }
  }

  const now = new Date();
  const updated = await incidentRepo.updateById(tenantId, id, {
    status: dto.status,
    resolvedAt: dto.status === 'resolved' ? now : undefined,
    lastChangeAt: now,
    note: dto.note ? { by: actorId, at: now, text: dto.note.text } : undefined,
  });

  if (!updated) throw new NotFoundError(`Incident ${id} not found`);

  void auditService.log({
    tenantId,
    actorId,
    action: 'incident.update',
    targetCollection: 'incidents',
    targetId: id,
    meta: {
      previousStatus: incident.status,
      newStatus: dto.status ?? incident.status,
      hasNote: !!dto.note,
    },
  });

  publish(`incidents:${tenantId}`, {
    event: 'incident:updated',
    incidentId: id,
    tenantId,
  });

  return updated;
}

/**
 * Returns an incident together with its full audit trail.
 * Used to build the incident timeline view.
 *
 * @param tenantId    Tenant ObjectId string.
 * @param incidentId  Incident ObjectId string.
 */
export async function getTimeline(
  tenantId: string,
  incidentId: string,
): Promise<{ incident: IncidentPublic; auditEntries: AuditLogPublic[] }> {
  const incident = await incidentRepo.findById(tenantId, incidentId);
  if (!incident) throw new NotFoundError(`Incident ${incidentId} not found`);

  const auditResult = await auditService.query(tenantId, {
    targetId: incidentId,
    limit: 100,
  });

  return {
    incident,
    auditEntries: auditResult.items,
  };
}

// ── Probe event bridge ────────────────────────────────────────────────────────

/**
 * Subscribes to the global 'probe:events' channel published by the scheduler.
 * Must be called once from server.ts after startScheduler() resolves.
 *
 * @returns A cleanup function that removes the subscription (call on shutdown).
 */
export function initIncidentSubscriptions(): () => void {
  const handler: PubSubHandler = (payload) => {
    const ev = payload as ProbeEvent;

    if (ev.event === 'check:fail') {
      void openIncident(ev.tenantId, ev.checkId).catch((err: unknown) => {
        logger.error({ err, checkId: ev.checkId }, '[Incident] openIncident failed');
      });
    } else if (ev.event === 'check:recover') {
      void resolveIncident(ev.tenantId, ev.checkId).catch((err: unknown) => {
        logger.error({ err, checkId: ev.checkId }, '[Incident] resolveIncident failed');
      });
    }
  };

  subscribe('probe:events', handler);
  logger.info('[Incident] Subscribed to probe:events');

  return () => {
    unsubscribe('probe:events', handler);
    logger.info('[Incident] Unsubscribed from probe:events');
  };
}
