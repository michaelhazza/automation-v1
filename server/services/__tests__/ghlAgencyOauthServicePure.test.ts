/**
 * ghlAgencyOauthServicePure.test.ts
 * Run: npx tsx server/services/__tests__/ghlAgencyOauthServicePure.test.ts
 */
import { test, expect } from 'vitest';
import { OAUTH_PROVIDERS } from '../../config/oauthProviders.js';

const REQUIRED_SCOPES = [
  'contacts.readonly', 'contacts.write',
  'opportunities.readonly', 'opportunities.write',
  'locations.readonly', 'users.readonly',
  'calendars.readonly', 'funnels.readonly',
  'conversations.readonly', 'conversations.write',
  'conversations/message.readonly', 'businesses.readonly',
  'saas/subscription.readonly', 'companies.readonly',
  'payments/orders.readonly',
];

test('GHL scope list contains all 15 required scopes', () => {
  const configured = OAUTH_PROVIDERS.ghl.scopes;
  for (const s of REQUIRED_SCOPES) {
    expect(configured, `missing scope: ${s}`).toContain(s);
  }
  expect(configured.length, 'scope count').toBe(15);
});
