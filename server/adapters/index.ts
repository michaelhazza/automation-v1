import type { IntegrationAdapter } from './integrationAdapter.js';
import { ghlAdapter } from './ghlAdapter.js';
import { stripeAdapter } from './stripeAdapter.js';

export const adapters: Record<string, IntegrationAdapter> = {
  ghl: ghlAdapter,
  stripe: stripeAdapter,
};

export type { IntegrationAdapter };
