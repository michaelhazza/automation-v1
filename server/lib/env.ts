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
});

export const env = envSchema.parse(process.env);
