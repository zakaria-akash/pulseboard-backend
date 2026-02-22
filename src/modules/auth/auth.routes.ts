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
 * @swagger
 * /auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Create a new user account
 *     description: >
 *       Registers the user and hashes the password with bcrypt (≥ 12 rounds).
 *       Returns the public user profile without the password hash.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterRequest'
 *     responses:
 *       201:
 *         description: Account created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   $ref: '#/components/schemas/User'
 *       400:
 *         description: Validation error (missing or invalid fields)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: Email address already registered
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/register', validate(RegisterSchema), authController.register);

/**
 * @swagger
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Log in and receive a JWT
 *     description: >
 *       Verifies credentials against bcrypt hash. On success, sets an HttpOnly
 *       `token` cookie **and** returns the token in the response body (use
 *       whichever mechanism your client prefers).
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: Login successful
 *         headers:
 *           Set-Cookie:
 *             description: HttpOnly JWT cookie (`token=<jwt>; HttpOnly; Path=/`)
 *             schema:
 *               type: string
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     token:
 *                       type: string
 *                       description: Raw JWT — use as Bearer token or ignore if using cookie.
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Invalid email or password
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/login', validate(LoginSchema), authController.login);

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Log out and clear the JWT cookie
 *     description: >
 *       Clears the `token` HttpOnly cookie. No auth guard — you must be able
 *       to log out even with an expired token.
 *     security: []
 *     responses:
 *       200:
 *         description: Logged out successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     message:
 *                       type: string
 *                       example: Logged out
 */
router.post('/logout', authController.logout);

/**
 * @swagger
 * /auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Get the current authenticated user
 *     description: Returns the public profile of the user identified by the JWT.
 *     responses:
 *       200:
 *         description: Current user profile
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Missing or invalid JWT
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/me', authGuard(), authController.me);

export default router;
