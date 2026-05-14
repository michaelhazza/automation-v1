/**
 * Pure-function tests for the consolidation-pass additions in
 * skillAnalyzerServicePure.ts (Chunk 2 of skill-merge-consolidation-pass).
 *
 * Runnable via:
 *   npx vitest run server/services/__tests__/skillAnalyzerServicePure.consolidation.test.ts
 */

import { test, expect, describe } from 'vitest';
import {
  DEFAULT_WARNING_TIER_MAP,
  RESOLUTIONS_FOR_CODE,
  buildConsolidationPrompt,
  parseConsolidationResponse,
  extractPreservationInventory,
  type ProposedMerge,
  type ConsolidationParseResult,
  type ConsolidationParseRejection,
} from '../skillAnalyzerServicePure.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOriginal(overrides: Partial<ProposedMerge> = {}): ProposedMerge {
  return {
    name: 'Test Skill',
    description: 'A test skill description.',
    definition: { type: 'object', properties: { foo: { type: 'string' } } },
    instructions: 'Do the thing with `tool-a` and `skill-b`.',
    mergeRationale: 'Original rationale.',
    ...overrides,
  };
}

function makeValidResponse(original: ProposedMerge, overrides: Record<string, unknown> = {}): string {
  const payload = {
    consolidatedMerge: {
      name: original.name,
      description: original.description,
      definition: original.definition,
      instructions: original.instructions ?? 'Consolidated instructions.',
      mergeRationale: original.mergeRationale,
    },
    consolidationNote: 'Trimmed redundant sections.',
    declinedToConsolidate: false,
    declineReason: null,
    ...overrides,
  };
  return JSON.stringify(payload);
}

function isRejection(r: ConsolidationParseResult | ConsolidationParseRejection): r is ConsolidationParseRejection {
  return 'reason' in r;
}

// ---------------------------------------------------------------------------
// DEFAULT_WARNING_TIER_MAP: three new codes
// ---------------------------------------------------------------------------

describe('DEFAULT_WARNING_TIER_MAP', () => {
  test('DEFAULT_WARNING_TIER_MAP contains CONSOLIDATION_APPLIED/_DECLINED/_FAILED at informational tier', () => {
    expect(DEFAULT_WARNING_TIER_MAP.CONSOLIDATION_APPLIED).toBe('informational');
    expect(DEFAULT_WARNING_TIER_MAP.CONSOLIDATION_DECLINED).toBe('informational');
    expect(DEFAULT_WARNING_TIER_MAP.CONSOLIDATION_FAILED).toBe('informational');
  });
});

// ---------------------------------------------------------------------------
// RESOLUTIONS_FOR_CODE: three new codes
// ---------------------------------------------------------------------------

describe('RESOLUTIONS_FOR_CODE', () => {
  test('RESOLUTIONS_FOR_CODE for three new codes returns []', () => {
    expect(RESOLUTIONS_FOR_CODE.CONSOLIDATION_APPLIED).toEqual([]);
    expect(RESOLUTIONS_FOR_CODE.CONSOLIDATION_DECLINED).toEqual([]);
    expect(RESOLUTIONS_FOR_CODE.CONSOLIDATION_FAILED).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildConsolidationPrompt
// ---------------------------------------------------------------------------

describe('buildConsolidationPrompt', () => {
  test('buildConsolidationPrompt embeds tier-1 verbatim list + tier-2 best-effort list', () => {
    const merged = makeOriginal({
      instructions: 'Use `tool-a` and `skill-b`. Do not send directly to the client. confirm before submitting.',
    });
    const { system, userMessage } = buildConsolidationPrompt(merged, 100, 150, 0.30);

    // Tier-1 tool refs are in the user message
    expect(userMessage).toContain('tool-a');
    expect(userMessage).toContain('skill-b');

    // Tier-1 HITL phrase appears in user message preservation inventory
    expect(userMessage).toContain('do not send directly');

    // Tier-2 phrase appears under Tier 2 section
    expect(userMessage).toContain('confirm before');

    // Both tier sections present
    expect(userMessage).toContain('Tier 1');
    expect(userMessage).toContain('Tier 2');

    // System prompt includes hard preservation rules
    expect(system).toContain('backtick-wrapped');
    expect(system).toContain('HITL');
  });

  test('buildConsolidationPrompt sets target ceiling to richer-source words * (1 + standardThreshold) rounded', () => {
    const merged = makeOriginal();
    const { system, userMessage } = buildConsolidationPrompt(merged, 200, 280, 0.40);

    // 200 * (1 + 0.40) = 280 — already at target, but the ceiling is still set
    const expectedCeiling = Math.round(200 * (1 + 0.40));
    expect(system).toContain(`${expectedCeiling}`);
    expect(userMessage).toContain(`${expectedCeiling}`);
  });

  test('buildConsolidationPrompt sets target ceiling correctly for non-integer result', () => {
    const merged = makeOriginal();
    const { system, userMessage } = buildConsolidationPrompt(merged, 150, 200, 0.30);

    // 150 * 1.30 = 195
    expect(system).toContain('195');
    expect(userMessage).toContain('195');
  });

  test('buildConsolidationPrompt user message includes mergedWords and richerSourceWords numerics', () => {
    const merged = makeOriginal();
    const { userMessage } = buildConsolidationPrompt(merged, 120, 180, 0.30);

    expect(userMessage).toContain('180');   // mergedWords
    expect(userMessage).toContain('120');   // richerSourceWords
  });
});

// ---------------------------------------------------------------------------
// parseConsolidationResponse
// ---------------------------------------------------------------------------

describe('parseConsolidationResponse', () => {
  test('parseConsolidationResponse rejects mutated name', () => {
    const original = makeOriginal();
    const raw = makeValidResponse(original, {
      consolidatedMerge: {
        name: 'Different Name',
        description: original.description,
        definition: original.definition,
        instructions: 'Some instructions.',
        mergeRationale: original.mergeRationale,
      },
    });
    const result = parseConsolidationResponse(raw, original);
    expect(isRejection(result)).toBe(true);
    if (isRejection(result)) {
      expect(result.reason).toBe('mutated_name');
    }
  });

  test('parseConsolidationResponse rejects mutated description', () => {
    const original = makeOriginal();
    const raw = makeValidResponse(original, {
      consolidatedMerge: {
        name: original.name,
        description: 'A different description.',
        definition: original.definition,
        instructions: 'Some instructions.',
        mergeRationale: original.mergeRationale,
      },
    });
    const result = parseConsolidationResponse(raw, original);
    expect(isRejection(result)).toBe(true);
    if (isRejection(result)) {
      expect(result.reason).toBe('mutated_description');
    }
  });

  test('parseConsolidationResponse rejects mutated definition (deep-equal)', () => {
    const original = makeOriginal();
    const raw = makeValidResponse(original, {
      consolidatedMerge: {
        name: original.name,
        description: original.description,
        definition: { type: 'object', properties: { bar: { type: 'number' } } },
        instructions: 'Some instructions.',
        mergeRationale: original.mergeRationale,
      },
    });
    const result = parseConsolidationResponse(raw, original);
    expect(isRejection(result)).toBe(true);
    if (isRejection(result)) {
      expect(result.reason).toBe('mutated_definition');
    }
  });

  test('parseConsolidationResponse rejects mutated mergeRationale when echoed back', () => {
    const original = makeOriginal();
    const raw = makeValidResponse(original, {
      consolidatedMerge: {
        name: original.name,
        description: original.description,
        definition: original.definition,
        instructions: 'Some instructions.',
        mergeRationale: 'Changed rationale.',
      },
    });
    const result = parseConsolidationResponse(raw, original);
    expect(isRejection(result)).toBe(true);
    if (isRejection(result)) {
      expect(result.reason).toBe('mutated_rationale');
    }
  });

  test('parseConsolidationResponse rejects missing mergeRationale field (rationale_missing_or_invalid)', () => {
    const original = makeOriginal();
    const payload = {
      consolidatedMerge: {
        name: original.name,
        description: original.description,
        definition: original.definition,
        instructions: 'Some instructions.',
        // mergeRationale intentionally omitted
      },
      consolidationNote: 'A note.',
      declinedToConsolidate: false,
      declineReason: null,
    };
    const result = parseConsolidationResponse(JSON.stringify(payload), original);
    expect(isRejection(result)).toBe(true);
    if (isRejection(result)) {
      expect(result.reason).toBe('rationale_missing_or_invalid');
    }
  });

  test('parseConsolidationResponse rejects null mergeRationale (rationale_missing_or_invalid)', () => {
    const original = makeOriginal();
    const payload = {
      consolidatedMerge: {
        name: original.name,
        description: original.description,
        definition: original.definition,
        instructions: 'Some instructions.',
        mergeRationale: null,
      },
      consolidationNote: 'A note.',
      declinedToConsolidate: false,
      declineReason: null,
    };
    const result = parseConsolidationResponse(JSON.stringify(payload), original);
    expect(isRejection(result)).toBe(true);
    if (isRejection(result)) {
      expect(result.reason).toBe('rationale_missing_or_invalid');
    }
  });

  test('parseConsolidationResponse rejects non-string mergeRationale (rationale_missing_or_invalid)', () => {
    const original = makeOriginal();
    const payload = {
      consolidatedMerge: {
        name: original.name,
        description: original.description,
        definition: original.definition,
        instructions: 'Some instructions.',
        mergeRationale: 42,
      },
      consolidationNote: 'A note.',
      declinedToConsolidate: false,
      declineReason: null,
    };
    const result = parseConsolidationResponse(JSON.stringify(payload), original);
    expect(isRejection(result)).toBe(true);
    if (isRejection(result)) {
      expect(result.reason).toBe('rationale_missing_or_invalid');
    }
  });

  test('parseConsolidationResponse rejects whitespace-only mergeRationale (rationale_missing_or_invalid)', () => {
    const original = makeOriginal();
    const payload = {
      consolidatedMerge: {
        name: original.name,
        description: original.description,
        definition: original.definition,
        instructions: 'Some instructions.',
        mergeRationale: '   ',
      },
      consolidationNote: 'A note.',
      declinedToConsolidate: false,
      declineReason: null,
    };
    const result = parseConsolidationResponse(JSON.stringify(payload), original);
    expect(isRejection(result)).toBe(true);
    if (isRejection(result)) {
      expect(result.reason).toBe('rationale_missing_or_invalid');
    }
  });

  test('parseConsolidationResponse rejects instructions=null', () => {
    const original = makeOriginal();
    const payload = {
      consolidatedMerge: {
        name: original.name,
        description: original.description,
        definition: original.definition,
        instructions: null,
        mergeRationale: original.mergeRationale,
      },
      consolidationNote: 'A note.',
      declinedToConsolidate: false,
      declineReason: null,
    };
    const result = parseConsolidationResponse(JSON.stringify(payload), original);
    expect(isRejection(result)).toBe(true);
    if (isRejection(result)) {
      expect(result.reason).toBe('instructions_not_string');
    }
  });

  test('parseConsolidationResponse rejects instructions=whitespace-only', () => {
    const original = makeOriginal();
    const payload = {
      consolidatedMerge: {
        name: original.name,
        description: original.description,
        definition: original.definition,
        instructions: '   ',
        mergeRationale: original.mergeRationale,
      },
      consolidationNote: 'A note.',
      declinedToConsolidate: false,
      declineReason: null,
    };
    const result = parseConsolidationResponse(JSON.stringify(payload), original);
    expect(isRejection(result)).toBe(true);
    if (isRejection(result)) {
      expect(result.reason).toBe('instructions_empty');
    }
  });

  test('parseConsolidationResponse rejects missing consolidationNote', () => {
    const original = makeOriginal();
    const payload = {
      consolidatedMerge: {
        name: original.name,
        description: original.description,
        definition: original.definition,
        instructions: 'Some instructions.',
        mergeRationale: original.mergeRationale,
      },
      // consolidationNote intentionally omitted
      declinedToConsolidate: false,
      declineReason: null,
    };
    const result = parseConsolidationResponse(JSON.stringify(payload), original);
    expect(isRejection(result)).toBe(true);
    if (isRejection(result)) {
      expect(result.reason).toBe('note_missing_or_invalid');
    }
  });

  test('parseConsolidationResponse rejects empty consolidationNote', () => {
    const original = makeOriginal();
    const payload = {
      consolidatedMerge: {
        name: original.name,
        description: original.description,
        definition: original.definition,
        instructions: 'Some instructions.',
        mergeRationale: original.mergeRationale,
      },
      consolidationNote: '   ',
      declinedToConsolidate: false,
      declineReason: null,
    };
    const result = parseConsolidationResponse(JSON.stringify(payload), original);
    expect(isRejection(result)).toBe(true);
    if (isRejection(result)) {
      expect(result.reason).toBe('note_missing_or_invalid');
    }
  });

  test('parseConsolidationResponse rejects non-boolean declinedToConsolidate', () => {
    const original = makeOriginal();
    const payload = {
      consolidatedMerge: {
        name: original.name,
        description: original.description,
        definition: original.definition,
        instructions: 'Some instructions.',
        mergeRationale: original.mergeRationale,
      },
      consolidationNote: 'A note.',
      declinedToConsolidate: 'no',
      declineReason: null,
    };
    const result = parseConsolidationResponse(JSON.stringify(payload), original);
    expect(isRejection(result)).toBe(true);
    if (isRejection(result)) {
      expect(result.reason).toBe('declined_not_boolean');
    }
  });

  test('parseConsolidationResponse rejects declinedToConsolidate=true with null declineReason', () => {
    const original = makeOriginal();
    const payload = {
      consolidatedMerge: {
        name: original.name,
        description: original.description,
        definition: original.definition,
        instructions: 'Some instructions.',
        mergeRationale: original.mergeRationale,
      },
      consolidationNote: 'A note.',
      declinedToConsolidate: true,
      declineReason: null,
    };
    const result = parseConsolidationResponse(JSON.stringify(payload), original);
    expect(isRejection(result)).toBe(true);
    if (isRejection(result)) {
      expect(result.reason).toBe('decline_reason_missing');
    }
  });

  test('parseConsolidationResponse accepts valid declinedToConsolidate=true with non-empty declineReason', () => {
    const original = makeOriginal();
    const payload = {
      consolidatedMerge: {
        name: original.name,
        description: original.description,
        definition: original.definition,
        instructions: original.instructions,
        mergeRationale: original.mergeRationale,
      },
      consolidationNote: 'Cannot shorten without losing capability.',
      declinedToConsolidate: true,
      declineReason: 'Every section contains a unique HITL gate phrase.',
    };
    const result = parseConsolidationResponse(JSON.stringify(payload), original);
    expect(isRejection(result)).toBe(false);
    if (!isRejection(result)) {
      expect(result.declinedToConsolidate).toBe(true);
      expect(result.declineReason).toBe('Every section contains a unique HITL gate phrase.');
    }
  });

  test('parseConsolidationResponse accepts valid succeeded response', () => {
    const original = makeOriginal();
    const payload = {
      consolidatedMerge: {
        name: original.name,
        description: original.description,
        definition: original.definition,
        instructions: 'Shorter consolidated instructions.',
        mergeRationale: original.mergeRationale,
      },
      consolidationNote: 'Removed duplicate examples section.',
      declinedToConsolidate: false,
      declineReason: null,
    };
    const result = parseConsolidationResponse(JSON.stringify(payload), original);
    expect(isRejection(result)).toBe(false);
    if (!isRejection(result)) {
      expect(result.consolidatedMerge.instructions).toBe('Shorter consolidated instructions.');
      expect(result.consolidationNote).toBe('Removed duplicate examples section.');
      expect(result.declinedToConsolidate).toBe(false);
      expect(result.declineReason).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// extractPreservationInventory
// ---------------------------------------------------------------------------

describe('extractPreservationInventory', () => {
  test('extractPreservationInventory captures every backtick-wrapped identifier in tier1', () => {
    const merged = makeOriginal({
      instructions: 'Use `tool-alpha`, `skill-beta`, and `helper_gamma` together.',
    });
    const { tier1 } = extractPreservationInventory(merged);
    const toolRefs = tier1.filter(i => i.kind === 'tool_ref').map(i => i.value);
    expect(toolRefs).toContain('tool-alpha');
    expect(toolRefs).toContain('skill-beta');
    expect(toolRefs).toContain('helper_gamma');
  });

  test('extractPreservationInventory captures invocation block in tier1', () => {
    const merged = makeOriginal({
      instructions: 'Invoke this skill when the user asks about reports.\n\nThen do the main work.',
    });
    const { tier1 } = extractPreservationInventory(merged);
    const blocks = tier1.filter(i => i.kind === 'invocation_block');
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0].value).toContain('Invoke this skill');
  });

  test('extractPreservationInventory captures HITL phrases in tier1', () => {
    const merged = makeOriginal({
      instructions: 'Do not post without approval. Human approval required before sending.',
    });
    const { tier1 } = extractPreservationInventory(merged);
    const hitlPhrases = tier1.filter(i => i.kind === 'hitl_phrase').map(i => i.value);
    expect(hitlPhrases).toContain('do not post without approval');
    expect(hitlPhrases).toContain('human approval required');
  });

  test('extractPreservationInventory does NOT promote tier-2 phrase variants into tier1', () => {
    // "requires human approval" is tier-2 only (not in the tier-1 phrase set)
    const merged = makeOriginal({
      instructions: 'This action requires human approval before execution.',
    });
    const { tier1, tier2 } = extractPreservationInventory(merged);
    const tier1Phrases = tier1.filter(i => i.kind === 'hitl_phrase').map(i => i.value);
    const tier2Phrases = tier2.filter(i => i.kind === 'hitl_phrase').map(i => i.value);

    expect(tier1Phrases).not.toContain('requires human approval');
    expect(tier2Phrases).toContain('requires human approval');
  });
});
