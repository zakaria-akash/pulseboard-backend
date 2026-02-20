/**
 * src/types/express.d.ts — Express Request Augmentation
 *
 * Extends the Express `Request` interface to include the custom properties
 * that PulseBoard's middleware attaches to every request object. By declaring
 * them here, TypeScript knows they exist on `req` in every route handler and
 * middleware — no more `(req as any).user` casts.
 *
 * ── How TypeScript module augmentation works ──────────────────────────────────
 *   Express ships with an empty `namespace Express { interface Request {} }` in
 *   `@types/express`. Declaration merging means any `.d.ts` file that re-opens
 *   that same interface adds to it rather than replacing it. Because this file
 *   contains a top-level `import`, TypeScript treats it as a module and requires
 *   `declare global` to reach the global `Express` namespace.
 *
 * ── Properties ────────────────────────────────────────────────────────────────
 *
 *   req.user
 *     Set by `authGuard` middleware after a JWT is verified. Contains the
 *     decoded token claims needed for tenant-scoping and role checks.
 *     Only present on routes that have `authGuard()` in their middleware chain —
 *     accessing it on unguarded routes will be `undefined` at runtime even
 *     though TypeScript types it as required. Guard your routes carefully.
 *
 *   req.requestId
 *     Set by the `requestId` middleware (the very first middleware in the
 *     chain). A UUID v4 string used to correlate all log lines, error responses,
 *     and downstream service calls that belong to the same inbound request.
 *
 * ── Why `user` is not optional (`user?`) ─────────────────────────────────────
 *   Marking it required means route handlers that are supposed to be guarded
 *   can read `req.user.tenantId` without null-checks — TypeScript trusts that
 *   `authGuard()` ran. If you add a route and forget `authGuard()`, the code
 *   still compiles but will throw at runtime. This is an acceptable trade-off:
 *   it keeps handler code clean and the linting / code-review process catches
 *   missing guards.
 */

import type { Role } from '../common/middleware/authGuard';

declare global {
  namespace Express {
    interface Request {
      /**
       * Decoded JWT payload attached by `authGuard` middleware.
       * Available on all routes protected by `authGuard()`.
       *
       * - `sub`      — MongoDB ObjectId of the authenticated user (string).
       * - `email`    — User's email address.
       * - `role`     — The user's role within their tenant.
       * - `tenantId` — MongoDB ObjectId of the user's active tenant (string).
       *                Used to scope every DB query so one tenant can never
       *                read or mutate another tenant's data.
       */
      user: {
        sub: string;
        email: string;
        role: Role;
        tenantId: string;
      };

      /**
       * UUID v4 identifier attached by `requestId` middleware.
       * Included in every log line and error response so a failing request
       * can be traced end-to-end across log aggregators.
       */
      requestId: string;

      /**
       * Idempotency key extracted from the `Idempotency-Key` request header
       * by `requireIdempotencyKey` middleware. Only present on usage ingestion
       * routes — accessing it on other routes will be `undefined` at runtime.
       */
      idempotencyKey: string;
    }
  }
}
