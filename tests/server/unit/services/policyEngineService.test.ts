import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const { mockSelectWhere, mockGetActionDefinition, mockInsertOnConflict } = vi.hoisted(() => {
  const mockOrderBy = vi.fn();
  const mockSelectWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
  mockOrderBy.mockResolvedValue([]);
  const mockGetActionDefinition = vi.fn();
  const mockInsertOnConflict = vi.fn().mockResolvedValue(undefined);
  return { mockSelectWhere, mockGetActionDefinition, mockInsertOnConflict };
});

vi.mock('../../../../server/db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: mockSelectWhere,
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: mockInsertOnConflict,
      }),
    }),
  },
}));

vi.mock('../../../../server/db/schema/index.js', () => ({
  policyRules: {
    organisationId: 'organisationId',
    isActive: 'isActive',
    priority: 'priority',
  },
}));

vi.mock('../../../../server/config/actionRegistry.js', () => ({
  getActionDefinition: mockGetActionDefinition,
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col, val) => ({ op: 'eq', val })),
  and: vi.fn((...args: unknown[]) => args),
  asc: vi.fn((col) => ({ op: 'asc', col })),
}));

import { policyEngineService } from '../../../../server/services/policyEngineService.js';

// ── Tests ──────────────────────────────────────────────────────────────────

describe('policyEngineService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Invalidate the internal cache between tests
    policyEngineService.invalidateCache('org-1');
    policyEngineService.invalidateCache('org-2');
  });

  describe('evaluatePolicy', () => {
    it('returns matched rule decision when a rule matches', async () => {
      const rule = {
        id: 'rule-1',
        toolSlug: 'send_email',
        subaccountId: null,
        conditions: {},
        decision: 'auto',
        priority: 1,
        timeoutSeconds: null,
        timeoutPolicy: null,
        interruptConfig: null,
        allowedDecisions: null,
        descriptionTemplate: null,
      };
      mockSelectWhere.mockReturnValueOnce({ orderBy: vi.fn().mockResolvedValue([rule]) });

      const result = await policyEngineService.evaluatePolicy({
        toolSlug: 'send_email',
        subaccountId: 'sa-1',
        organisationId: 'org-1',
      });

      expect(result.decision).toBe('auto');
      expect(result.matchedRule).toEqual(rule);
    });

    it('returns review decision for blocked rule', async () => {
      const rule = {
        id: 'rule-2',
        toolSlug: 'delete_account',
        subaccountId: null,
        conditions: {},
        decision: 'block',
        priority: 1,
        timeoutSeconds: null,
        timeoutPolicy: null,
        interruptConfig: null,
        allowedDecisions: null,
        descriptionTemplate: null,
      };
      mockSelectWhere.mockReturnValueOnce({ orderBy: vi.fn().mockResolvedValue([rule]) });

      const result = await policyEngineService.evaluatePolicy({
        toolSlug: 'delete_account',
        subaccountId: 'sa-1',
        organisationId: 'org-1',
      });

      expect(result.decision).toBe('block');
      expect(result.matchedRule).toEqual(rule);
    });

    it('falls back to registry default when no rule matches', async () => {
      mockSelectWhere.mockReturnValueOnce({ orderBy: vi.fn().mockResolvedValue([]) });
      mockGetActionDefinition.mockReturnValue({ defaultGateLevel: 'auto' });

      const result = await policyEngineService.evaluatePolicy({
        toolSlug: 'read_data',
        subaccountId: 'sa-1',
        organisationId: 'org-1',
      });

      expect(result.decision).toBe('auto');
      expect(result.matchedRule).toBeNull();
    });

    it('falls back to review when no rule and no registry definition', async () => {
      mockSelectWhere.mockReturnValueOnce({ orderBy: vi.fn().mockResolvedValue([]) });
      mockGetActionDefinition.mockReturnValue(undefined);

      const result = await policyEngineService.evaluatePolicy({
        toolSlug: 'unknown_tool',
        subaccountId: 'sa-1',
        organisationId: 'org-1',
      });

      expect(result.decision).toBe('review');
      expect(result.matchedRule).toBeNull();
    });

    it('matches wildcard tool slug rule', async () => {
      const wildcardRule = {
        id: 'rule-wildcard',
        toolSlug: '*',
        subaccountId: null,
        conditions: {},
        decision: 'review',
        priority: 9999,
        timeoutSeconds: 300,
        timeoutPolicy: 'auto_reject',
        interruptConfig: null,
        allowedDecisions: null,
        descriptionTemplate: 'Review {{tool_slug}} in {{subaccount_id}}',
      };
      mockSelectWhere.mockReturnValueOnce({ orderBy: vi.fn().mockResolvedValue([wildcardRule]) });

      const result = await policyEngineService.evaluatePolicy({
        toolSlug: 'any_tool',
        subaccountId: 'sa-1',
        organisationId: 'org-1',
      });

      expect(result.decision).toBe('review');
      expect(result.timeoutSeconds).toBe(300);
      expect(result.timeoutPolicy).toBe('auto_reject');
      expect(result.description).toBe('Review any_tool in sa-1');
    });

    it('skips rules scoped to a different subaccount', async () => {
      const scopedRule = {
        id: 'rule-scoped',
        toolSlug: 'send_email',
        subaccountId: 'sa-other',
        conditions: {},
        decision: 'auto',
        priority: 1,
        timeoutSeconds: null,
        timeoutPolicy: null,
        interruptConfig: null,
        allowedDecisions: null,
        descriptionTemplate: null,
      };
      mockSelectWhere.mockReturnValueOnce({ orderBy: vi.fn().mockResolvedValue([scopedRule]) });
      mockGetActionDefinition.mockReturnValue({ defaultGateLevel: 'review' });

      const result = await policyEngineService.evaluatePolicy({
        toolSlug: 'send_email',
        subaccountId: 'sa-1',
        organisationId: 'org-1',
      });

      // Rule doesn't match because subaccount doesn't match, so falls back
      expect(result.decision).toBe('review');
      expect(result.matchedRule).toBeNull();
    });

    it('first-match wins with priority ordering', async () => {
      const highPriority = {
        id: 'rule-high',
        toolSlug: 'send_email',
        subaccountId: null,
        conditions: {},
        decision: 'auto',
        priority: 1,
        timeoutSeconds: null,
        timeoutPolicy: null,
        interruptConfig: null,
        allowedDecisions: null,
        descriptionTemplate: null,
      };
      const lowPriority = {
        id: 'rule-low',
        toolSlug: 'send_email',
        subaccountId: null,
        conditions: {},
        decision: 'block',
        priority: 100,
        timeoutSeconds: null,
        timeoutPolicy: null,
        interruptConfig: null,
        allowedDecisions: null,
        descriptionTemplate: null,
      };
      mockSelectWhere.mockReturnValueOnce({
        orderBy: vi.fn().mockResolvedValue([highPriority, lowPriority]),
      });

      const result = await policyEngineService.evaluatePolicy({
        toolSlug: 'send_email',
        subaccountId: 'sa-1',
        organisationId: 'org-2',
      });

      expect(result.decision).toBe('auto');
      expect(result.matchedRule?.id).toBe('rule-high');
    });

    it('matches conditions on input fields', async () => {
      const conditionRule = {
        id: 'rule-cond',
        toolSlug: 'transfer_funds',
        subaccountId: null,
        conditions: { currency: 'USD' },
        decision: 'review',
        priority: 1,
        timeoutSeconds: null,
        timeoutPolicy: null,
        interruptConfig: null,
        allowedDecisions: null,
        descriptionTemplate: null,
      };
      mockSelectWhere.mockReturnValueOnce({ orderBy: vi.fn().mockResolvedValue([conditionRule]) });

      const result = await policyEngineService.evaluatePolicy({
        toolSlug: 'transfer_funds',
        subaccountId: 'sa-1',
        organisationId: 'org-1',
        input: { currency: 'USD', amount: 100 },
      });

      expect(result.decision).toBe('review');
      expect(result.matchedRule?.id).toBe('rule-cond');
    });

    it('skips condition rule when input does not match', async () => {
      const conditionRule = {
        id: 'rule-cond-mismatch',
        toolSlug: 'transfer_funds',
        subaccountId: null,
        conditions: { currency: 'EUR' },
        decision: 'block',
        priority: 1,
        timeoutSeconds: null,
        timeoutPolicy: null,
        interruptConfig: null,
        allowedDecisions: null,
        descriptionTemplate: null,
      };
      mockSelectWhere.mockReturnValueOnce({ orderBy: vi.fn().mockResolvedValue([conditionRule]) });
      mockGetActionDefinition.mockReturnValue({ defaultGateLevel: 'auto' });

      const result = await policyEngineService.evaluatePolicy({
        toolSlug: 'transfer_funds',
        subaccountId: 'sa-1',
        organisationId: 'org-1',
        input: { currency: 'USD' },
      });

      // Condition doesn't match so falls through to registry default
      expect(result.decision).toBe('auto');
      expect(result.matchedRule).toBeNull();
    });
  });

  describe('invalidateCache', () => {
    it('does not throw for unknown org', () => {
      expect(() => policyEngineService.invalidateCache('org-unknown')).not.toThrow();
    });
  });
});
