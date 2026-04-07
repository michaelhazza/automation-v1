// ---------------------------------------------------------------------------
// Worker environment configuration. Spec §4.5.
// All env vars are validated at boot — fail fast on misconfig.
// ---------------------------------------------------------------------------

import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),

  // Storage
  BROWSER_SESSION_DIR: z.string().default('/var/browser-sessions'),
  WORKSPACE_BASE_DIR:  z.string().default('/tmp/workspaces'),

  // Loop limits
  MAX_STEPS_PER_EXECUTION: z.coerce.number().int().positive().default(25),
  MAX_EXECUTION_TIME_MS:   z.coerce.number().int().positive().default(300_000),
  MAX_COMMAND_TIME_MS:     z.coerce.number().int().positive().default(30_000),

  // pg-boss / concurrency
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  IEE_BROWSER_CONCURRENCY: z.coerce.number().int().positive().default(1),
  IEE_DEV_CONCURRENCY:     z.coerce.number().int().positive().default(2),

  // Heartbeat / reconciliation (§13.3)
  IEE_HEARTBEAT_INTERVAL_MS:  z.coerce.number().int().positive().default(10_000),
  IEE_HEARTBEAT_DEAD_AFTER_S: z.coerce.number().int().positive().default(60),

  // Reservation TTL (§13.6.1.a) — must match server-side IEE_RESERVATION_TTL_MINUTES
  IEE_RESERVATION_TTL_MINUTES: z.coerce.number().int().positive().default(15),

  // Runtime cost pricing (§11.3.4) — defaults to 0 in dev so test runs don't pollute reporting
  IEE_COST_CPU_USD_PER_SEC:    z.coerce.number().nonnegative().default(0),
  IEE_COST_MEM_USD_PER_GB_HR:  z.coerce.number().nonnegative().default(0),
  IEE_COST_FLAT_USD_PER_RUN:   z.coerce.number().nonnegative().default(0),

  // Session corruption recovery (§13.6)
  IEE_SESSION_TTL_DAYS:        z.coerce.number().int().positive().default(30),
  IEE_SESSION_AUTO_PRUNE:      z.enum(['true', 'false']).default('false'),

  // Git author for git_commit action
  IEE_GIT_AUTHOR_NAME:  z.string().default('AutomationOS IEE'),
  IEE_GIT_AUTHOR_EMAIL: z.string().email().default('iee@automation-os.local'),

  // System prompt knobs
  IEE_NO_PROGRESS_THRESHOLD: z.coerce.number().int().positive().default(3),

  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type Env = z.infer<typeof EnvSchema>;

export const env: Env = EnvSchema.parse(process.env);
