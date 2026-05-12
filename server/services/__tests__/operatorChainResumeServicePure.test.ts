import { describe, expect, it } from 'vitest';

import {
  composeResumePayload,
  CONVERSATION_HISTORY_WINDOW_K,
} from '../operatorChainResumeServicePure.js';
import type { CheckpointPayload } from '../../../shared/types/checkpointPayload.js';

const makeCheckpoint = (overrides?: Partial<CheckpointPayload>): CheckpointPayload => ({
  version: 1,
  original_task_brief_ref: {
    kind: 'agent_run_brief',
    agent_run_id: 'aaaaaaaa-0000-0000-0000-000000000001',
    artefact_id: 'br-001',
    snapshotted_at: '2026-05-12T13:00:00Z',
  },
  conversation_history_pointer: {
    kind: 'artefact_chain',
    artefact_ids: ['op-conv-1'],
    history_window_size: 5,
  },
  current_page_url: 'https://example.com/dashboard',
  last_action_summary: 'Clicked submit button.',
  next_planned_step: 'Verify confirmation page.',
  last_state_screenshot_artefact_id: 'screenshot-001',
  is_resumable_now: true,
  captured_at: '2026-05-12T16:00:00Z',
  ...overrides,
});

describe('composeResumePayload', () => {
  it('composes payload with K=5 window from 3 artefact pointers', () => {
    const checkpoint = makeCheckpoint();
    const result = composeResumePayload({
      agentRunId: 'run-001',
      originalTaskBriefRef: checkpoint.original_task_brief_ref,
      conversationArtefactPointers: [
        { artefactId: 'artefact-1', chainSeq: 1 },
        { artefactId: 'artefact-2', chainSeq: 2 },
        { artefactId: 'artefact-3', chainSeq: 3 },
      ],
      checkpoint,
      attemptNumber: 1,
    });

    expect(result.conversationHistoryPointer.artefact_ids).toEqual([
      'artefact-1',
      'artefact-2',
      'artefact-3',
    ]);
    expect(result.conversationHistoryPointer.history_window_size).toBe(CONVERSATION_HISTORY_WINDOW_K);
    expect(result.conversationHistoryPointer.kind).toBe('artefact_chain');
  });

  it('truncates to last K=5 artefact pointers when more than K exist', () => {
    const checkpoint = makeCheckpoint();
    const pointers = Array.from({ length: 8 }, (_, i) => ({
      artefactId: `artefact-${i + 1}`,
      chainSeq: i + 1,
    }));

    const result = composeResumePayload({
      agentRunId: 'run-001',
      originalTaskBriefRef: checkpoint.original_task_brief_ref,
      conversationArtefactPointers: pointers,
      checkpoint,
      attemptNumber: 1,
    });

    expect(result.conversationHistoryPointer.artefact_ids).toHaveLength(5);
    expect(result.conversationHistoryPointer.artefact_ids).toEqual([
      'artefact-4',
      'artefact-5',
      'artefact-6',
      'artefact-7',
      'artefact-8',
    ]);
  });

  it('sorts artefact pointers by chainSeq before windowing', () => {
    const checkpoint = makeCheckpoint();
    // Deliberately out of order
    const result = composeResumePayload({
      agentRunId: 'run-001',
      originalTaskBriefRef: checkpoint.original_task_brief_ref,
      conversationArtefactPointers: [
        { artefactId: 'artefact-3', chainSeq: 3 },
        { artefactId: 'artefact-1', chainSeq: 1 },
        { artefactId: 'artefact-2', chainSeq: 2 },
      ],
      checkpoint,
      attemptNumber: 1,
    });

    expect(result.conversationHistoryPointer.artefact_ids).toEqual([
      'artefact-1',
      'artefact-2',
      'artefact-3',
    ]);
  });

  it('preserves original task brief ref across attempts', () => {
    const checkpoint = makeCheckpoint();
    const originalBriefRef = checkpoint.original_task_brief_ref;

    const result = composeResumePayload({
      agentRunId: 'run-001',
      originalTaskBriefRef: originalBriefRef,
      conversationArtefactPointers: [],
      checkpoint,
      attemptNumber: 2,
    });

    expect(result.originalTaskBriefRef).toEqual(originalBriefRef);
    expect(result.attemptNumber).toBe(2);
  });

  it('carries through checkpoint fields into the resume payload', () => {
    const checkpoint = makeCheckpoint({
      current_page_url: 'https://example.com/checkout',
      last_action_summary: 'Submitted the form.',
      next_planned_step: 'Verify order confirmation.',
      is_resumable_now: true,
    });

    const result = composeResumePayload({
      agentRunId: 'run-001',
      originalTaskBriefRef: checkpoint.original_task_brief_ref,
      conversationArtefactPointers: [],
      checkpoint,
      attemptNumber: 1,
    });

    expect(result.currentPageUrl).toBe('https://example.com/checkout');
    expect(result.lastActionSummary).toBe('Submitted the form.');
    expect(result.nextPlannedStep).toBe('Verify order confirmation.');
    expect(result.isResumableNow).toBe(true);
  });

  it('handles empty artefact pointer list (first chain link)', () => {
    const checkpoint = makeCheckpoint();
    const result = composeResumePayload({
      agentRunId: 'run-001',
      originalTaskBriefRef: checkpoint.original_task_brief_ref,
      conversationArtefactPointers: [],
      checkpoint,
      attemptNumber: 1,
    });

    expect(result.conversationHistoryPointer.artefact_ids).toHaveLength(0);
  });
});
