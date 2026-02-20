/**
 * tests/setup.ts — Jest Environment Setup
 *
 * Runs before every test file (via Jest's `setupFiles` option) to set the
 * environment variables that `src/config/env.ts` requires. `env.ts` is
 * evaluated at import-time and calls `process.exit(1)` for any missing required
 * variable, so the values must be present before any app module is imported.
 *
 * Notes:
 *  - MONGO_URI is a placeholder; the actual connection string comes from the
 *    `mongodb-memory-server` instance started in `tests/fixtures/seed.ts`.
 *    The app never auto-connects in tests because `server.ts` is never imported.
 *  - JWT_SECRET must stay in sync with the token-signing helper in each test file.
 *  - BCRYPT_ROUNDS is set to 4 (the minimum) for fast password hashing in tests.
 */

// Required by env.ts schema (min length 1)
process.env.MONGO_URI = 'mongodb://localhost:27017/pulseboard-test-placeholder';

// Must match the secret used in makeToken() helpers across test files
process.env.JWT_SECRET = 'test-jwt-secret-for-pulseboard-tests-only-32chars!';

// Fast bcrypt for tests — never use < 10 in production
process.env.BCRYPT_ROUNDS = '4';

process.env.NODE_ENV = 'test';
process.env.CORS_ORIGIN = 'http://localhost:3000';
