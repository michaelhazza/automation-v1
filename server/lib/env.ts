import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string(),
  JWT_SECRET: z.string().min(32),
  EMAIL_FROM: z.string(),
  PORT: z.coerce.number().optional().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
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
  OAUTH_GHL_CLIENT_ID: z.string().optional(),
  OAUTH_GHL_CLIENT_SECRET: z.string().optional(),
  // GitHub App — fine-grained, per-repo access (replaces OAUTH_GITHUB_* OAuth App)
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(), // PEM key, base64-encoded for env vars
  GITHUB_APP_SLUG: z.string().optional(),
  GITHUB_APP_WEBHOOK_SECRET: z.string().optional(),

  // Playbook Studio — PR creation against the platform's own repo
  // (spec tasks/playbooks-spec.md §10.8.6). Optional: when unset, the
  // Save & Open PR endpoint returns a structured error explaining how
  // to configure it. The token must have repo scope on PLAYBOOK_STUDIO_REPO.
  PLAYBOOK_STUDIO_GITHUB_TOKEN: z.string().optional(),
  PLAYBOOK_STUDIO_REPO: z.string().optional().default('michaelhazza/automation-v1'),
  PLAYBOOK_STUDIO_BASE_BRANCH: z.string().optional().default('main'),
});

export const env = envSchema.parse(process.env);
