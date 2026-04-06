import { pgTable, uuid, text, integer, boolean, timestamp } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { agents } from './agents';

// ---------------------------------------------------------------------------
// Webhook Adapter Configs — HTTP/webhook agent adapter configuration
// ---------------------------------------------------------------------------

export const webhookAdapterConfigs = pgTable(
  'webhook_adapter_configs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id)
      .unique(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    endpointUrl: text('endpoint_url').notNull(),
    authType: text('auth_type').notNull().default('none').$type<'none' | 'bearer' | 'hmac_sha256' | 'api_key_header'>(),
    authSecret: text('auth_secret'), // encrypted at rest
    authHeaderName: text('auth_header_name'), // custom header name for api_key_header type
    timeoutMs: integer('timeout_ms').notNull().default(300000), // 5 min default
    retryCount: integer('retry_count').notNull().default(2),
    retryBackoffMs: integer('retry_backoff_ms').notNull().default(5000), // base delay, exponential backoff
    expectCallback: boolean('expect_callback').notNull().default(false),
    callbackSecret: text('callback_secret'), // for validating incoming callbacks
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  }
);

export type WebhookAdapterConfig = typeof webhookAdapterConfigs.$inferSelect;
export type NewWebhookAdapterConfig = typeof webhookAdapterConfigs.$inferInsert;
