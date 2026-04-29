/**
 * chatTriageClassifierPure.test.ts
 * Pure-function tests for the chat triage classifier (Phase 3).
 * Run via: npx tsx server/services/__tests__/chatTriageClassifierPure.test.ts
 */

import { expect, test } from 'vitest';
import {
  classifyChatIntentPure,
  DEFAULT_CHAT_TRIAGE_CONFIG,
  type ChatTriageInput,
} from '../chatTriageClassifierPure.js';
import type { BriefUiContext } from '../../../shared/types/briefFastPath.js';

const baseUiContext: BriefUiContext = {
  surface: 'global_ask_bar',
  currentSubaccountId: 'sub-123',
  currentOrgId: 'org-456',
  userPermissions: new Set(['org.briefs.read', 'org.briefs.write']),
};

const baseInput = (text: string, overrides?: Partial<ChatTriageInput>): ChatTriageInput => ({
  text,
  uiContext: baseUiContext,
  config: DEFAULT_CHAT_TRIAGE_CONFIG,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tier 1 heuristics
// ---------------------------------------------------------------------------

test('returns simple_reply for filler "thanks"', () => {
  const r = classifyChatIntentPure(baseInput('thanks'));
  expect(r.route).toBe('simple_reply');
  expect(r.confidence >= 0.9).toBeTruthy();
  expect(r.tier).toBe(1);
});

test('returns simple_reply for "ok"', () => {
  const r = classifyChatIntentPure(baseInput('ok'));
  expect(r.route).toBe('simple_reply');
});

test('returns simple_reply for text shorter than 4 chars', () => {
  const r = classifyChatIntentPure(baseInput('yes'));
  expect(r.route).toBe('simple_reply');
});

test('returns cheap_answer for pipeline velocity query', () => {
  const r = classifyChatIntentPure(baseInput("what's my pipeline velocity this month"));
  expect(r.route).toBe('cheap_answer');
  expect(r.tier).toBe(1);
});

test('returns cheap_answer for churn rate query', () => {
  const r = classifyChatIntentPure(baseInput('show me the churn rate for last quarter'));
  expect(r.route).toBe('cheap_answer');
});

test('returns needs_clarification for short deictic reference', () => {
  const r = classifyChatIntentPure(baseInput('what about this?'));
  expect(r.route).toBe('needs_clarification');
  expect(r.confidence < 0.75).toBeTruthy();
});

test('returns needs_orchestrator with secondLookTriggered for write-intent', () => {
  const r = classifyChatIntentPure(baseInput('send an email to all VIP contacts'));
  expect(r.route).toBe('needs_orchestrator');
  expect(r.secondLookTriggered).toBe(true);
});

test('flags matched keywords in write-intent result', () => {
  const r = classifyChatIntentPure(baseInput('schedule a follow-up for this contact'));
  expect(r.route).toBe('needs_orchestrator');
  expect(r.secondLookTriggered).toBe(true);
  expect((r.keywords ?? []).includes('schedule')).toBeTruthy();
});

test('returns needs_orchestrator without second-look for read queries', () => {
  const r = classifyChatIntentPure(baseInput('show me all contacts added last week'));
  expect(r.route).toBe('needs_orchestrator');
  expect(r.secondLookTriggered).toBe(false);
});

// ---------------------------------------------------------------------------
// Scope detection
// ---------------------------------------------------------------------------

test('inherits subaccount scope when subaccountId is set', () => {
  const r = classifyChatIntentPure(baseInput('show me contacts'));
  expect(r.scope).toBe('subaccount');
});

test('defaults to org scope when no subaccountId in context', () => {
  const r = classifyChatIntentPure(baseInput('show me contacts', {
    uiContext: { ...baseUiContext, currentSubaccountId: undefined },
  }));
  expect(r.scope).toBe('org');
});

test('overrides to org scope on "all clients" keyword', () => {
  const r = classifyChatIntentPure(baseInput('show me all clients activity'));
  expect(r.scope).toBe('org');
});

test('overrides to system scope on "platform-wide" keyword', () => {
  const r = classifyChatIntentPure(baseInput('show me platform-wide usage stats'));
  expect(r.scope).toBe('system');
});

// ---------------------------------------------------------------------------
// Confidence threshold behaviour
// ---------------------------------------------------------------------------

test('deictic confidence is below tier1ConfidenceThreshold', () => {
  const r = classifyChatIntentPure(baseInput('what about them?'));
  expect(r.confidence < DEFAULT_CHAT_TRIAGE_CONFIG.tier1ConfidenceThreshold).toBeTruthy();
});

test('write-intent confidence is at or above tier1ConfidenceThreshold', () => {
  const r = classifyChatIntentPure(baseInput('delete all inactive contacts'));
  expect(r.confidence >= DEFAULT_CHAT_TRIAGE_CONFIG.tier1ConfidenceThreshold).toBeTruthy();
});

// ---------------------------------------------------------------------------
// Config-threshold behaviour
// ---------------------------------------------------------------------------

test('respects custom writeIntentKeywords', () => {
  const config = { ...DEFAULT_CHAT_TRIAGE_CONFIG, writeIntentKeywords: ['deploy'] };
  const r = classifyChatIntentPure(baseInput('deploy the new pipeline', { config }));
  expect(r.secondLookTriggered).toBe(true);
  expect((r.keywords ?? []).includes('deploy')).toBeTruthy();
});

test('does not flag write-intent when writeIntentKeywords is empty', () => {
  const config = { ...DEFAULT_CHAT_TRIAGE_CONFIG, writeIntentKeywords: [] };
  const r = classifyChatIntentPure(baseInput('send email to contacts', { config }));
  expect(r.secondLookTriggered).toBe(false);
});

test('respects riskySecondLookRoutes=[] — no second-look even for write-intent', () => {
  const config = { ...DEFAULT_CHAT_TRIAGE_CONFIG, riskySecondLookRoutes: [] as import('../../../shared/types/briefFastPath.js').FastPathRoute[] };
  const r = classifyChatIntentPure(baseInput('send email to contacts', { config }));
  expect(r.secondLookTriggered).toBe(false);
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test('handles empty string (short → simple_reply)', () => {
  const r = classifyChatIntentPure(baseInput(''));
  expect(r.route).toBe('simple_reply');
});

test('handles all-whitespace input', () => {
  const r = classifyChatIntentPure(baseInput('   '));
  expect(r.route).toBe('simple_reply');
});

test('does not treat "creation" as write-intent (word boundary)', () => {
  // "create" keyword uses \bcreate\b so "creation" does NOT match
  const r = classifyChatIntentPure(baseInput('show contact creation history'));
  expect(r.secondLookTriggered).toBe(false);
});
