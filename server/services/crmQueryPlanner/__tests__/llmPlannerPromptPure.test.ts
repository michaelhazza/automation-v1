/**
 * llmPlannerPromptPure.test.ts — spec §10.5
 *
 * Runnable via:
 *   npx tsx server/services/crmQueryPlanner/__tests__/llmPlannerPromptPure.test.ts
 */
import { expect, test } from 'vitest';
import { buildPrompt, extractSystemAndUser } from '../llmPlannerPromptPure.js';
import { normaliseIntent } from '../normaliseIntentPure.js';
import type { CanonicalQueryRegistry } from '../../../../shared/types/crmQueryPlanner.js';
import type { CanonicalQueryHandlerArgs, ExecutorResult } from '../../../../shared/types/crmQueryPlanner.js';

const STUB_HANDLER = async (_args: CanonicalQueryHandlerArgs): Promise<ExecutorResult> =>
  ({ rows: [], rowCount: 0, truncated: false, actualCostCents: 0, source: 'canonical' as const });

const stubRegistry: CanonicalQueryRegistry = Object.freeze({
  'contacts.inactive_over_days': {
    key: 'contacts.inactive_over_days',
    primaryEntity: 'contacts',
    aliases: ['stale contacts'],
    requiredCapabilities: [],
    description: 'Contacts with no activity since N days ago',
    allowedFields: { lastActivityAt: { operators: ['lt'], projectable: true, sortable: true } },
    handler: STUB_HANDLER,
  },
  'opportunities.stale_over_days': {
    key: 'opportunities.stale_over_days',
    primaryEntity: 'opportunities',
    aliases: ['stale deals'],
    requiredCapabilities: [],
    description: 'Opportunities in a stage beyond N days',
    allowedFields: { updatedAt: { operators: ['lt'], projectable: true, sortable: true } },
    handler: STUB_HANDLER,
  },
});

const schemaText = 'contacts: id, firstName, lastName, email, lastActivityAt\nopportunities: id, name, stage, amount, updatedAt';

// ── Test 1: Prompt includes all registry keys ─────────────────────────────────

test('prompt includes all registry keys', () => {
  const intent = normaliseIntent('show me stale contacts');
  const msgs = buildPrompt({ intent, registry: stubRegistry, schemaContextText: schemaText });
  const { system } = extractSystemAndUser(msgs);
  expect(system.includes('contacts.inactive_over_days'), 'missing contacts.inactive_over_days key').toBeTruthy();
  expect(system.includes('opportunities.stale_over_days'), 'missing opportunities.stale_over_days key').toBeTruthy();
});

// ── Test 2: Prompt includes registry descriptions ─────────────────────────────

test('prompt includes registry descriptions', () => {
  const intent = normaliseIntent('stale contacts');
  const msgs = buildPrompt({ intent, registry: stubRegistry, schemaContextText: schemaText });
  const { system } = extractSystemAndUser(msgs);
  expect(system.includes('Contacts with no activity since N days ago'), 'missing description 1').toBeTruthy();
  expect(system.includes('Opportunities in a stage beyond N days'), 'missing description 2').toBeTruthy();
});

// ── Test 3: Prompt includes schema context ────────────────────────────────────

test('prompt includes schema context verbatim', () => {
  const intent = normaliseIntent('stale contacts');
  const msgs = buildPrompt({ intent, registry: stubRegistry, schemaContextText: schemaText });
  const { system } = extractSystemAndUser(msgs);
  expect(system.includes('lastActivityAt'), 'schema context missing lastActivityAt').toBeTruthy();
  expect(system.includes('opportunities: id, name, stage'), 'schema context missing opportunities fields').toBeTruthy();
});

// ── Test 4: Prompt truncates rawIntent at 2k chars ────────────────────────────

test('rawIntent truncated at 2000 chars', () => {
  const longIntent = 'show me all '.repeat(300); // >3600 chars
  const intent = normaliseIntent(longIntent);
  // Override rawIntent to be long (normaliseIntent shortens tokens, but rawIntent preserved)
  const longRaw: typeof intent = { ...intent, rawIntent: 'x'.repeat(3000) };
  const msgs = buildPrompt({ intent: longRaw, registry: stubRegistry, schemaContextText: '' });
  const { user } = extractSystemAndUser(msgs);
  expect(user.length <= 2000, `rawIntent not truncated: got ${user.length} chars`).toBeTruthy();
});

// ── Test 5: No placeholder injection risk ─────────────────────────────────────

test('registry descriptions with braces do not break prompt structure', () => {
  const injectedRegistry: CanonicalQueryRegistry = Object.freeze({
    'test.entry': {
      key: 'test.entry',
      primaryEntity: 'contacts',
      aliases: [],
      requiredCapabilities: [],
      description: 'Entry with {{ injection }} attempt',
      allowedFields: {},
      handler: STUB_HANDLER,
    },
  });
  // Should not throw
  const intent = normaliseIntent('test');
  const msgs = buildPrompt({ intent, registry: injectedRegistry, schemaContextText: '' });
  const { system } = extractSystemAndUser(msgs);
  expect(system.includes('{{ injection }}'), 'braces should be preserved verbatim').toBeTruthy();
});

// ── Test 6: Produces exactly one user message ─────────────────────────────────

test('buildPrompt returns exactly one message', () => {
  const intent = normaliseIntent('stale contacts');
  const msgs = buildPrompt({ intent, registry: stubRegistry, schemaContextText: '' });
  expect(msgs.length === 1, `expected 1 message, got ${msgs.length}`).toBeTruthy();
  expect(msgs[0]!.role === 'user', `expected role=user, got ${msgs[0]!.role}`).toBeTruthy();
});

// ── Test 7: Empty schema context handled gracefully ───────────────────────────

test('empty schema context produces fallback text', () => {
  const intent = normaliseIntent('contacts');
  const msgs = buildPrompt({ intent, registry: stubRegistry, schemaContextText: '' });
  const { system } = extractSystemAndUser(msgs);
  expect(system.includes('no schema available'), 'fallback text missing for empty schema').toBeTruthy();
});

// ── Summary ───────────────────────────────────────────────────────────────────
