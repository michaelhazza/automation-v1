import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor } from '../runTraceEvent.js';
import type { RunTraceEvent, RunTraceEventType } from '../runTraceEvent.js';

describe('runTraceEvent', () => {
  describe('cursor encode / decode round-trip', () => {
    it('round-trips basic values', () => {
      const ts = '2026-05-09T12:00:00.000Z';
      const seq = 42;
      const table = 'agent_execution_events';
      const id = 'abc-123';

      const encoded = encodeCursor(ts, seq, table, id);
      const decoded = decodeCursor(encoded);

      expect(decoded.timestamp).toBe(ts);
      expect(decoded.sequenceNumber).toBe(seq);
      expect(decoded.sourceTable).toBe(table);
      expect(decoded.sourceId).toBe(id);
    });

    it('produces an opaque base64 string', () => {
      const encoded = encodeCursor('2026-01-01T00:00:00.000Z', 0, 'actions', 'id-1');
      // base64 characters only
      expect(encoded).toMatch(/^[A-Za-z0-9+/=]+$/);
    });

    it('is stable (same input -> same output)', () => {
      const a = encodeCursor('2026-05-09T00:00:00.000Z', 1, 'llm_requests', 'r1');
      const b = encodeCursor('2026-05-09T00:00:00.000Z', 1, 'llm_requests', 'r1');
      expect(a).toBe(b);
    });

    it('produces different cursors for different timestamps', () => {
      const a = encodeCursor('2026-01-01T00:00:00.000Z', 1, 'actions', 'id');
      const b = encodeCursor('2026-01-02T00:00:00.000Z', 1, 'actions', 'id');
      expect(a).not.toBe(b);
    });

    it('produces different cursors for different sequence numbers', () => {
      const a = encodeCursor('2026-01-01T00:00:00.000Z', 1, 'actions', 'id');
      const b = encodeCursor('2026-01-01T00:00:00.000Z', 2, 'actions', 'id');
      expect(a).not.toBe(b);
    });

    it('produces different cursors for different source tables', () => {
      const a = encodeCursor('2026-01-01T00:00:00.000Z', 1, 'actions', 'id');
      const b = encodeCursor('2026-01-01T00:00:00.000Z', 1, 'iee_steps', 'id');
      expect(a).not.toBe(b);
    });

    it('produces different cursors for different source ids', () => {
      const a = encodeCursor('2026-01-01T00:00:00.000Z', 1, 'actions', 'id-1');
      const b = encodeCursor('2026-01-01T00:00:00.000Z', 1, 'actions', 'id-2');
      expect(a).not.toBe(b);
    });

    it('handles sequence number 0', () => {
      const encoded = encodeCursor('2026-01-01T00:00:00.000Z', 0, 't', 'i');
      const decoded = decodeCursor(encoded);
      expect(decoded.sequenceNumber).toBe(0);
    });

    it('throws on a corrupt cursor', () => {
      expect(() => decodeCursor('!!!not-base64-valid-cursor!!!')).toThrow();
    });

    it('throws on a cursor with wrong field count', () => {
      // Encode just 2 parts (wrong format)
      const bad = Buffer.from('ts\x00seq', 'utf8').toString('base64');
      expect(() => decodeCursor(bad)).toThrow('Invalid run trace cursor: unexpected format');
    });
  });

  describe('RunTraceEvent discriminated union narrowing', () => {
    // Helper: create a base event
    function base(): {
      id: string;
      runId: string;
      organisationId: string;
      timestamp: string;
      sequenceNumber: number;
      sourceTable: string;
      sourceId: string;
    } {
      return {
        id: 'evt-1',
        runId: 'run-1',
        organisationId: 'org-1',
        timestamp: '2026-05-09T00:00:00.000Z',
        sequenceNumber: 1,
        sourceTable: 'agent_execution_events',
        sourceId: 'src-1',
      };
    }

    it('narrows to controller_style_decided payload', () => {
      const event: RunTraceEvent = {
        ...base(),
        eventType: 'controller_style_decided',
        controllerStyle: 'native',
        source: 'executionMode',
      };
      if (event.eventType === 'controller_style_decided') {
        expect(event.controllerStyle).toBe('native');
        expect(event.source).toBe('executionMode');
      } else {
        throw new Error('Narrowing failed');
      }
    });

    it('narrows to run_terminated payload', () => {
      const event: RunTraceEvent = {
        ...base(),
        eventType: 'run_terminated',
        finalStatus: 'failed',
        failureReason: 'policy_envelope_resolution_failed',
        totalDurationMs: 500,
      };
      if (event.eventType === 'run_terminated') {
        expect(event.finalStatus).toBe('failed');
        expect(event.failureReason).toBe('policy_envelope_resolution_failed');
      } else {
        throw new Error('Narrowing failed');
      }
    });

    it('narrows to tool_security_decision payload', () => {
      const event: RunTraceEvent = {
        ...base(),
        eventType: 'tool_security_decision',
        toolSlug: 'send_email',
        riskTier: 5,
        gateLevel: 'block',
        gateLevelSource: 'tier_default',
      };
      if (event.eventType === 'tool_security_decision') {
        expect(event.riskTier).toBe(5);
        expect(event.gateLevel).toBe('block');
      } else {
        throw new Error('Narrowing failed');
      }
    });

    it('narrows to llm_call payload', () => {
      const event: RunTraceEvent = {
        ...base(),
        eventType: 'llm_call',
        llmRequestId: 'llm-1',
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
        tokensIn: 1000,
        tokensOut: 200,
        costWithMarginCents: 5,
        durationMs: 1200,
      };
      if (event.eventType === 'llm_call') {
        expect(event.provider).toBe('anthropic');
        expect(event.tokensIn).toBe(1000);
      } else {
        throw new Error('Narrowing failed');
      }
    });

    it('narrows to run_started payload', () => {
      const event: RunTraceEvent = {
        ...base(),
        eventType: 'run_started',
        runType: 'manual',
        triggeredBy: 'user-1',
      };
      if (event.eventType === 'run_started') {
        expect(event.runType).toBe('manual');
      } else {
        throw new Error('Narrowing failed');
      }
    });

    it('narrows to delegation_spawned payload', () => {
      const event: RunTraceEvent = {
        ...base(),
        eventType: 'delegation_spawned',
        targetAgentId: 'agent-2',
        delegationScope: 'children',
        depth: 1,
      };
      if (event.eventType === 'delegation_spawned') {
        expect(event.targetAgentId).toBe('agent-2');
      } else {
        throw new Error('Narrowing failed');
      }
    });

    it('narrows to iee_step payload', () => {
      const event: RunTraceEvent = {
        ...base(),
        eventType: 'iee_step',
        stepKind: 'browser_action',
        durationMs: 300,
      };
      if (event.eventType === 'iee_step') {
        expect(event.stepKind).toBe('browser_action');
      } else {
        throw new Error('Narrowing failed');
      }
    });

    it('narrows to review_requested payload', () => {
      const event: RunTraceEvent = {
        ...base(),
        eventType: 'review_requested',
        toolSlug: 'deploy',
        requestedBy: 'agentExecutionService',
      };
      if (event.eventType === 'review_requested') {
        expect(event.toolSlug).toBe('deploy');
      } else {
        throw new Error('Narrowing failed');
      }
    });

    it('narrows to review_decided payload', () => {
      const event: RunTraceEvent = {
        ...base(),
        eventType: 'review_decided',
        toolSlug: 'deploy',
        decision: 'review',
        decidedBy: 'user-1',
      };
      if (event.eventType === 'review_decided') {
        expect(event.decision).toBe('review');
      } else {
        throw new Error('Narrowing failed');
      }
    });

    it('narrows to tool_call payload', () => {
      const event: RunTraceEvent = {
        ...base(),
        eventType: 'tool_call',
        toolSlug: 'send_email',
        actionId: 'act-1',
      };
      if (event.eventType === 'tool_call') {
        expect(event.toolSlug).toBe('send_email');
      } else {
        throw new Error('Narrowing failed');
      }
    });

    it('narrows to tool_result payload', () => {
      const event: RunTraceEvent = {
        ...base(),
        eventType: 'tool_result',
        toolSlug: 'send_email',
        status: 'ok',
        durationMs: 150,
      };
      if (event.eventType === 'tool_result') {
        expect(event.status).toBe('ok');
      } else {
        throw new Error('Narrowing failed');
      }
    });

    it('narrows to policy_envelope_resolved payload', () => {
      const event: RunTraceEvent = {
        ...base(),
        eventType: 'policy_envelope_resolved',
        schemaVersion: 1,
        sourceCounts: { activePolicyRules: 3 },
      };
      if (event.eventType === 'policy_envelope_resolved') {
        expect(event.schemaVersion).toBe(1);
      } else {
        throw new Error('Narrowing failed');
      }
    });

    it('narrows to routing_path_chosen payload', () => {
      const event: RunTraceEvent = {
        ...base(),
        eventType: 'routing_path_chosen',
        routingSource: 'rule',
        chosenAgentId: 'agent-1',
      };
      if (event.eventType === 'routing_path_chosen') {
        expect(event.routingSource).toBe('rule');
      } else {
        throw new Error('Narrowing failed');
      }
    });

    it('narrows to tool_proposed payload', () => {
      const event: RunTraceEvent = {
        ...base(),
        eventType: 'tool_proposed',
        toolSlug: 'send_email',
        proposedBy: 'orchestrator',
      };
      if (event.eventType === 'tool_proposed') {
        expect(event.proposedBy).toBe('orchestrator');
      } else {
        throw new Error('Narrowing failed');
      }
    });

    it('narrows to delegation_completed payload', () => {
      const event: RunTraceEvent = {
        ...base(),
        eventType: 'delegation_completed',
        targetAgentId: 'agent-2',
        outcome: 'accepted',
        reason: null,
      };
      if (event.eventType === 'delegation_completed') {
        expect(event.outcome).toBe('accepted');
        expect(event.reason).toBeNull();
      } else {
        throw new Error('Narrowing failed');
      }
    });
  });

  describe('RunTraceEventType union coverage', () => {
    it('includes all 15 event types', () => {
      const expected: RunTraceEventType[] = [
        'controller_style_decided',
        'policy_envelope_resolved',
        'routing_path_chosen',
        'tool_proposed',
        'tool_security_decision',
        'tool_call',
        'tool_result',
        'llm_call',
        'delegation_spawned',
        'delegation_completed',
        'review_requested',
        'review_decided',
        'iee_step',
        'run_started',
        'run_terminated',
      ];
      expect(expected).toHaveLength(15);

      // Verify each is a valid string (compile-time shape is what matters here)
      for (const t of expected) {
        expect(typeof t).toBe('string');
      }
    });
  });
});
