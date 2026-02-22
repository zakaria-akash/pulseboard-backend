/**
 * src/config/swagger.ts — OpenAPI 3.0 Specification
 *
 * Generates the OpenAPI spec by combining two sources:
 *  1. The base definition below — metadata, servers, security schemes, and all
 *     reusable `components.schemas` defined inline so route files stay clean.
 *  2. `@swagger` JSDoc annotations parsed at startup from every route file
 *     listed in the `apis` array.
 *
 * Served at:
 *  GET /api/v1/docs      — Swagger UI (interactive browser)
 *  GET /api/v1/docs.json — Raw JSON spec (Postman / Insomnia import)
 *
 * ── Why swagger-jsdoc? ────────────────────────────────────────────────────────
 * swagger-jsdoc reads YAML/JSON embedded in JSDoc `@swagger` comments directly
 * from route files. This keeps each route's documentation next to the code that
 * implements it, making it impossible for docs to drift out of sync without the
 * developer noticing.
 */

import swaggerJsdoc from 'swagger-jsdoc';
import { env } from './env';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'PulseBoard API',
      version: '1.0.0',
      description: [
        'REST API for the **PulseBoard** Uptime & Incident Control Room.',
        '',
        '### Authentication',
        'All protected routes accept a JWT via **one** of:',
        '- `Authorization: Bearer <token>` header',
        '- `token` HttpOnly cookie (set automatically by `POST /auth/login`)',
        '',
        '### Tenant Isolation',
        "Every resource is scoped to the authenticated user's `tenantId`.",
        'Cross-tenant reads always return `404` — not `403` — to avoid information leakage.',
        '',
        '### Response Envelope',
        'Success responses: `{ "data": ... }` or `{ "data": { "items": [], "total": 0, ... } }`',
        'Error responses: `{ "error": { "code": "...", "message": "...", "details": [] } }`',
        '',
        '### Rate Limits',
        '| Scope | Limit |',
        '|---|---|',
        '| Global | 200 req/min per IP |',
        '| `/auth/*` | 10 req/min per IP |',
        '| `/usage/*` | 60 req/min per IP |',
      ].join('\n'),
    },
    servers: [
      {
        url: `http://localhost:${env.PORT}/api/v1`,
        description: 'Local development server',
      },
    ],

    // ── Security ─────────────────────────────────────────────────────────────
    // Applied globally; individual routes may override with `security: []`
    // to mark public endpoints (login, logout, SSE feed, health probes).
    security: [{ cookieAuth: [] }, { bearerAuth: [] }],

    // ── Tags (display order in Swagger UI) ───────────────────────────────────
    tags: [
      { name: 'Health', description: 'Liveness and readiness probes' },
      { name: 'Auth', description: 'Registration, login, logout, and session' },
      { name: 'Tenants', description: 'Workspace / brand management (admin only to create)' },
      { name: 'Checks', description: 'HTTP health check CRUD and last probe result' },
      { name: 'Incidents', description: 'Incident lifecycle, notes, SSE feed, CSV export' },
      { name: 'Audit', description: 'Append-only mutation log (admin/owner only)' },
      { name: 'Usage', description: 'Idempotent usage event ingestion' },
    ],

    components: {
      // ── Security schemes ───────────────────────────────────────────────────
      securitySchemes: {
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'token',
          description: 'HttpOnly JWT cookie. Set automatically by `POST /auth/login`.',
        },
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT from the `data.token` field in `POST /auth/login` response.',
        },
      },

      // ── Reusable schemas ───────────────────────────────────────────────────
      schemas: {
        // ── Shared response wrappers ─────────────────────────────────────────
        ErrorResponse: {
          type: 'object',
          description: 'Standard error envelope returned by all error responses.',
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: {
                  type: 'string',
                  example: 'VALIDATION_ERROR',
                  description: 'Machine-readable error code.',
                },
                message: {
                  type: 'string',
                  example: 'Validation failed',
                  description: 'Human-readable error message.',
                },
                details: {
                  type: 'array',
                  items: { type: 'object' },
                  description: 'Zod validation issues. Present on 400 errors only.',
                },
              },
            },
          },
        },

        // ── Auth ─────────────────────────────────────────────────────────────
        LoginRequest: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email', example: 'alice@example.com' },
            password: { type: 'string', minLength: 8, example: 'super-secret-pw' },
          },
        },

        RegisterRequest: {
          type: 'object',
          required: ['email', 'password', 'name', 'tenantId'],
          properties: {
            email: { type: 'string', format: 'email', example: 'alice@example.com' },
            password: { type: 'string', minLength: 8, example: 'super-secret-pw' },
            name: { type: 'string', example: 'Alice Smith' },
            tenantId: {
              type: 'string',
              example: '64f1a2b3c4d5e6f7a8b9c0d1',
              description: 'MongoDB ObjectId of the tenant this user belongs to.',
            },
          },
        },

        User: {
          type: 'object',
          properties: {
            id: { type: 'string', example: '64f1a2b3c4d5e6f7a8b9c0d1' },
            email: { type: 'string', format: 'email', example: 'alice@example.com' },
            name: { type: 'string', example: 'Alice Smith' },
            role: {
              type: 'string',
              enum: ['owner', 'admin', 'operator', 'viewer'],
              example: 'operator',
            },
            tenantId: { type: 'string', example: '64f1a2b3c4d5e6f7a8b9c0d1' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },

        // ── Tenants ──────────────────────────────────────────────────────────
        Tenant: {
          type: 'object',
          properties: {
            id: { type: 'string', example: '64f1a2b3c4d5e6f7a8b9c0d1' },
            name: { type: 'string', example: 'Acme Corp' },
            slug: { type: 'string', example: 'acme-corp' },
            ownerId: { type: 'string', example: '64f1a2b3c4d5e6f7a8b9c0d2' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },

        CreateTenantRequest: {
          type: 'object',
          required: ['name', 'slug'],
          properties: {
            name: { type: 'string', example: 'Acme Corp' },
            slug: {
              type: 'string',
              example: 'acme-corp',
              pattern: '^[a-z0-9-]+$',
              description: 'Lowercase alphanumeric + hyphens. Must be globally unique.',
            },
          },
        },

        // ── Checks ───────────────────────────────────────────────────────────
        LastResult: {
          type: 'object',
          nullable: true,
          description: 'Most recent probe result. `null` before the first probe runs.',
          properties: {
            ok: { type: 'boolean', description: 'true if status + latency both met targets.' },
            statusCode: { type: 'integer', example: 200 },
            latencyMs: { type: 'integer', example: 143 },
            checkedAt: { type: 'string', format: 'date-time' },
            error: {
              type: 'string',
              nullable: true,
              example: 'connect ECONNREFUSED',
              description: 'Network error message if the request failed entirely.',
            },
          },
        },

        Check: {
          type: 'object',
          properties: {
            id: { type: 'string', example: '64f1a2b3c4d5e6f7a8b9c0d3' },
            tenantId: { type: 'string', example: '64f1a2b3c4d5e6f7a8b9c0d1' },
            name: { type: 'string', example: 'Homepage health' },
            url: { type: 'string', format: 'uri', example: 'https://example.com' },
            expectedStatus: { type: 'integer', example: 200 },
            maxLatencyMs: { type: 'integer', example: 2000 },
            enabled: { type: 'boolean', example: true },
            lastResult: { $ref: '#/components/schemas/LastResult' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },

        CreateCheckRequest: {
          type: 'object',
          required: ['name', 'url'],
          properties: {
            name: { type: 'string', example: 'Homepage health' },
            url: { type: 'string', format: 'uri', example: 'https://example.com' },
            expectedStatus: { type: 'integer', default: 200, example: 200 },
            maxLatencyMs: {
              type: 'integer',
              example: 2000,
              description: 'Maximum acceptable response time in milliseconds.',
            },
            enabled: { type: 'boolean', default: true },
          },
        },

        UpdateCheckRequest: {
          type: 'object',
          description: 'All fields optional — only supplied fields are updated.',
          properties: {
            name: { type: 'string', example: 'Homepage health' },
            url: { type: 'string', format: 'uri', example: 'https://example.com' },
            expectedStatus: { type: 'integer', example: 200 },
            maxLatencyMs: { type: 'integer', example: 2000 },
            enabled: { type: 'boolean' },
          },
        },

        // ── Incidents ─────────────────────────────────────────────────────────
        IncidentNote: {
          type: 'object',
          properties: {
            by: {
              type: 'string',
              example: '64f1a2b3c4d5e6f7a8b9c0d2',
              description: 'User ID of the note author.',
            },
            at: { type: 'string', format: 'date-time' },
            text: { type: 'string', example: 'Escalated to on-call engineer.' },
          },
        },

        Incident: {
          type: 'object',
          properties: {
            id: { type: 'string', example: '64f1a2b3c4d5e6f7a8b9c0d4' },
            tenantId: { type: 'string', example: '64f1a2b3c4d5e6f7a8b9c0d1' },
            checkId: { type: 'string', example: '64f1a2b3c4d5e6f7a8b9c0d3' },
            status: {
              type: 'string',
              enum: ['open', 'monitoring', 'resolved'],
              example: 'open',
              description: 'Allowed transitions: open → monitoring → resolved. No backward steps.',
            },
            openedAt: { type: 'string', format: 'date-time' },
            resolvedAt: { type: 'string', format: 'date-time', nullable: true },
            lastChangeAt: { type: 'string', format: 'date-time' },
            notes: {
              type: 'array',
              items: { $ref: '#/components/schemas/IncidentNote' },
            },
          },
        },

        UpdateIncidentRequest: {
          type: 'object',
          description: 'Update status and/or append an operator note. Both fields are optional.',
          properties: {
            status: {
              type: 'string',
              enum: ['open', 'monitoring', 'resolved'],
              example: 'monitoring',
            },
            note: {
              type: 'object',
              required: ['text'],
              properties: {
                text: {
                  type: 'string',
                  minLength: 1,
                  example: 'Investigating — rolled back the last deploy.',
                },
              },
            },
          },
        },

        // ── Audit ─────────────────────────────────────────────────────────────
        AuditEntry: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            tenantId: { type: 'string' },
            actorId: {
              type: 'string',
              nullable: true,
              description: 'User ObjectId. null for system-generated events (e.g. auto-open).',
            },
            action: { type: 'string', example: 'check.created' },
            targetCollection: { type: 'string', example: 'checks' },
            targetId: { type: 'string' },
            meta: { type: 'object', description: 'Arbitrary context (diff, old value, etc.).' },
            ts: { type: 'string', format: 'date-time' },
          },
        },

        // ── Usage ─────────────────────────────────────────────────────────────
        CreateUsageEventRequest: {
          type: 'object',
          required: ['kind'],
          properties: {
            kind: {
              type: 'string',
              example: 'page.view',
              description: 'Event type identifier. Dot-separated convention recommended.',
            },
            payload: {
              type: 'object',
              additionalProperties: true,
              example: { page: '/dashboard', durationMs: 1234 },
              description: 'Arbitrary event context. Stored as-is.',
            },
          },
        },

        UsageEvent: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            idempotencyKey: { type: 'string', example: 'evt_01HXYZ...' },
            tenantId: { type: 'string' },
            kind: { type: 'string', example: 'page.view' },
            payload: { type: 'object' },
            ts: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  },

  // ── Source files to scan for @swagger JSDoc annotations ───────────────────
  // swagger-jsdoc parses YAML embedded in /** @swagger */ comments from these
  // files at process startup. The glob is resolved relative to CWD (project root).
  apis: [
    './src/app.ts',
    './src/modules/auth/auth.routes.ts',
    './src/modules/tenant/tenant.routes.ts',
    './src/modules/check/check.routes.ts',
    './src/modules/incident/incident.routes.ts',
    './src/modules/audit/audit.routes.ts',
    './src/modules/usage/usage.routes.ts',
  ],
};

export const swaggerSpec = swaggerJsdoc(options);
