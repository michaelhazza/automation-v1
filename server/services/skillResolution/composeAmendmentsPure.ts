import { createHash } from 'crypto';
import type { ComposeAmendmentsInput, ComposeAmendmentsResult, AmendmentSnapshotRow } from './types.js';
import type { AmendmentKind } from '../../../shared/types/skillAmendments.js';

// Composition size cap (chars) — fail-closed truncation per spec §6.7, §8.1 step 4.
const COMPOSITION_SIZE_LIMIT = 12_000;

// Bucket order: org-tier first, then subaccount-tier; within each tier: guardrails,
// instruction_extensions, examples, context_facts, exceptions (spec §8.1 step 3).
const BUCKET_ORDER: Array<{ subaccount: boolean; kind: AmendmentKind }> = [
  { subaccount: false, kind: 'guardrail' },
  { subaccount: false, kind: 'instruction_extension' },
  { subaccount: false, kind: 'example' },
  { subaccount: false, kind: 'context_fact' },
  { subaccount: false, kind: 'exception' },
  { subaccount: true,  kind: 'guardrail' },
  { subaccount: true,  kind: 'instruction_extension' },
  { subaccount: true,  kind: 'example' },
  { subaccount: true,  kind: 'context_fact' },
  { subaccount: true,  kind: 'exception' },
];

function bucketKey(row: AmendmentSnapshotRow): number {
  const isSubaccount = row.subaccountId !== null;
  const kindIndex = BUCKET_ORDER.findIndex(
    b => b.subaccount === isSubaccount && b.kind === row.kind,
  );
  return kindIndex === -1 ? BUCKET_ORDER.length : kindIndex;
}

function sortAmendments(rows: ReadonlyArray<AmendmentSnapshotRow>): AmendmentSnapshotRow[] {
  return [...rows].sort((a, b) => {
    const bk = bucketKey(a) - bucketKey(b);
    if (bk !== 0) return bk;
    const ta = a.activatedAt.getTime() - b.activatedAt.getTime();
    if (ta !== 0) return ta;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function computeVersionSetHash(rows: ReadonlyArray<AmendmentSnapshotRow>): string {
  const pairs = [...rows]
    .map(r => `${r.id}:${r.versionNumber}`)
    .sort();
  return createHash('sha256').update(pairs.join(','), 'utf8').digest('hex');
}

export function composeAmendmentsPure(input: ComposeAmendmentsInput): ComposeAmendmentsResult {
  const { baseRow, amendments, activeFreeze } = input;

  if (baseRow.isCustom) {
    throw new Error('composeAmendmentsPure: custom skills must be filtered upstream');
  }

  const allIds = amendments.map(a => a.id);
  const hash = computeVersionSetHash(amendments);

  // Active freeze: return base alone with empty sets.
  if (activeFreeze !== null) {
    return {
      composedBody: baseRow.body,
      includedAmendmentIds: [],
      excludedAmendmentIds: [],
      composedSizeChars: baseRow.body.length,
      truncated: false,
      reviewRequiredReason: null,
      amendmentVersionSetHash: hash,
    };
  }

  // No amendments: pass-through.
  if (amendments.length === 0) {
    return {
      composedBody: baseRow.body,
      includedAmendmentIds: [],
      excludedAmendmentIds: [],
      composedSizeChars: baseRow.body.length,
      truncated: false,
      reviewRequiredReason: null,
      amendmentVersionSetHash: hash,
    };
  }

  const sorted = sortAmendments(amendments);
  const parts: string[] = [baseRow.body];
  let size = baseRow.body.length;

  for (const row of sorted) {
    size += row.body.length;
  }

  // Fail-closed truncation: if total would exceed limit, return base alone.
  if (size > COMPOSITION_SIZE_LIMIT) {
    return {
      composedBody: baseRow.body,
      includedAmendmentIds: [],
      excludedAmendmentIds: allIds,
      composedSizeChars: baseRow.body.length,
      truncated: true,
      reviewRequiredReason: 'composition_size_exceeded',
      amendmentVersionSetHash: hash,
    };
  }

  for (const row of sorted) {
    parts.push(row.body);
  }

  const composedBody = parts.join('\n\n');
  return {
    composedBody,
    includedAmendmentIds: sorted.map(r => r.id),
    excludedAmendmentIds: [],
    composedSizeChars: composedBody.length,
    truncated: false,
    reviewRequiredReason: null,
    amendmentVersionSetHash: hash,
  };
}
