/**
 * supportAgentExecutionServicePure.test.ts — Unit tests for pure helpers
 *
 * Chunk 8 (phase-1-showcase-mvps): covers terminal-verdict enum, claim-predicate
 * construction, human-activity check, and master-prompt placeholder substitution.
 *
 * Test posture: targeted Vitest only — do NOT run umbrella suites locally.
 */

import { describe, it, expect } from 'vitest';
import {
  isTerminalVerdict,
  TERMINAL_VERDICTS,
  buildClaimPredicateSql,
  isHumanActivityTooRecent,
  minutesSinceHumanActivity,
  buildTerminalEventPredicateSql,
  substituteMasterPromptPlaceholders,
  buildPromptPlaceholders,
  requiresCustomerHistory,
  ACCOUNT_ISSUE_INTENTS,
  DEFAULT_CLAIM_TTL_MINUTES,
} from '../supportAgentExecutionServicePure.js';
import type { SupportInboxAgentConfig } from '../../../shared/types/supportInboxAgentConfig.js';

// ---------------------------------------------------------------------------
// Terminal-verdict enum
// ---------------------------------------------------------------------------

describe('isTerminalVerdict', () => {
  it('returns true for all known verdicts', () => {
    for (const verdict of TERMINAL_VERDICTS) {
      expect(isTerminalVerdict(verdict)).toBe(true);
    }
  });

  it('returns false for unknown strings', () => {
    expect(isTerminalVerdict('unknown_verdict')).toBe(false);
    expect(isTerminalVerdict('')).toBe(false);
  });

  it('returns false for non-string values', () => {
    expect(isTerminalVerdict(null)).toBe(false);
    expect(isTerminalVerdict(42)).toBe(false);
    expect(isTerminalVerdict(undefined)).toBe(false);
  });

  it('covers all 6 expected verdicts', () => {
    expect(TERMINAL_VERDICTS).toHaveLength(6);
    expect(TERMINAL_VERDICTS).toContain('drafted_for_review');
    expect(TERMINAL_VERDICTS).toContain('drafted_and_dispatched');
    expect(TERMINAL_VERDICTS).toContain('skipped_collision');
    expect(TERMINAL_VERDICTS).toContain('escalated_to_human');
    expect(TERMINAL_VERDICTS).toContain('skipped_low_confidence');
    expect(TERMINAL_VERDICTS).toContain('skipped_no_action_needed');
  });
});

// ---------------------------------------------------------------------------
// buildClaimPredicateSql
// ---------------------------------------------------------------------------

describe('buildClaimPredicateSql', () => {
  it('returns a string containing the TTL interval', () => {
    const sql = buildClaimPredicateSql(15);
    expect(sql).toContain('15 minutes');
    expect(sql).toContain('bot_claimed_at IS NULL');
  });

  it('uses the exact provided TTL value', () => {
    expect(buildClaimPredicateSql(30)).toContain('30 minutes');
    expect(buildClaimPredicateSql(5)).toContain('5 minutes');
  });

  it('throws for non-positive TTL', () => {
    expect(() => buildClaimPredicateSql(0)).toThrow();
    expect(() => buildClaimPredicateSql(-1)).toThrow();
  });

  it('throws for non-integer TTL', () => {
    expect(() => buildClaimPredicateSql(1.5)).toThrow();
  });

  it('DEFAULT_CLAIM_TTL_MINUTES is 15', () => {
    expect(DEFAULT_CLAIM_TTL_MINUTES).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// isHumanActivityTooRecent
// ---------------------------------------------------------------------------

describe('isHumanActivityTooRecent', () => {
  const nowMs = Date.now();

  it('returns false when lastHumanActivityAt is null', () => {
    expect(isHumanActivityTooRecent(null, 30, nowMs)).toBe(false);
  });

  it('returns true when activity was within the window', () => {
    const fiveMinutesAgo = new Date(nowMs - 5 * 60_000);
    expect(isHumanActivityTooRecent(fiveMinutesAgo, 30, nowMs)).toBe(true);
  });

  it('returns false when activity was outside the window', () => {
    const twoHoursAgo = new Date(nowMs - 120 * 60_000);
    expect(isHumanActivityTooRecent(twoHoursAgo, 30, nowMs)).toBe(false);
  });

  it('returns false exactly at the boundary (elapsed == minMinutes)', () => {
    const exactlyAtBoundary = new Date(nowMs - 30 * 60_000);
    // elapsed = 30 minutes, minMinutes = 30: 30 < 30 is false
    expect(isHumanActivityTooRecent(exactlyAtBoundary, 30, nowMs)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// minutesSinceHumanActivity
// ---------------------------------------------------------------------------

describe('minutesSinceHumanActivity', () => {
  it('returns null when lastHumanActivityAt is null', () => {
    expect(minutesSinceHumanActivity(null, Date.now())).toBeNull();
  });

  it('returns approximate elapsed minutes', () => {
    const nowMs = Date.now();
    const tenMinutesAgo = new Date(nowMs - 10 * 60_000);
    const result = minutesSinceHumanActivity(tenMinutesAgo, nowMs);
    expect(result).toBeCloseTo(10, 0);
  });
});

// ---------------------------------------------------------------------------
// buildTerminalEventPredicateSql
// ---------------------------------------------------------------------------

describe('buildTerminalEventPredicateSql', () => {
  it('returns a string containing the three terminal event types', () => {
    const predicate = buildTerminalEventPredicateSql();
    expect(predicate).toContain('phase1.support.draft_proposed');
    expect(predicate).toContain('phase1.support.collision_skipped');
    expect(predicate).toContain('phase1.support.ticket_terminal');
  });

  it('contains the COALESCE fallback', () => {
    const predicate = buildTerminalEventPredicateSql();
    expect(predicate).toContain('COALESCE');
    expect(predicate).toContain('last_customer_message_at');
    expect(predicate).toContain('created_at');
  });

  it('uses NOT EXISTS outer clause', () => {
    const predicate = buildTerminalEventPredicateSql();
    expect(predicate.trim().startsWith('NOT EXISTS')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// substituteMasterPromptPlaceholders
// ---------------------------------------------------------------------------

describe('substituteMasterPromptPlaceholders', () => {
  it('replaces all four placeholders', () => {
    const template =
      'Voice: {{voice_profile}}. Min confidence: {{min_confidence}}. Escalation: {{escalation_categories}}. Mode: {{inbox_mode}}.';
    const result = substituteMasterPromptPlaceholders(template, {
      voice_profile: 'formal',
      min_confidence: '0.9',
      escalation_categories: 'billing, cancellation',
      inbox_mode: 'autonomous',
    });
    expect(result).toBe(
      'Voice: formal. Min confidence: 0.9. Escalation: billing, cancellation. Mode: autonomous.',
    );
  });

  it('leaves unknown placeholders intact', () => {
    const template = 'Known: {{voice_profile}}. Unknown: {{unknown_field}}.';
    const result = substituteMasterPromptPlaceholders(template, {
      voice_profile: 'neutral',
      min_confidence: '0.8',
      escalation_categories: 'none',
      inbox_mode: 'assisted',
    });
    expect(result).toContain('{{unknown_field}}');
    expect(result).toContain('neutral');
  });

  it('replaces all occurrences of a repeated placeholder', () => {
    const template = '{{voice_profile}} and again {{voice_profile}}';
    const result = substituteMasterPromptPlaceholders(template, {
      voice_profile: 'casual',
      min_confidence: '0.8',
      escalation_categories: 'none',
      inbox_mode: 'assisted',
    });
    expect(result).toBe('casual and again casual');
  });
});

// ---------------------------------------------------------------------------
// buildPromptPlaceholders
// ---------------------------------------------------------------------------

describe('buildPromptPlaceholders', () => {
  const baseConfig: SupportInboxAgentConfig = {
    version: 1,
    mode: 'assisted',
    collisionWindow: { minMinutesSinceHumanActivity: 30, respectHumanAssignee: true },
    draftExpiry: { awaitingReviewHours: 72, draftHours: 24 },
    optIns: { autonomousReplyOnWaitingOnCustomer: false, postResolutionFollowUp: false },
    minConfidence: 0.85,
    voiceProfile: 'formal',
    escalationCategories: ['billing', 'cancellation'],
  };

  it('maps voiceProfile', () => {
    const placeholders = buildPromptPlaceholders(baseConfig);
    expect(placeholders.voice_profile).toBe('formal');
  });

  it('maps minConfidence as string', () => {
    const placeholders = buildPromptPlaceholders(baseConfig);
    expect(placeholders.min_confidence).toBe('0.85');
  });

  it('joins escalationCategories', () => {
    const placeholders = buildPromptPlaceholders(baseConfig);
    expect(placeholders.escalation_categories).toBe('billing, cancellation');
  });

  it('defaults escalation_categories to "none configured" when empty', () => {
    const config: SupportInboxAgentConfig = { ...baseConfig, escalationCategories: [] };
    const placeholders = buildPromptPlaceholders(config);
    expect(placeholders.escalation_categories).toBe('none configured');
  });

  it('maps inbox mode', () => {
    const placeholders = buildPromptPlaceholders(baseConfig);
    expect(placeholders.inbox_mode).toBe('assisted');
  });
});

// ---------------------------------------------------------------------------
// requiresCustomerHistory
// ---------------------------------------------------------------------------

describe('requiresCustomerHistory', () => {
  it('returns true for account_question', () => {
    expect(requiresCustomerHistory('account_question')).toBe(true);
  });

  it('returns true for billing_question', () => {
    expect(requiresCustomerHistory('billing_question')).toBe(true);
  });

  it('returns true for cancellation_request', () => {
    expect(requiresCustomerHistory('cancellation_request')).toBe(true);
  });

  it('returns false for bug_report', () => {
    expect(requiresCustomerHistory('bug_report')).toBe(false);
  });

  it('returns false for how_to_question', () => {
    expect(requiresCustomerHistory('how_to_question')).toBe(false);
  });

  it('ACCOUNT_ISSUE_INTENTS has exactly 3 members', () => {
    expect(ACCOUNT_ISSUE_INTENTS.size).toBe(3);
  });
});
