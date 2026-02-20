/**
 * src/modules/auth/auth.service.ts — Authentication Business Logic
 *
 * Contains all auth domain logic. Controllers call these functions and handle
 * only HTTP concerns (cookies, response shape). This layer is database-aware
 * but HTTP-unaware — it throws typed AppErrors, not HTTP responses.
 *
 * ── Functions ─────────────────────────────────────────────────────────────────
 *
 *  register(dto)  — create a new user account
 *  login(dto)     — verify credentials and issue a JWT
 *  getMe(userId)  — fetch the authenticated user's public profile
 *
 * ── Security notes ────────────────────────────────────────────────────────────
 *
 *  Password hashing
 *    bcrypt with `env.BCRYPT_ROUNDS` cost factor (default 10–12). Higher rounds
 *    make offline brute-force attacks proportionally more expensive. Never store
 *    the plaintext password — it is only used for comparison here and discarded.
 *
 *  Timing-safe comparison
 *    `bcrypt.compare()` is timing-safe by design — it takes the same amount of
 *    time whether the hash matches or not, preventing timing oracle attacks.
 *    We also return the same "Invalid email or password" message for both
 *    "user not found" and "wrong password" to prevent user-enumeration.
 *
 *  JWT payload
 *    Contains only the minimum fields needed by downstream middleware:
 *      sub      — user's MongoDB _id (string), used as the user identity
 *      email    — included for convenience in req.user
 *      role     — allows authGuard to enforce role without a DB round-trip
 *      tenantId — allows every repository to scope queries without a DB lookup
 *    The token is signed with `JWT_SECRET` and expires after `JWT_TTL`.
 *
 *  hash field isolation
 *    `select('+hash')` is the only place in the codebase where the password
 *    hash is fetched from the DB. All other queries use `.select('-hash')` or
 *    omit the select entirely (the schema default is `select: false`).
 */

import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { User, type IUser, type UserPublic } from './user.model';
import { env } from '../../config/env';
import { ConflictError, UnauthorizedError, NotFoundError } from '../../common/errors';
import type { LoginDto, RegisterDto } from './auth.validation';

// ── JWT TTL helper ────────────────────────────────────────────────────────────
/**
 * Converts a JWT TTL string (e.g. '15m', '2h', '7d') to a whole number of
 * seconds, which is the numeric form that `jwt.sign({ expiresIn: number })`
 * expects.
 *
 * Why not pass the string directly?
 *   @types/jsonwebtoken v9 narrowed `expiresIn` from `string | number` to
 *   `StringValue | number`, where `StringValue` is a set of template-literal
 *   types from the `ms` library. TypeScript rejects a plain `string` as not
 *   assignable to `StringValue`. Converting to seconds removes the ambiguity
 *   entirely — a plain number always satisfies the type.
 */
function ttlToSeconds(ttl: string): number {
  const n = parseFloat(ttl);
  if (/d$/i.test(ttl)) return Math.floor(n * 86_400);
  if (/h$/i.test(ttl)) return Math.floor(n * 3_600);
  if (/m$/i.test(ttl)) return Math.floor(n * 60);
  if (/s$/i.test(ttl)) return Math.floor(n);
  return Math.floor(n); // plain number → treat as seconds
}

// ── Internal helper ───────────────────────────────────────────────────────────
/**
 * Builds a `UserPublic` object from a raw Mongoose document or lean result.
 * Explicitly maps only the safe fields so there is no risk of accidentally
 * forwarding `hash` or internal Mongoose fields (`__v`) to the caller.
 *
 * @param doc  A Mongoose document or lean object that has the IUser fields
 *             plus the standard `_id`, `createdAt`, and `updatedAt`.
 */
function toPublic(
  doc: IUser & { _id: Types.ObjectId; createdAt?: Date; updatedAt?: Date },
): UserPublic {
  return {
    _id: doc._id,
    tenantId: doc.tenantId,
    email: doc.email,
    role: doc.role,
    // Mongoose always sets these with `timestamps: true`. The fallback to
    // new Date() is a no-op in practice but avoids a non-null assertion warning.
    createdAt: doc.createdAt ?? new Date(),
    updatedAt: doc.updatedAt ?? new Date(),
  };
}

// ── register ──────────────────────────────────────────────────────────────────
/**
 * Creates a new user account.
 *
 * Steps:
 *  1. Check that the email address is not already taken (409 Conflict if so).
 *  2. Hash the plaintext password with bcrypt.
 *  3. Create the User document (role defaults to 'viewer').
 *  4. Return the public profile — no hash, no internal fields.
 *
 * @param dto  Validated RegisterDto (email, password, name, tenantId).
 *             `name` is accepted but not stored in Phase 4 (no name field on
 *             the user model yet). It will be persisted in a future profile phase.
 */
export async function register(dto: RegisterDto): Promise<UserPublic> {
  // 1. Email uniqueness check — gives a clear 409 before attempting an insert
  //    that would fail with a duplicate-key DB error (which is harder to map
  //    to a user-friendly message).
  const existing = await User.findOne({ email: dto.email }).lean().exec();
  if (existing) {
    throw new ConflictError('Email is already registered');
  }

  // 2. Hash the password. BCRYPT_ROUNDS controls the cost factor (default 10).
  const hash = await bcrypt.hash(dto.password, env.BCRYPT_ROUNDS);

  // 3. Persist the new user. tenantId is stored as-is; Mongoose auto-casts a
  //    valid ObjectId string. If the string is not a valid ObjectId, Mongoose
  //    throws a CastError which propagates as a 400 via the error handler.
  const created = await User.create({
    tenantId: new Types.ObjectId(dto.tenantId),
    email: dto.email, // schema applies .toLowerCase().trim() before storage
    hash,
    role: 'viewer', // least privileged default — elevate via tenant/membership
  });

  // 4. Return the safe public shape.
  return toPublic(
    created.toObject() as IUser & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date },
  );
}

// ── login ─────────────────────────────────────────────────────────────────────
/**
 * Validates credentials and issues a signed JWT.
 *
 * Steps:
 *  1. Look up the user by email, explicitly fetching the hash field.
 *  2. Use timing-safe bcrypt.compare() — same message for not-found and
 *     wrong-password to prevent user enumeration.
 *  3. Sign a JWT containing the minimum payload needed by authGuard.
 *  4. Return the token and the safe public user profile.
 *
 * @param dto  Validated LoginDto (email, password).
 */
export async function login(dto: LoginDto): Promise<{ token: string; user: UserPublic }> {
  // 1. Fetch the user and include the hash field (excluded by default via
  //    `select: false` in the schema).
  const userWithHash = (await User.findOne({ email: dto.email }).select('+hash').lean().exec()) as
    | (IUser & { _id: Types.ObjectId; createdAt?: Date; updatedAt?: Date })
    | null;

  // Use the same error message for both "not found" and "wrong password"
  // to prevent user-enumeration attacks.
  if (!userWithHash) {
    throw new UnauthorizedError('Invalid email or password');
  }

  // 2. Timing-safe comparison — bcrypt.compare takes equal time regardless of
  //    whether the hash matches, preventing timing oracle attacks.
  const match = await bcrypt.compare(dto.password, userWithHash.hash);
  if (!match) {
    throw new UnauthorizedError('Invalid email or password');
  }

  // 3. Sign the JWT with the minimum payload that authGuard needs to authenticate
  //    and authorise subsequent requests without a DB round-trip.
  const token = jwt.sign(
    {
      sub: userWithHash._id.toString(),
      email: userWithHash.email,
      role: userWithHash.role,
      tenantId: userWithHash.tenantId.toString(),
    },
    env.JWT_SECRET,
    { expiresIn: ttlToSeconds(env.JWT_TTL) },
  );

  // 4. Return token + safe user (hash was fetched but must not be returned).
  return { token, user: toPublic(userWithHash) };
}

// ── getMe ─────────────────────────────────────────────────────────────────────
/**
 * Returns the authenticated user's public profile.
 *
 * Called by the `GET /me` handler after `authGuard()` has verified the JWT.
 * The `sub` field in the JWT payload is the user's MongoDB ObjectId string.
 *
 * @param userId  The `sub` claim from the JWT — the user's _id as a string.
 */
export async function getMe(userId: string): Promise<UserPublic> {
  // `select` is omitted here; hash is excluded by default via `select: false`
  // in the schema, so no explicit `.select('-hash')` is needed.
  const user = (await User.findById(userId).lean().exec()) as
    | (IUser & { _id: Types.ObjectId; createdAt?: Date; updatedAt?: Date })
    | null;

  if (!user) {
    // Should only happen if the user account was deleted after the JWT was issued.
    throw new NotFoundError('User not found');
  }

  return toPublic(user);
}
