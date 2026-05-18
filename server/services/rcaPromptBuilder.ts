// ---------------------------------------------------------------------------
// rcaPromptBuilder — builds the RCA system + user prompt from the 6-input
// context bundle. All functions are pure (no I/O).
//
// Closed-Loop Skill Improvement spec §9.1 step 5–6 (Chunk 3).
//
// Determinism contract: buildRcaPrompt produces the same output for identical
// inputs — whitespace-stable so consecutive identical calls get a cache hit.
// ---------------------------------------------------------------------------

import type { AmendmentStackFromSnapshot } from '../jobs/failurePostMortemJobPure.js';

export interface RcaContextBundle {
  runTranscript: string;
  rubricSnapshot: { name: string; checkName: string; checkDesc: string };
  failedCheckReasoning: string;
  entityRecord: { entityType: string; entityId: string; snapshot: Record<string, unknown> };
  recentOperatorCorrections: ReadonlyArray<{ at: Date; summary: string }>;
  amendmentStack: AmendmentStackFromSnapshot;
}

export interface RcaProposerOutput {
  recordId: string;
  failureMode: string;
  contributingFactors: string[];
  proposedRemedyKind:
    | 'instruction_extension'
    | 'example'
    | 'guardrail'
    | 'context_fact'
    | 'exception'
    | 'no_remedy_proposed';
  proposedRemedyBody?: string;
  confidence: number;
}

const VALID_REMEDY_KINDS = new Set([
  'instruction_extension',
  'example',
  'guardrail',
  'context_fact',
  'exception',
  'no_remedy_proposed',
]);

/**
 * Validate a raw LLM response against the RcaProposerOutput schema.
 * Returns { ok: true, value } or { ok: false, errors }.
 */
export function validateRcaProposerOutput(
  raw: unknown,
): { ok: true; value: RcaProposerOutput } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ['response must be a JSON object'] };
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.recordId !== 'string' || obj.recordId.length === 0) {
    errors.push('recordId must be a non-empty string');
  }
  if (typeof obj.failureMode !== 'string' || obj.failureMode.length === 0) {
    errors.push('failureMode must be a non-empty string');
  }
  if (!Array.isArray(obj.contributingFactors)) {
    errors.push('contributingFactors must be an array');
  } else {
    if (obj.contributingFactors.length < 1 || obj.contributingFactors.length > 5) {
      errors.push('contributingFactors must have 1 to 5 elements');
    }
    if (!obj.contributingFactors.every((f: unknown) => typeof f === 'string')) {
      errors.push('contributingFactors elements must all be strings');
    }
  }
  if (
    typeof obj.proposedRemedyKind !== 'string' ||
    !VALID_REMEDY_KINDS.has(obj.proposedRemedyKind)
  ) {
    errors.push(
      `proposedRemedyKind must be one of: ${[...VALID_REMEDY_KINDS].join(', ')}`,
    );
  }
  if (
    typeof obj.proposedRemedyKind === 'string' &&
    obj.proposedRemedyKind === 'no_remedy_proposed' &&
    obj.proposedRemedyBody !== undefined
  ) {
    errors.push('proposedRemedyBody must be absent when proposedRemedyKind is no_remedy_proposed');
  }
  if (
    typeof obj.proposedRemedyKind === 'string' &&
    obj.proposedRemedyKind !== 'no_remedy_proposed' &&
    (typeof obj.proposedRemedyBody !== 'string' || obj.proposedRemedyBody.length === 0)
  ) {
    errors.push('proposedRemedyBody must be a non-empty string when proposedRemedyKind is not no_remedy_proposed');
  }
  if (typeof obj.confidence !== 'number' || obj.confidence < 0 || obj.confidence > 1) {
    errors.push('confidence must be a number in [0.0, 1.0]');
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      recordId: obj.recordId as string,
      failureMode: obj.failureMode as string,
      contributingFactors: obj.contributingFactors as string[],
      proposedRemedyKind: obj.proposedRemedyKind as RcaProposerOutput['proposedRemedyKind'],
      proposedRemedyBody:
        typeof obj.proposedRemedyBody === 'string' ? obj.proposedRemedyBody : undefined,
      confidence: obj.confidence as number,
    },
  };
}

/**
 * Build the RCA system and user prompts from the 6-input context bundle.
 * Output is deterministic for identical inputs (whitespace-stable).
 */
export function buildRcaPrompt(bundle: RcaContextBundle): { system: string; user: string } {
  const system = `You are an expert root cause analyst for an AI agent quality assurance system. Your task is to analyse a failed quality check on an agent run and propose a targeted skill instruction amendment that would prevent this failure in future runs.

You will be given:
1. The agent run transcript
2. The rubric (scorecard name, check name, check description)
3. The judge's reasoning for why the check failed
4. The entity the agent was working with
5. Recent operator corrections on this skill
6. The amendment stack that was active during the run

Respond with a single JSON object matching this schema exactly:
{
  "recordId": "<generate a UUID v4>",
  "failureMode": "<one sentence describing the root cause>",
  "contributingFactors": ["<factor 1>", ..., "<up to 5 factors>"],
  "proposedRemedyKind": "<one of: instruction_extension | example | guardrail | context_fact | exception | no_remedy_proposed>",
  "proposedRemedyBody": "<the proposed amendment text — omit this field entirely if proposedRemedyKind is no_remedy_proposed>",
  "confidence": <float 0.0..1.0>
}

Rules:
- proposedRemedyBody must be absent (not null, not empty string) when proposedRemedyKind is no_remedy_proposed.
- contributingFactors must have 1 to 5 elements.
- confidence reflects how certain you are that the proposed remedy addresses the root cause.
- Respond with only the JSON object, no preamble or explanation.`;

  const correctionsBlock =
    bundle.recentOperatorCorrections.length === 0
      ? '(none in the last 30 days)'
      : bundle.recentOperatorCorrections
          .map(
            (c, i) =>
              `[${i + 1}] ${c.at.toISOString().slice(0, 10)}: ${c.summary}`,
          )
          .join('\n');

  const amendmentStackBlock =
    bundle.amendmentStack.included.length === 0
      ? '(no amendments active — base skill only)'
      : `Included amendments: ${bundle.amendmentStack.included.join(', ')}\nExcluded amendments: ${bundle.amendmentStack.excluded.join(', ')}\nResolver version: ${bundle.amendmentStack.resolverVersion}`;

  const user = `## Scorecard
Name: ${bundle.rubricSnapshot.name}
Check: ${bundle.rubricSnapshot.checkName}
Description: ${bundle.rubricSnapshot.checkDesc}

## Judge reasoning (why the check failed)
${bundle.failedCheckReasoning}

## Entity context
Type: ${bundle.entityRecord.entityType}
ID: ${bundle.entityRecord.entityId}
Snapshot: ${JSON.stringify(bundle.entityRecord.snapshot)}

## Amendment stack active during this run
${amendmentStackBlock}

## Recent operator corrections on this skill (last 30 days)
${correctionsBlock}

## Agent run transcript
${bundle.runTranscript}`;

  return { system, user };
}
