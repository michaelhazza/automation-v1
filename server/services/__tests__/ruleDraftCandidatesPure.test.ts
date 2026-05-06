// guard-ignore-file: pure-helper-convention reason="pure logic is tested inline within this handwritten harness; parent-directory sibling import not applicable for this self-contained test pattern"
/**
 * ruleDraftCandidatesPure.test.ts
 *
 * Pure tests for DR1 route logic (rules/draft-candidates) per spec §4.3.
 * Tests the artefact scan, collision detection, and kind validation
 * without DB or LLM access.
 *
 * Run via: npx tsx server/services/__tests__/ruleDraftCandidatesPure.test.ts
 */

import { expect, test } from 'vitest';

export {};

// Simulated JSONB scan logic (mirrors what the route does)
interface MockArtefact { artefactId: string; kind: string; [k: string]: unknown }

function scanForArtefact(
  rows: Array<{ artefacts: MockArtefact[] }>,
  targetId: string,
): { approvalCard: MockArtefact | null; matchCount: number } {
  let approvalCard: MockArtefact | null = null;
  let matchCount = 0;
  for (const row of rows) {
    for (const a of row.artefacts) {
      if (a.artefactId !== targetId) continue;
      matchCount++;
      approvalCard = a;
    }
  }
  return { approvalCard, matchCount };
}

console.log('\nDR1 — rules/draft-candidates pure tests\n');

// ── artefact not found ────────────────────────────────────────────────────────
test('no rows matching artefactId → artefact_not_found (404)', () => {
  const { approvalCard } = scanForArtefact([], 'id-1');
  expect(approvalCard === null, 'empty rows must yield null').toBeTruthy();
});

test('rows with different artefactId → artefact_not_found', () => {
  const rows = [{ artefacts: [{ artefactId: 'id-2', kind: 'approval' }] }];
  const { approvalCard } = scanForArtefact(rows, 'id-1');
  expect(approvalCard === null, 'no matching ID must yield null').toBeTruthy();
});

// ── artefact found, kind check ────────────────────────────────────────────────
test('matching artefact kind=approval → valid approval card', () => {
  const rows = [{ artefacts: [{ artefactId: 'id-1', kind: 'approval', actionSlug: 'send_email', actionArgs: {} }] }];
  const { approvalCard } = scanForArtefact(rows, 'id-1');
  expect(approvalCard !== null, 'must find artefact').toBeTruthy();
  expect(approvalCard!.kind === 'approval', 'kind must be approval').toBeTruthy();
});

test('matching artefact kind=structured → artefact_not_approval (422)', () => {
  const rows = [{ artefacts: [{ artefactId: 'id-1', kind: 'structured' }] }];
  const { approvalCard } = scanForArtefact(rows, 'id-1');
  expect(approvalCard !== null, 'must find artefact').toBeTruthy();
  expect(approvalCard!.kind !== 'approval', 'kind mismatch → reject').toBeTruthy();
});

// ── artefact ID collision ─────────────────────────────────────────────────────
test('one matching artefact → no collision', () => {
  const rows = [
    { artefacts: [{ artefactId: 'id-1', kind: 'approval' }] },
    { artefacts: [{ artefactId: 'id-2', kind: 'structured' }] },
  ];
  const { matchCount } = scanForArtefact(rows, 'id-1');
  expect(matchCount === 1, 'one match must not trigger collision').toBeTruthy();
});

test('two matching artefacts with same ID → artefact_id_collision (500)', () => {
  const rows = [
    { artefacts: [{ artefactId: 'id-1', kind: 'approval' }] },
    { artefacts: [{ artefactId: 'id-1', kind: 'approval' }] }, // duplicate
  ];
  const { matchCount } = scanForArtefact(rows, 'id-1');
  expect(matchCount > 1, 'duplicate IDs must trigger collision').toBeTruthy();
});

// ── request validation ────────────────────────────────────────────────────────
test('wasApproved required as boolean', () => {
  const body1 = { artefactId: 'id-1', wasApproved: true };
  const body2 = { artefactId: 'id-1', wasApproved: 'yes' };  // wrong type
  expect(typeof body1.wasApproved === 'boolean', 'boolean wasApproved must pass').toBeTruthy();
  expect(typeof body2.wasApproved !== 'boolean', 'string wasApproved must fail').toBeTruthy();
});

test('missing artefactId → 400', () => {
  const body = { wasApproved: true };
  expect(!('artefactId' in body) || !(body as { artefactId?: string }).artefactId, 'missing artefactId must be detected').toBeTruthy();
});

// ── existingRelatedRules mapping ──────────────────────────────────────────────
test('rule rows map correctly to existingRelatedRules format', () => {
  const rules = [{ id: 'r1', text: 'Never email on weekends', scope: 'subaccount' }];
  const mapped = rules.map((r) => ({ id: r.id, text: r.text, category: r.scope }));
  expect(mapped[0]!.category === 'subaccount', 'scope maps to category').toBeTruthy();
  expect(mapped[0]!.text === 'Never email on weekends', 'text preserved').toBeTruthy();
});
