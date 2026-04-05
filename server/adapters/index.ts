import type { IntegrationAdapter } from './integrationAdapter.js';
import { ghlAdapter } from './ghlAdapter.js';
import { stripeAdapter } from './stripeAdapter.js';
import { teamworkAdapter } from './teamworkAdapter.js';
import { slackAdapter } from './slackAdapter.js';

export const adapters: Record<string, IntegrationAdapter> = {
  ghl: ghlAdapter,
  stripe: stripeAdapter,
  teamwork: teamworkAdapter,
  slack: slackAdapter,
};

export type { IntegrationAdapter };
