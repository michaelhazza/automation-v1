import { describe, expect, it } from 'vitest';

import {
  windowConversationHistory,
  concatenateArtefactPointers,
  deriveHistoryWindowSize,
  CONVERSATION_HISTORY_K,
} from '../operatorConversationHistoryPure.js';

describe('CONVERSATION_HISTORY_K', () => {
  it('is 5', () => {
    expect(CONVERSATION_HISTORY_K).toBe(5);
  });
});

describe('windowConversationHistory', () => {
  it('returns all artefacts for the current attempt when fewer than K exist', () => {
    const pointers = [
      { artefactId: 'a1', chainSeq: 1, attemptNumber: 1 },
      { artefactId: 'a2', chainSeq: 2, attemptNumber: 1 },
      { artefactId: 'a3', chainSeq: 3, attemptNumber: 1 },
    ];
    const result = windowConversationHistory(pointers, 1);
    expect(result.artefactIds).toEqual(['a1', 'a2', 'a3']);
    expect(result.windowSize).toBe(3);
  });

  it('truncates to last K=5 artefacts when more than K exist', () => {
    const pointers = Array.from({ length: 8 }, (_, i) => ({
      artefactId: `a${i + 1}`,
      chainSeq: i + 1,
      attemptNumber: 1,
    }));
    const result = windowConversationHistory(pointers, 1);
    expect(result.artefactIds).toEqual(['a4', 'a5', 'a6', 'a7', 'a8']);
    expect(result.windowSize).toBe(5);
  });

  it('filters out artefacts from other attempts', () => {
    const pointers = [
      { artefactId: 'old-1', chainSeq: 1, attemptNumber: 1 }, // prior attempt
      { artefactId: 'new-1', chainSeq: 1, attemptNumber: 2 }, // current attempt
      { artefactId: 'new-2', chainSeq: 2, attemptNumber: 2 },
    ];
    const result = windowConversationHistory(pointers, 2);
    expect(result.artefactIds).toEqual(['new-1', 'new-2']);
  });

  it('returns empty list when no artefacts exist for the attempt', () => {
    const result = windowConversationHistory([], 1);
    expect(result.artefactIds).toHaveLength(0);
    expect(result.windowSize).toBe(0);
  });

  it('sorts artefact pointers by chainSeq ASC before windowing', () => {
    const pointers = [
      { artefactId: 'a3', chainSeq: 3, attemptNumber: 1 },
      { artefactId: 'a1', chainSeq: 1, attemptNumber: 1 },
      { artefactId: 'a2', chainSeq: 2, attemptNumber: 1 },
    ];
    const result = windowConversationHistory(pointers, 1);
    expect(result.artefactIds).toEqual(['a1', 'a2', 'a3']);
  });

  it('respects custom K override', () => {
    const pointers = Array.from({ length: 5 }, (_, i) => ({
      artefactId: `a${i + 1}`,
      chainSeq: i + 1,
      attemptNumber: 1,
    }));
    const result = windowConversationHistory(pointers, 1, 3);
    expect(result.artefactIds).toEqual(['a3', 'a4', 'a5']);
  });
});

describe('concatenateArtefactPointers', () => {
  it('returns ordered artefact ids for the current attempt window', () => {
    const pointers = [
      { artefactId: 'a1', chainSeq: 1, attemptNumber: 1 },
      { artefactId: 'a2', chainSeq: 2, attemptNumber: 1 },
    ];
    const ids = concatenateArtefactPointers(pointers, 1);
    expect(ids).toEqual(['a1', 'a2']);
  });
});

describe('deriveHistoryWindowSize', () => {
  it('returns CONVERSATION_HISTORY_K', () => {
    expect(deriveHistoryWindowSize()).toBe(CONVERSATION_HISTORY_K);
  });
});
