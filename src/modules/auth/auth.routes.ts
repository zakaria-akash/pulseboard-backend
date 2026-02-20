/**
 * src/modules/auth/auth.routes.ts — Auth Route Definitions
 *
 * Wires HTTP routes to the middleware chain and controller handlers.
 * Mounted in app.ts at `/api/v1/auth` with `authLimiter` applied to
 * the entire prefix (10 req/min per IP) to mitigate brute-force attacks.
 *
 * ── Routes ────────────────────────────────────────────────────────────────────
 *
 *   POST /register  validate(RegisterSchema) → register
 *     Creates a new user account. Returns 201 + public user profile.
 *     No authentication required — this is the account-creation endpoint.
 *
 *   POST /login     validate(LoginSchema) → login
 *     Verifies credentials, sets HttpOnly cookie, returns token + user.
 *     No authentication required.
 *
 *   POST /logout    → logout
 *     Clears the JWT cookie. No body, no auth guard (you should be able
 *     to log out even with an expired token).
 *
 *   GET  /me        authGuard() → me
 *     Returns the currently authenticated user's public profile.
 *     Requires a valid JWT (cookie or Bearer header).
 *
 * ── Middleware pipeline per route ─────────────────────────────────────────────
 *   authLimiter (applied at app.ts prefix level)
 *     → validate / authGuard (per-route)
 *     → controller handler
 *     → errorHandler (global, in app.ts)
 */

import { Router } from 'express';
import { validate } from '../../common/middleware/validate';
import { authGuard } from '../../common/middleware/authGuard';
import { LoginSchema, RegisterSchema } from './auth.validation';
import * as authController from './auth.controller';

const router = Router();

/**
 * POST /api/v1/auth/register
 * Create a new user account. Validates body against RegisterSchema.
 */
router.post('/register', validate(RegisterSchema), authController.register);

/**
 * POST /api/v1/auth/login
 * Verify credentials and issue a JWT. Validates body against LoginSchema.
 */
router.post('/login', validate(LoginSchema), authController.login);

/**
 * POST /api/v1/auth/logout
 * Clear the JWT cookie. No validation or auth guard — always allowed.
 */
router.post('/logout', authController.logout);

/**
 * GET /api/v1/auth/me
 * Return the authenticated user's public profile.
 * Requires a valid JWT (HttpOnly cookie or Authorization: Bearer header).
 */
router.get('/me', authGuard(), authController.me);

export default router;
