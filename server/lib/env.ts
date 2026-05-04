import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string(),
  JWT_SECRET: z.string().min(32),
  EMAIL_FROM: z.string(),
  PORT: z.coerce.number().optional().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test', 'integration']).default('development'),
  FILE_STORAGE_BACKEND: z.enum(['r2', 's3']).default('r2'),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_BUCKET_NAME: z.string().optional(),
  EMAIL_PROVIDER: z.enum(['sendgrid', 'smtp', 'resend']).default('sendgrid'),
  SENDGRID_API_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  JOB_QUEUE_BACKEND: z.enum(['pg-boss', 'bullmq']).default('pg-boss'),
  REDIS_URL: z.string().optional(),
  QUEUE_CONCURRENCY: z.coerce.number().optional().default(5),
  // Webhook return URL base — the publicly reachable root URL of this server.
  // The callback path is appended automatically; users never configure per-task URLs.
  // Example: https://myapp.example.com
  WEBHOOK_BASE_URL: z.string().optional().default(''),
  // Optional HMAC secret to sign/verify callback tokens. Set this to a long
  // random string in production so spoofed callbacks are rejected.
  WEBHOOK_SECRET: z.string().optional(),
  FILE_RETENTION_DAYS: z.coerce.number().optional().default(30),
  EXECUTION_TIMEOUT_DEFAULT_SECONDS: z.coerce.number().optional().default(300),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  CORS_ORIGINS: z.string().optional().default('*'),
  INVITE_TOKEN_EXPIRY_HOURS: z.coerce.number().optional().default(72),
  PASSWORD_RESET_TOKEN_EXPIRY_HOURS: z.coerce.number().optional().default(1),
  // Publicly reachable frontend URL — used to build invite and password reset links in emails.
  // Example: https://app.youragency.com
  APP_BASE_URL: z.string().optional().default('http://localhost:5000'),
  // Base URL used exclusively for OAuth callback redirect_uri sent to providers.
  // Set this to a publicly reachable URL (e.g. ngrok tunnel) when developing locally,
  // while APP_BASE_URL stays as localhost so the post-auth redirect lands on the local UI.
  // Falls back to APP_BASE_URL if not set (correct behaviour in production).
  OAUTH_CALLBACK_BASE_URL: z.string().optional(),
  // Webhook adapter
  WEBHOOK_CALLBACK_SECRET: z.string().optional(),
  // AI Agent / LLM configuration
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  // LLM Router — routing control flags
  ROUTER_SHADOW_MODE: z.coerce.boolean().default(false),
  ROUTER_ENABLE_ECONOMY: z.coerce.boolean().default(false),
  ROUTER_FORCE_FRONTIER: z.coerce.boolean().default(false),
  // LLM Router — platform-level safety caps
  PLATFORM_MONTHLY_COST_LIMIT_CENTS: z.coerce.number().optional(),
  PLATFORM_MAX_REQUESTS_PER_MINUTE: z.coerce.number().optional().default(60),
  // Platform default margin multiplier (e.g. 1.30 = 30% markup)
  PLATFORM_MARGIN_MULTIPLIER: z.coerce.number().optional().default(1.30),
  // llm_requests retention (months). Rows older than this cutoff are moved
  // to llm_requests_archive by the nightly llm-ledger-archive pg-boss job
  // (see server/jobs/llmLedgerArchiveJob.ts). Infrastructure tunable, not
  // a per-org business decision.
  LLM_LEDGER_RETENTION_MONTHS: z.coerce.number().int().positive().optional().default(12),
  // llm_inflight_history fire-and-forget persistence (deferred-items brief §6).
  // Defaults to true; set to 'false' to disable writes without a deploy if the
  // history table becomes temporarily unhealthy.
  LLM_INFLIGHT_HISTORY_ENABLED: z
    .union([z.boolean(), z.string()])
    .optional()
    .default(true)
    .transform((v) => v === true || v === 'true' || v === '1'),
  // Retention window (days) for llm_inflight_history rows. Short by design —
  // the archive is for recent-incident forensics, not long-term storage.
  LLM_INFLIGHT_HISTORY_RETENTION_DAYS: z.coerce.number().int().positive().optional().default(7),
  // Maximum messages to include in chat context (recent N messages)
  AGENT_CONTEXT_MESSAGES: z.coerce.number().optional().default(20),
  // Tavily AI search API key for agent web search skill
  TAVILY_API_KEY: z.string().optional(),
  // AES-256-GCM key for encrypting OAuth tokens in integration_connections.
  // Must be 64 hex chars (32 bytes). Generate via: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  TOKEN_ENCRYPTION_KEY: z.string().length(64).optional(),
  // Previous encryption key — set this when rotating to a new TOKEN_ENCRYPTION_KEY
  // so that values encrypted under the old key can still be decrypted. Remove once
  // all legacy-format values have been re-encrypted.
  TOKEN_ENCRYPTION_KEY_V0: z.string().length(64).optional(),
  // Langfuse observability — optional, no-ops if not set
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_BASE_URL: z.string().url().optional().default('https://cloud.langfuse.com'),
  // OAuth provider credentials — OAUTH_{PROVIDER}_CLIENT_ID / _CLIENT_SECRET
  OAUTH_GMAIL_CLIENT_ID: z.string().optional(),
  OAUTH_GMAIL_CLIENT_SECRET: z.string().optional(),
  // GitHub uses GitHub App model (not OAuth Apps) — see GITHUB_APP_* below
  OAUTH_HUBSPOT_CLIENT_ID: z.string().optional(),
  OAUTH_HUBSPOT_CLIENT_SECRET: z.string().optional(),
  OAUTH_SLACK_CLIENT_ID: z.string().optional(),
  OAUTH_SLACK_CLIENT_SECRET: z.string().optional(),

  // Synthetos internal ops — Slack incoming webhook for feature request
  // notifications (docs/orchestrator-capability-routing-spec.md §5.3.1, §5.6).
  // When unset, the Slack channel is skipped silently and the feature request
  // still lands in the feature_requests table and the Synthetos-internal task.
  SYNTHETOS_INTERNAL_SLACK_WEBHOOK: z.string().optional(),
  OAUTH_GHL_CLIENT_ID: z.string().optional(),
  OAUTH_GHL_CLIENT_SECRET: z.string().optional(),
  // GHL app-level webhook signing secret (set in GHL Marketplace app settings).
  // Used to verify HMAC-SHA256 signatures on agency lifecycle webhooks
  // (INSTALL/UNINSTALL/LocationCreate/LocationUpdate). When unset, lifecycle
  // webhooks are processed without signature verification (development only).
  GHL_WEBHOOK_SIGNING_SECRET: z.string().optional(),
  // GitHub App — fine-grained, per-repo access (replaces OAUTH_GITHUB_* OAuth App)
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(), // PEM key, base64-encoded for env vars
  GITHUB_APP_SLUG: z.string().optional(),
  GITHUB_APP_WEBHOOK_SECRET: z.string().optional(),

  // Workflow Studio — PR creation against the platform's own repo
  // (spec tasks/workflows-spec.md §10.8.6). Optional: when unset, the
  // Save & Open PR endpoint returns a structured error explaining how
  // to configure it. The token must have repo scope on WORKFLOW_STUDIO_REPO.
  WORKFLOW_STUDIO_GITHUB_TOKEN: z.string().optional(),
  WORKFLOW_STUDIO_REPO: z.string().optional().default('michaelhazza/automation-v1'),
  WORKFLOW_STUDIO_BASE_BRANCH: z.string().optional().default('main'),

  // ── Live Agent Execution Log (spec: tasks/live-agent-execution-log-spec.md) ──
  // Retention tiers. P1 ships with rotation disabled; P3 adds the archive job.
  AGENT_EXECUTION_LOG_HOT_MONTHS: z.coerce.number().int().positive().optional().default(6),
  AGENT_EXECUTION_LOG_WARM_MONTHS: z.coerce.number().int().positive().optional().default(12),
  AGENT_EXECUTION_LOG_COLD_YEARS: z.coerce.number().int().positive().optional().default(7),
  AGENT_EXECUTION_LOG_ARCHIVE_BATCH_SIZE: z.coerce.number().int().positive().optional().default(500),
  // Per-row hard cap on agent_run_llm_payloads (bytes). Fields truncated
  // greatest-first; every truncation is recorded in the modifications column.
  AGENT_EXECUTION_LOG_MAX_PAYLOAD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .default(1_048_576),
  // Per-run hard cap on agent_execution_events. Above cap, non-critical events
  // drop + the one-shot run.event_limit_reached signal is emitted. Critical
  // events (run lifecycle, LLM call bookends, handoff) bypass.
  AGENT_EXECUTION_LOG_MAX_EVENTS_PER_RUN: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .default(10_000),
  // Grace window (days) after a run's archive is restored during which the
  // rotation job skips re-rotation. P3.1 wires this in when the restore
  // trigger endpoint lands.
  AGENT_EXECUTION_LOG_RESTORE_GRACE_DAYS: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .default(30),
  // Workspace — Native backend
  // Domain used for agent email addresses provisioned by the native backend.
  // Example: workspace.acme.com  Falls back to 'workspace.local' when unset.
  NATIVE_EMAIL_DOMAIN: z.string().optional().default(''),
  // HMAC-SHA256 shared secret for verifying inbound email webhook payloads from the provider.
  NATIVE_EMAIL_INBOUND_WEBHOOK_SECRET: z.string().optional().default(''),

  // Workspace — Google Workspace backend
  // Service account JSON (path to file or inline JSON string) used for domain-wide delegation.
  GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON: z.string().optional().default(''),
  // Email of the Workspace admin that the service account impersonates for Admin SDK calls.
  GOOGLE_WORKSPACE_ADMIN_DELEGATED_USER: z.string().optional().default(''),
});

export const env = envSchema.parse(process.env);
