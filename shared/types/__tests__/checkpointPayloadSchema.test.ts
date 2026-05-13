import { describe, it, expect } from 'vitest';
import { CheckpointPayloadSchemaV1 } from '../checkpointPayload.js';

const CANONICAL_PAYLOAD = {
  version: 1 as const,
  original_task_brief_ref: {
    kind: 'agent_run_brief' as const,
    agent_run_id: '9e1f3b88-0000-0000-0000-000000000001',
    artefact_id: 'br-abc123',
    snapshotted_at: '2026-05-12T13:00:00.000Z',
  },
  conversation_history_pointer: {
    kind: 'artefact_chain' as const,
    artefact_ids: ['op-conv-link-1', 'op-conv-link-2'],
    history_window_size: 5,
  },
  current_page_url: 'https://example.com/dashboard',
  last_action_summary: 'Submitted invoice form.',
  next_planned_step: 'Verify confirmation page.',
  last_state_screenshot_artefact_id: 'screenshot-xyz',
  is_resumable_now: true,
  captured_at: '2026-05-12T16:01:41.000Z',
};

describe('CheckpointPayloadSchemaV1', () => {
  it('validates a canonical example', () => {
    const result = CheckpointPayloadSchemaV1.safeParse(CANONICAL_PAYLOAD);
    expect(result.success).toBe(true);
  });

  it('validates a minimal example (only required fields)', () => {
    const minimal = {
      version: 1 as const,
      original_task_brief_ref: {
        kind: 'agent_run_brief' as const,
        agent_run_id: '9e1f3b88-0000-0000-0000-000000000001',
        artefact_id: 'br-abc123',
        snapshotted_at: '2026-05-12T13:00:00.000Z',
      },
      conversation_history_pointer: {
        kind: 'artefact_chain' as const,
        artefact_ids: [],
        history_window_size: 1,
      },
      is_resumable_now: false,
      captured_at: '2026-05-12T16:01:41.000Z',
    };
    const result = CheckpointPayloadSchemaV1.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it('rejects an incorrect version literal', () => {
    const malformed = { ...CANONICAL_PAYLOAD, version: 2 };
    const result = CheckpointPayloadSchemaV1.safeParse(malformed);
    expect(result.success).toBe(false);
  });

  it('rejects a malformed conversation_history_pointer (missing kind)', () => {
    const malformed = {
      ...CANONICAL_PAYLOAD,
      conversation_history_pointer: {
        artefact_ids: [],
        history_window_size: 5,
      },
    };
    const result = CheckpointPayloadSchemaV1.safeParse(malformed);
    expect(result.success).toBe(false);
  });

  it('rejects a missing required field (original_task_brief_ref)', () => {
    const { original_task_brief_ref: _omitted, ...withoutBriefRef } = CANONICAL_PAYLOAD;
    const result = CheckpointPayloadSchemaV1.safeParse(withoutBriefRef);
    expect(result.success).toBe(false);
  });

  it('rejects an invalid URL for current_page_url', () => {
    const malformed = { ...CANONICAL_PAYLOAD, current_page_url: 'not-a-url' };
    const result = CheckpointPayloadSchemaV1.safeParse(malformed);
    expect(result.success).toBe(false);
  });

  it('rejects a non-positive history_window_size', () => {
    const malformed = {
      ...CANONICAL_PAYLOAD,
      conversation_history_pointer: {
        ...CANONICAL_PAYLOAD.conversation_history_pointer,
        history_window_size: 0,
      },
    };
    const result = CheckpointPayloadSchemaV1.safeParse(malformed);
    expect(result.success).toBe(false);
  });
});
