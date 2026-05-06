import { describe, it, expect } from 'vitest';
import { parseConflictReportPure } from '../ruleConflictDetectorServicePure.js';
import type { RuleConflictInput } from '../ruleConflictDetectorServicePure.js';

const baseInput: RuleConflictInput = {
  newRule: { text: 'Always respond in English', scope: { kind: 'org' } },
  candidatePool: [
    {
      id: 'rule-001',
      text: 'Respond only in French',
      scope: { kind: 'org' },
      isAuthoritative: false,
      priority: 'medium',
    },
    {
      id: 'rule-002',
      text: 'Keep responses brief',
      scope: { kind: 'org' },
      isAuthoritative: false,
      priority: 'low',
    },
    {
      id: 'rule-003',
      text: 'Provide detailed explanations where possible',
      scope: { kind: 'agent', agentId: 'agent-a' },
      isAuthoritative: true,
      priority: 'high',
    },
  ],
};

describe('parseConflictReportPure', () => {
  describe('adjacent rules with overlapping conditions (direct_contradiction)', () => {
    it('returns a direct_contradiction conflict for a contradictory candidate', () => {
      const llmOutput = {
        conflicts: [
          {
            existingRuleId: 'rule-001',
            existingText: 'Respond only in French',
            conflictKind: 'direct_contradiction',
            confidence: 0.95,
            suggestedResolution: 'keep_new',
          },
        ],
      };
      const result = parseConflictReportPure(llmOutput, baseInput);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].conflictKind).toBe('direct_contradiction');
      expect(result.conflicts[0].existingRuleId).toBe('rule-001');
      expect(result.conflicts[0].suggestedResolution).toBe('keep_new');
      expect(result.conflicts[0].confidence).toBe(0.95);
    });
  });

  describe('rules with subset/superset condition overlap', () => {
    it('returns a superset conflict when a new rule subsumes an existing one', () => {
      const llmOutput = {
        conflicts: [
          {
            existingRuleId: 'rule-002',
            existingText: 'Keep responses brief',
            conflictKind: 'superset',
            confidence: 0.7,
            suggestedResolution: 'keep_both_with_priorities',
          },
        ],
      };
      const result = parseConflictReportPure(llmOutput, baseInput);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].conflictKind).toBe('superset');
      expect(result.conflicts[0].confidence).toBe(0.7);
    });

    it('returns a subset conflict when a new rule is narrower than an existing one', () => {
      const llmOutput = {
        conflicts: [
          {
            existingRuleId: 'rule-003',
            existingText: 'Provide detailed explanations where possible',
            conflictKind: 'subset',
            confidence: 0.6,
            suggestedResolution: 'user_decides',
          },
        ],
      };
      const result = parseConflictReportPure(llmOutput, baseInput);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].conflictKind).toBe('subset');
      expect(result.conflicts[0].existingScope).toEqual({ kind: 'agent', agentId: 'agent-a' });
    });
  });

  describe('contradictory rules with the same trigger', () => {
    it('returns scope_overlap when two rules apply to the same scope', () => {
      const llmOutput = {
        conflicts: [
          {
            existingRuleId: 'rule-001',
            existingText: 'Respond only in French',
            conflictKind: 'scope_overlap',
            confidence: 0.8,
            suggestedResolution: 'keep_existing',
          },
        ],
      };
      const result = parseConflictReportPure(llmOutput, baseInput);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].conflictKind).toBe('scope_overlap');
    });

    it('returns empty conflicts when LLM output is malformed', () => {
      const result = parseConflictReportPure(null, baseInput);
      expect(result.conflicts).toHaveLength(0);
      expect(result.checkedAt).toBeTruthy();
    });

    it('drops conflicts referencing unknown rule IDs', () => {
      const llmOutput = {
        conflicts: [
          {
            existingRuleId: 'rule-999',
            existingText: 'Unknown rule',
            conflictKind: 'direct_contradiction',
            confidence: 0.9,
            suggestedResolution: 'keep_new',
          },
        ],
      };
      const result = parseConflictReportPure(llmOutput, baseInput);
      expect(result.conflicts).toHaveLength(0);
    });

    it('drops conflicts with invalid conflictKind', () => {
      const llmOutput = {
        conflicts: [
          {
            existingRuleId: 'rule-001',
            existingText: 'Respond only in French',
            conflictKind: 'partial_overlap',
            confidence: 0.9,
            suggestedResolution: 'keep_new',
          },
        ],
      };
      const result = parseConflictReportPure(llmOutput, baseInput);
      expect(result.conflicts).toHaveLength(0);
    });

    it('drops conflicts with out-of-range confidence', () => {
      const llmOutput = {
        conflicts: [
          {
            existingRuleId: 'rule-001',
            existingText: 'Respond only in French',
            conflictKind: 'direct_contradiction',
            confidence: 1.5,
            suggestedResolution: 'keep_new',
          },
        ],
      };
      const result = parseConflictReportPure(llmOutput, baseInput);
      expect(result.conflicts).toHaveLength(0);
    });
  });
});
