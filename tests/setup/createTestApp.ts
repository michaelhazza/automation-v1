/**
 * Creates a minimal Express app for integration testing.
 *
 * Mounts all route routers in the same order as server/index.ts,
 * but WITHOUT side-effects (no WebSocket, pg-boss, seed calls).
 *
 * Key constraint: ghlWebhookRouter must be mounted BEFORE express.json()
 * to preserve raw body for HMAC verification, matching production behavior.
 */
import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load test env before importing any server modules — override existing env vars
config({ path: resolve(process.cwd(), '.env.test'), override: true });

export async function createTestApp() {
  const app = express();

  // GHL webhook uses raw() parser — must come before express.json()
  const { default: ghlWebhookRouter } = await import('../../server/routes/webhooks/ghlWebhook.js');
  app.use(ghlWebhookRouter);

  // Standard middleware
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Correlation ID middleware (needed for error response format)
  const { correlationMiddleware } = await import('../../server/middleware/correlation.js');
  app.use(correlationMiddleware);

  // Mount routes used in tests
  const { default: orgAgentConfigsRouter } = await import('../../server/routes/orgAgentConfigs.js');
  const { default: agentRunsRouter } = await import('../../server/routes/agentRuns.js');
  const { default: connectorConfigsRouter } = await import('../../server/routes/connectorConfigs.js');
  const { default: subaccountTagsRouter } = await import('../../server/routes/subaccountTags.js');
  const { default: orgMemoryRouter } = await import('../../server/routes/orgMemory.js');
  const { default: reviewItemsRouter } = await import('../../server/routes/reviewItems.js');

  app.use(orgAgentConfigsRouter);
  app.use(agentRunsRouter);
  app.use(connectorConfigsRouter);
  app.use(subaccountTagsRouter);
  app.use(orgMemoryRouter);
  app.use(reviewItemsRouter);

  return app;
}
