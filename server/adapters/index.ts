import type { IntegrationAdapter } from './integrationAdapter.js';
import { ghlAdapter, GHL_METRIC_DEFINITIONS } from './ghlAdapter.js';
import { stripeAdapter } from './stripeAdapter.js';
import { teamworkAdapter } from './teamworkAdapter.js';
import { slackAdapter } from './slackAdapter.js';
import { metricRegistryService } from '../services/metricRegistryService.js';

export const adapters: Record<string, IntegrationAdapter> = {
  ghl: ghlAdapter,
  stripe: stripeAdapter,
  teamwork: teamworkAdapter,
  slack: slackAdapter,
};

/** Register adapter metric definitions on startup */
export async function registerAdapterMetrics(): Promise<void> {
  try {
    await metricRegistryService.registerBatch(
      GHL_METRIC_DEFINITIONS.map(d => ({ ...d }))
    );
    console.log(`[Adapters] Registered ${GHL_METRIC_DEFINITIONS.length} GHL metric definitions`);
  } catch (err) {
    console.error('[Adapters] Failed to register metric definitions:', err instanceof Error ? err.message : err);
  }
}

export type { IntegrationAdapter };
