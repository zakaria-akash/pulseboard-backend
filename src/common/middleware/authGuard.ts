/**
 * src/common/middleware/authGuard.ts — JWT Authentication & Role Guard
 *
 * Exports `authGuard(minRole?)`, a middleware factory that:
 *   1. Extracts a JWT from either an HttpOnly cookie or a Bearer token header.
 *   2. Verifies the signature and expiry using the app's `JWT_SECRET`.
 *   3. Attaches the decoded user payload to `req.user`.
 *   4. Optionally enforces a minimum role level in the role hierarchy.
 *
 * ── Token extraction order ────────────────────────────────────────────────────
 *   Cookie (`token`) is checked first because HttpOnly cookies are more secure
 *   for browser-based clients — they can't be read by JavaScript, which
 *   prevents XSS-based token theft. The `Authorization: Bearer` header is a
 *   fallback for API clients, CLI tools, and service-to-service calls that
 *   cannot use cookies.
 *
 * ── Role hierarchy ────────────────────────────────────────────────────────────
 *   owner > admin > operator > viewer
 *
 *   Each role is mapped to a numeric weight. `authGuard('operator')` will
 *   pass for operators, admins, and owners, but reject viewers.
 *   Calling `authGuard()` with no argument only enforces authentication —
 *   any valid role is accepted.
 *
 * ── Error responses ───────────────────────────────────────────────────────────
 *   - Missing token        → UnauthorizedError (401)
 *   - Invalid/expired JWT  → UnauthorizedError (401) with generic message
 *     (we never expose the specific JWT error to avoid leaking implementation
 *     details such as key type or algorithm expectations)
 *   - Valid token, wrong role → ForbiddenError (403)
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   // Authentication only (any authenticated user):
 *   router.get('/me', authGuard(), getMe);
 *
 *   // Require at least 'operator' role:
 *   router.delete('/checks/:id', authGuard('operator'), removeCheck);
 *
 *   // Require at least 'admin' role:
 *   router.post('/tenants', authGuard('admin'), createTenant);
 */

import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { UnauthorizedError, ForbiddenError } from '../errors';

/**
 * The four roles in PulseBoard, ordered from most to least privileged.
 * This type is exported so `express.d.ts` can use it to type `req.user.role`.
 */
export type Role = 'owner' | 'admin' | 'operator' | 'viewer';

/**
 * Numeric weight assigned to each role for comparison.
 * Higher number = more privileged. The guard checks:
 *   `ROLE_HIERARCHY[user.role] >= ROLE_HIERARCHY[minRole]`
 */
const ROLE_HIERARCHY: Record<Role, number> = {
  owner: 4,
  admin: 3,
  operator: 2,
  viewer: 1,
};

/**
 * Shape of the JWT payload signed at login.
 * Must stay in sync with `auth.service.ts` where the token is created.
 */
interface JwtPayload {
  /** Subject — the user's MongoDB ObjectId as a string. */
  sub: string;
  email: string;
  role: Role;
  /** The tenant the user belongs to (MongoDB ObjectId string). */
  tenantId: string;
}

/**
 * Creates an Express middleware that authenticates the request and optionally
 * enforces a minimum role.
 *
 * @param minRole  Optional minimum role. If omitted, any authenticated user
 *                 passes. If provided, users with a lower role receive 403.
 */
export function authGuard(minRole?: Role) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      let token: string | undefined;

      // Prefer HttpOnly cookie — more secure for browser clients.
      if (req.cookies?.token) {
        token = req.cookies.token as string;
      } else {
        // Fall back to Authorization: Bearer <token> for API / CLI clients.
        const authHeader = req.headers.authorization;
        if (authHeader?.startsWith('Bearer ')) {
          // Slice off the "Bearer " prefix (7 characters).
          token = authHeader.slice(7);
        }
      }

      if (!token) {
        throw new UnauthorizedError('No authentication token provided');
      }

      // jwt.verify throws on invalid signature, expiry, or malformed token.
      // We cast because we control the signing shape in auth.service.ts.
      const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;

      // Attach the decoded payload to the request so downstream handlers can
      // read req.user.sub, req.user.tenantId, etc. without re-decoding the JWT.
      req.user = {
        sub: payload.sub,
        email: payload.email,
        role: payload.role,
        tenantId: payload.tenantId,
      };

      // Role gate — only checked when a minimum role was requested.
      if (minRole !== undefined && ROLE_HIERARCHY[payload.role] < ROLE_HIERARCHY[minRole]) {
        throw new ForbiddenError(`Requires ${minRole} role or higher`);
      }

      next();
    } catch (err) {
      if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
        // Pass our own typed errors through unchanged.
        next(err);
      } else {
        // jwt.verify throws JsonWebTokenError, TokenExpiredError, etc.
        // Wrap them all in a generic 401 to avoid leaking JWT internals.
        next(new UnauthorizedError('Invalid or expired token'));
      }
    }
  };
}
