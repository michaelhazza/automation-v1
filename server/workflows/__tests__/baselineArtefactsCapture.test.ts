/**
 * baselineArtefactsCapture.test.ts — pure-logic tests for the
 * baseline-artefacts-capture workflow and its related schema guards.
 *
 * No DB connection required.
 *
 * Runnable via:
 *   npx vitest run server/workflows/__tests__/baselineArtefactsCapture.test.ts
 *
 * Spec: docs/sub-account-baseline-artefacts-spec.md §5, §6b.
 */

import { test, expect } from 'vitest';
import { isWizardCompletable } from '../../../shared/schemas/subaccount.js';
import type { BaselineArtefactsStatus } from '../../../shared/schemas/subaccount.js';
import workflow from '../baseline-artefacts-capture.workflow.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStatus(overrides: {
  brandIdentity?: string;
  voiceTone?: string;
  offerPositioning?: string;
  audienceIcp?: string;
  operatingConstraints?: string;
  proofLibrary?: string;
} = {}): BaselineArtefactsStatus {
  const {
    brandIdentity = 'completed',
    voiceTone = 'completed',
    offerPositioning = 'completed',
    audienceIcp = 'completed',
    operatingConstraints = 'not_started',
    proofLibrary = 'not_started',
  } = overrides;
  return {
    version: 1,
    tier1: {
      brand_identity: { status: brandIdentity as never, captured_at: brandIdentity === 'completed' ? new Date().toISOString() : null, skipped_at: null, memory_block_id: null, captured_by_user_id: null },
      voice_tone: { status: voiceTone as never, captured_at: voiceTone === 'completed' ? new Date().toISOString() : null, skipped_at: null, memory_block_id: null, captured_by_user_id: null },
    },
    tier2: {
      offer_positioning: { status: offerPositioning as never, captured_at: offerPositioning === 'completed' ? new Date().toISOString() : null, skipped_at: null, memory_block_id: null, captured_by_user_id: null },
      audience_icp: { status: audienceIcp as never, captured_at: audienceIcp === 'completed' ? new Date().toISOString() : null, skipped_at: null, memory_block_id: null, captured_by_user_id: null },
    },
    tier3: {
      operating_constraints: { status: operatingConstraints as never, captured_at: null, skipped_at: null, workspace_memory_id: null, captured_by_user_id: null },
      proof_library: { status: proofLibrary as never, captured_at: null, skipped_at: null, workspace_memory_id: null, captured_by_user_id: null },
    },
  };
}

// ── isWizardCompletable ───────────────────────────────────────────────────────

test('isWizardCompletable returns false when tier1.brand_identity is in_progress', () => {
  const status = makeStatus({ brandIdentity: 'in_progress' });
  expect(isWizardCompletable(status)).toBe(false);
});

test('isWizardCompletable returns false when tier1.voice_tone is in_progress', () => {
  const status = makeStatus({ voiceTone: 'in_progress' });
  expect(isWizardCompletable(status)).toBe(false);
});

test('isWizardCompletable returns false when any tier1+2 is not_started', () => {
  const status = makeStatus({ offerPositioning: 'not_started' });
  expect(isWizardCompletable(status)).toBe(false);
});

test('isWizardCompletable returns true when all tier1+2 completed and tier3 is not_started', () => {
  const status = makeStatus({
    operatingConstraints: 'not_started',
    proofLibrary: 'not_started',
  });
  expect(isWizardCompletable(status)).toBe(true);
});

test('isWizardCompletable returns true when all tier1+2 completed and tier3 is skipped', () => {
  const status = makeStatus({
    operatingConstraints: 'skipped',
    proofLibrary: 'skipped',
  });
  expect(isWizardCompletable(status)).toBe(true);
});

// ── Workflow definition structure ─────────────────────────────────────────────

test('workflow has slug baseline-artefacts-capture', () => {
  expect(workflow.slug).toBe('baseline-artefacts-capture');
});

test('workflow has autoStartOnOnboarding: true', () => {
  expect(workflow.autoStartOnOnboarding).toBe(true);
});

test('workflow has exactly 6 steps', () => {
  expect(workflow.steps).toHaveLength(6);
});

test('workflow step ids match the expected baseline artefact short names', () => {
  const expectedIds = [
    'brand_identity',
    'voice_tone',
    'offer_positioning',
    'audience_icp',
    'operating_constraints',
    'proof_library',
  ];
  const actualIds = workflow.steps.map((s) => s.id);
  expect(actualIds).toEqual(expectedIds);
});

test('knowledgeBindings has exactly 4 entries (tier1+2 only)', () => {
  expect(workflow.knowledgeBindings).toHaveLength(4);
});

test('knowledgeBindings covers only tier1+2 slugs', () => {
  const boundLabels = (workflow.knowledgeBindings ?? []).map((b) => b.blockLabel);
  expect(boundLabels).toEqual([
    'baseline.brand_identity',
    'baseline.voice_tone',
    'baseline.offer_positioning',
    'baseline.audience_icp',
  ]);
});

// ── getBaselineVoiceTone pure parsing logic ───────────────────────────────────
// Tests the inline shape-validation logic without a DB connection.

function parseVoiceToneContent(content: string): {
  descriptors: string[];
  example_sentences: string[];
  prohibited_phrases: string[];
  formality_level: 'casual' | 'neutral' | 'formal';
} | null {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (
      !Array.isArray(parsed.descriptors) ||
      !Array.isArray(parsed.example_sentences) ||
      !Array.isArray(parsed.prohibited_phrases) ||
      (parsed.formality_level !== 'casual' && parsed.formality_level !== 'neutral' && parsed.formality_level !== 'formal')
    ) return null;
    return {
      descriptors: parsed.descriptors as string[],
      example_sentences: parsed.example_sentences as string[],
      prohibited_phrases: parsed.prohibited_phrases as string[],
      formality_level: parsed.formality_level as 'casual' | 'neutral' | 'formal',
    };
  } catch {
    return null;
  }
}

test('voice tone parser returns null for invalid JSON', () => {
  expect(parseVoiceToneContent('not-json')).toBeNull();
});

test('voice tone parser returns null when descriptors missing', () => {
  const content = JSON.stringify({
    example_sentences: ['hi'],
    prohibited_phrases: [],
    formality_level: 'neutral',
  });
  expect(parseVoiceToneContent(content)).toBeNull();
});

test('voice tone parser returns null when formality_level is invalid', () => {
  const content = JSON.stringify({
    descriptors: ['friendly'],
    example_sentences: ['hi'],
    prohibited_phrases: [],
    formality_level: 'very_formal',
  });
  expect(parseVoiceToneContent(content)).toBeNull();
});

test('voice tone parser returns parsed shape for valid content', () => {
  const content = JSON.stringify({
    descriptors: ['friendly', 'clear'],
    example_sentences: ['We help you grow.', 'No jargon here.'],
    prohibited_phrases: ['synergy'],
    formality_level: 'neutral',
  });
  const result = parseVoiceToneContent(content);
  expect(result).not.toBeNull();
  expect(result?.formality_level).toBe('neutral');
  expect(result?.descriptors).toEqual(['friendly', 'clear']);
  expect(result?.prohibited_phrases).toEqual(['synergy']);
});

test('voice tone parser accepts all three valid formality levels', () => {
  for (const level of ['casual', 'neutral', 'formal'] as const) {
    const content = JSON.stringify({
      descriptors: ['x'],
      example_sentences: ['y'],
      prohibited_phrases: [],
      formality_level: level,
    });
    const result = parseVoiceToneContent(content);
    expect(result?.formality_level).toBe(level);
  }
});
