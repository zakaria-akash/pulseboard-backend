/**
 * src/config/env.ts — Typed Environment Variable Parser
 *
 * Validates all required environment variables at startup using Zod.
 * If any variable is missing or invalid the process exits immediately with
 * a clear error — this is intentional "fail-fast" behaviour so that a
 * misconfigured container is discovered at boot, not hours later at runtime.
 *
 * ── How to use ────────────────────────────────────────────────────────────
 *   import { env } from './config/env.js';
 *   console.log(env.PORT);          // number
 *   console.log(env.MONGODB_URI);   // string
 *
 * ── Why z.coerce.number() for numeric fields? ────────────────────────────
 *   process.env always returns strings (or undefined). Zod's `z.number()`
 *   rejects strings, so we use `z.coerce.number()` which calls Number()
 *   on the raw value before validating — identical to `parseInt(val, 10)`
 *   but composable inside the schema.
 *
 * ── Why Object.freeze()? ─────────────────────────────────────────────────
 *   Prevents any module from accidentally mutating `env` at runtime
 *   (e.g. `env.PORT = 9999`). Frozen objects are also more JIT-friendly.
 */

import { z } from 'zod';

// ── Schema ─────────────────────────────────────────────────────────────────
const EnvSchema = z.object({
  // ── Runtime ──────────────────────────────────────────────────────────────
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // ── Server ───────────────────────────────────────────────────────────────
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),

  // ── Database ─────────────────────────────────────────────────────────────
  /** Full MongoDB connection string, e.g. mongodb+srv://user:pass@cluster/db */
  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),

  // ── Auth ─────────────────────────────────────────────────────────────────
  /** Secret used to sign JWTs — must be at least 32 characters in production */
  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),

  /** JWT lifetime accepted by the `jsonwebtoken` library, e.g. "15m", "7d" */
  JWT_TTL: z.string().default('15m'),

  /** bcrypt cost factor — guide mandates ≥ 12; allow 4 in CI for fast test hashing */
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(31).default(12),

  // ── CORS ─────────────────────────────────────────────────────────────────
  /** Comma-separated list of allowed origins, e.g. "http://localhost:3000" */
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  // ── Monitoring ───────────────────────────────────────────────────────────
  /** How often (ms) the scheduler fires HTTP checks against monitored targets */
  CHECK_INTERVAL_MS: z.coerce.number().int().min(1000).default(60_000),

  /** Per-request timeout (ms) for outbound HTTP probes */
  PROBE_TIMEOUT_MS: z.coerce.number().int().min(100).default(10_000),
});

// ── Derived TypeScript type ────────────────────────────────────────────────
// Inferred from the schema so the type and validation logic never drift apart.
export type Env = z.infer<typeof EnvSchema>;

// ── Parse & validate ───────────────────────────────────────────────────────
const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // Format Zod errors into a readable list before dying.
  const issues = parsed.error.issues
    .map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');

  console.error('\n[PulseBoard] ❌  Invalid environment variables:\n');
  console.error(issues);
  console.error('\nCheck your .env file against .env.example and fix the above, then restart.\n');

  process.exit(1);
}

// ── Exported singleton ────────────────────────────────────────────────────
// Frozen so no module can mutate it accidentally.
export const env: Env = Object.freeze(parsed.data);
