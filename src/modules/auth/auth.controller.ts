/**
 * src/modules/auth/auth.controller.ts — Auth HTTP Handlers
 *
 * Thin layer that owns HTTP concerns only: reading from req, setting cookies,
 * calling the service, and sending the response. No business logic lives here —
 * every decision is delegated to auth.service.ts.
 *
 * ── JWT cookie strategy ───────────────────────────────────────────────────────
 *   Tokens are sent to the browser as an HttpOnly cookie (`token`). HttpOnly
 *   prevents JavaScript from reading the cookie, which eliminates the most
 *   common XSS-based token theft vector. The `Secure` flag is set only in
 *   production so that local development over HTTP still works.
 *
 *   The token is also returned in the response body (`{ data: { token, user } }`)
 *   so that non-browser clients (CLIs, mobile apps, API integrations) that
 *   cannot use cookies can store and send the token via `Authorization: Bearer`.
 *
 * ── Cookie maxAge ─────────────────────────────────────────────────────────────
 *   Derived from `env.JWT_TTL` (e.g. '15m', '1h', '7d') via a small parser so
 *   the cookie and the JWT always expire at the same time. If the cookie outlived
 *   the JWT, the browser would keep sending an expired token, causing confusing
 *   401 errors.
 *
 * ── Error handling ────────────────────────────────────────────────────────────
 *   Async handlers wrap service calls in try/catch and forward errors via
 *   `next(err)` to the global errorHandler. The `logout` handler is synchronous
 *   and cannot fail, so it does not need a try/catch.
 */

import type { Request, Response, NextFunction } from 'express';
import * as authService from './auth.service';
import { sendSuccess } from '../../common/http';
import { env } from '../../config/env';

// ── Cookie helpers ────────────────────────────────────────────────────────────

/**
 * Converts a JWT TTL string (e.g. '15m', '2h', '7d') to milliseconds for use
 * as a cookie `maxAge`. Supports s (seconds), m (minutes), h (hours), d (days).
 * Falls back to treating the value as a plain number of seconds.
 */
function ttlToMs(ttl: string): number {
  const n = parseFloat(ttl);
  if (/d$/i.test(ttl)) return n * 86_400_000;
  if (/h$/i.test(ttl)) return n * 3_600_000;
  if (/m$/i.test(ttl)) return n * 60_000;
  if (/s$/i.test(ttl)) return n * 1_000;
  return n * 1_000; // plain number → treat as seconds
}

/**
 * Options applied to every `Set-Cookie: token=...` header.
 *
 *  httpOnly  — JS cannot read the cookie; mitigates XSS token theft.
 *  secure    — only sent over HTTPS in production (preserves local dev over HTTP).
 *  sameSite  — 'lax' allows the cookie to be sent on top-level navigations
 *               (e.g. clicking a link) while blocking cross-site POST requests
 *               (CSRF protection).
 *  maxAge    — derived from JWT_TTL so cookie and token expire together.
 */
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: ttlToMs(env.JWT_TTL),
};

// ── Handlers ──────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/auth/register
 *
 * Creates a new user account. Body validated by `validate(RegisterSchema)`
 * before this handler runs, so `req.body` is a safe, typed `RegisterDto`.
 * Returns the new user's public profile (no hash).
 */
export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await authService.register(req.body);
    sendSuccess(res, { user }, 201);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/auth/login
 *
 * Validates credentials, sets the JWT as an HttpOnly cookie, and returns the
 * token + public user profile in the response body.
 *
 * Returning the token in the body (in addition to the cookie) lets non-browser
 * API clients store and replay it via the `Authorization: Bearer` header.
 */
export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { token, user } = await authService.login(req.body);

    // Set the HttpOnly cookie so browser clients authenticate automatically.
    res.cookie('token', token, COOKIE_OPTIONS);

    sendSuccess(res, { token, user });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/auth/logout
 *
 * Clears the JWT cookie by setting it to an empty value with maxAge=0.
 * Stateless — there is no server-side session to invalidate. The JWT itself
 * remains valid until it expires; for high-security use cases a token
 * blacklist (Redis) would be added here.
 */
export function logout(_req: Request, res: Response): void {
  // Passing the same options ensures the browser matches the correct cookie
  // (path, domain, sameSite must match the original Set-Cookie for clearCookie
  // to work reliably).
  res.clearCookie('token', {
    httpOnly: COOKIE_OPTIONS.httpOnly,
    secure: COOKIE_OPTIONS.secure,
    sameSite: COOKIE_OPTIONS.sameSite,
  });
  sendSuccess(res, { message: 'Logged out successfully' });
}

/**
 * GET /api/v1/auth/me
 *
 * Returns the authenticated user's public profile. `authGuard()` on the route
 * has already verified the JWT and attached `req.user` before this runs.
 * The `sub` claim is the user's MongoDB ObjectId string.
 */
export async function me(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await authService.getMe(req.user.sub);
    sendSuccess(res, { user });
  } catch (err) {
    next(err);
  }
}
