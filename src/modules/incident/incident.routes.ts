/**
 * src/modules/incident/incident.routes.ts — Incident Routes
 *
 * Mounted at /api/v1/incidents in app.ts.
 *
 * Route order matters: Express matches routes top-to-bottom.
 * `/stream` and `/export` must be declared BEFORE `/:id` or Express will
 * interpret the literal strings as :id parameters.
 *
 * Routes:
 *   GET  /stream                   — SSE feed (no auth; tenantId from ?tenantId=)
 *   GET  /export                   — authGuard('viewer') → CSV download
 *   GET  /                         — authGuard() → paginated list
 *   POST is not exposed — incidents are created automatically by the scheduler
 *   GET  /:id                      — authGuard() → single incident
 *   PATCH /:id                     — authGuard('operator') + validate → update
 *   GET  /:id/timeline/stream      — authGuard() → SSE timeline
 */

import { Router } from 'express';
import { authGuard } from '../../common/middleware/authGuard';
import { validate } from '../../common/middleware/validate';
import { UpdateIncidentSchema, ListIncidentsQuerySchema } from './incident.validation';
import * as incidentController from './incident.controller';

const router = Router();

// ── Public SSE feed ───────────────────────────────────────────────────────────
// No auth — designed for a public status page. Tenant is identified by the
// ?tenantId= query param. Must appear before /:id.
router.get('/stream', incidentController.streamFeed);

// ── CSV export ────────────────────────────────────────────────────────────────
// Must appear before /:id so Express doesn't treat "export" as an :id param.
// authGuard('viewer') allows any authenticated user (viewer is the minimum role).
router.get('/export', authGuard('viewer'), incidentController.exportIncidents);

// ── Authenticated REST endpoints ──────────────────────────────────────────────

// List incidents for the authenticated user's tenant.
router.get('/', authGuard(), validate(ListIncidentsQuerySchema), incidentController.list);

// Single incident by id.
router.get('/:id', authGuard(), incidentController.getById);

// Manually change status or append a note; operators and above only.
router.patch(
  '/:id',
  authGuard('operator'),
  validate(UpdateIncidentSchema),
  incidentController.update,
);

// SSE timeline stream for a specific incident.
router.get('/:id/timeline/stream', authGuard(), incidentController.streamTimeline);

export default router;
