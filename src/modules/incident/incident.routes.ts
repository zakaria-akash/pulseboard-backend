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

/**
 * @swagger
 * /incidents/stream:
 *   get:
 *     tags: [Incidents]
 *     summary: Public SSE feed — live incident events for a tenant
 *     description: >
 *       Server-Sent Events stream. No authentication required — designed for
 *       public status pages. Sends a `:keep-alive` comment every 20 s to
 *       prevent proxy timeouts. Connect with `EventSource` in the browser.
 *
 *       **Event format:**
 *       ```
 *       data: {"type":"incident.opened","tenantId":"...","incident":{...}}
 *       ```
 *     security: []
 *     parameters:
 *       - in: query
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the tenant to subscribe to
 *     responses:
 *       200:
 *         description: SSE stream established
 *         headers:
 *           Content-Type:
 *             schema:
 *               type: string
 *               example: text/event-stream
 *           Cache-Control:
 *             schema:
 *               type: string
 *               example: no-cache
 *           X-Accel-Buffering:
 *             schema:
 *               type: string
 *               example: no
 *         content:
 *           text/event-stream:
 *             schema:
 *               type: string
 *               example: "data: {\"type\":\"incident.opened\"}\n\n"
 *       400:
 *         description: Missing tenantId query parameter
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
// ── Public SSE feed ───────────────────────────────────────────────────────────
// No auth — designed for a public status page. Tenant is identified by the
// ?tenantId= query param. Must appear before /:id.
router.get('/stream', incidentController.streamFeed);

/**
 * @swagger
 * /incidents/export:
 *   get:
 *     tags: [Incidents]
 *     summary: Export incident history as CSV (streamed)
 *     description: >
 *       Streams a CSV file via Mongoose cursor — no full dataset loaded into memory.
 *       Date range max is 90 days. Viewer role or higher required.
 *
 *       **CSV columns:** `id, checkName, status, openedAt, resolvedAt, noteCount`
 *     parameters:
 *       - in: query
 *         name: from
 *         required: true
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Start of date range (ISO 8601)
 *       - in: query
 *         name: to
 *         required: true
 *         schema:
 *           type: string
 *           format: date-time
 *         description: End of date range (ISO 8601) — max 90 days after `from`
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [open, monitoring, resolved]
 *         description: Optional status filter
 *     responses:
 *       200:
 *         description: CSV file stream
 *         headers:
 *           Content-Type:
 *             schema:
 *               type: string
 *               example: text/csv
 *           Content-Disposition:
 *             schema:
 *               type: string
 *               example: attachment; filename="incidents-2026-01-01-2026-01-31.csv"
 *         content:
 *           text/csv:
 *             schema:
 *               type: string
 *       400:
 *         description: Missing or invalid date range
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
// ── CSV export ────────────────────────────────────────────────────────────────
// Must appear before /:id so Express doesn't treat "export" as an :id param.
// authGuard('viewer') allows any authenticated user (viewer is the minimum role).
router.get('/export', authGuard('viewer'), incidentController.exportIncidents);

/**
 * @swagger
 * /incidents:
 *   get:
 *     tags: [Incidents]
 *     summary: List incidents for the current tenant (paginated)
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [open, monitoring, resolved]
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter incidents opened on or after this date
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter incidents opened on or before this date
 *       - in: query
 *         name: checkId
 *         schema:
 *           type: string
 *         description: Filter by check ObjectId
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           default: lastChangeAt_desc
 *     responses:
 *       200:
 *         description: Paginated list of incidents
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     items:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Incident'
 *                     total:
 *                       type: integer
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     pages:
 *                       type: integer
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
// ── Authenticated REST endpoints ──────────────────────────────────────────────

// List incidents for the authenticated user's tenant.
router.get('/', authGuard(), validate(ListIncidentsQuerySchema), incidentController.list);

/**
 * @swagger
 * /incidents/{id}:
 *   get:
 *     tags: [Incidents]
 *     summary: Get a single incident by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Incident found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   $ref: '#/components/schemas/Incident'
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Incident not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
// Single incident by id.
router.get('/:id', authGuard(), incidentController.getById);

/**
 * @swagger
 * /incidents/{id}:
 *   patch:
 *     tags: [Incidents]
 *     summary: Update incident status or append a note (operator or higher)
 *     description: >
 *       Allowed status transitions: `open → monitoring → resolved`.
 *       No backward transitions. Both `status` and `note` are optional but at
 *       least one must be provided.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateIncidentRequest'
 *     responses:
 *       200:
 *         description: Incident updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   $ref: '#/components/schemas/Incident'
 *       400:
 *         description: Invalid status transition or validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Insufficient role — requires operator or higher
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Incident not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
// Manually change status or append a note; operators and above only.
router.patch(
  '/:id',
  authGuard('operator'),
  validate(UpdateIncidentSchema),
  incidentController.update,
);

/**
 * @swagger
 * /incidents/{id}/timeline/stream:
 *   get:
 *     tags: [Incidents]
 *     summary: Stream the full audit timeline for an incident (chunked JSON)
 *     description: >
 *       Streams audit log entries for the incident using `Transfer-Encoding: chunked`
 *       via a Mongoose cursor. No full result set is loaded into memory, making this
 *       safe for incidents with thousands of timeline entries.
 *
 *       **Response format:** `{"items":[...entries streamed incrementally...]}`
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Incident ObjectId
 *     responses:
 *       200:
 *         description: Chunked JSON stream of audit entries
 *         headers:
 *           Transfer-Encoding:
 *             schema:
 *               type: string
 *               example: chunked
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 items:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/AuditEntry'
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Incident not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
// SSE timeline stream for a specific incident.
router.get('/:id/timeline/stream', authGuard(), incidentController.streamTimeline);

export default router;
