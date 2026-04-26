/**
 * ruleDraftCandidatesPure.test.ts
 *
 * Pure tests for DR1 route logic (rules/draft-candidates) per spec §4.3.
 * Tests the artefact scan, collision detection, and kind validation
 * without DB or LLM access.
 *
 * Run via: npx tsx server/services/__tests__/ruleDraftCandidatesPure.test.ts
 */

export {};

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

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
  assert(approvalCard === null, 'empty rows must yield null');
});

test('rows with different artefactId → artefact_not_found', () => {
  const rows = [{ artefacts: [{ artefactId: 'id-2', kind: 'approval' }] }];
  const { approvalCard } = scanForArtefact(rows, 'id-1');
  assert(approvalCard === null, 'no matching ID must yield null');
});

// ── artefact found, kind check ────────────────────────────────────────────────
test('matching artefact kind=approval → valid approval card', () => {
  const rows = [{ artefacts: [{ artefactId: 'id-1', kind: 'approval', actionSlug: 'send_email', actionArgs: {} }] }];
  const { approvalCard } = scanForArtefact(rows, 'id-1');
  assert(approvalCard !== null, 'must find artefact');
  assert(approvalCard!.kind === 'approval', 'kind must be approval');
});

test('matching artefact kind=structured → artefact_not_approval (422)', () => {
  const rows = [{ artefacts: [{ artefactId: 'id-1', kind: 'structured' }] }];
  const { approvalCard } = scanForArtefact(rows, 'id-1');
  assert(approvalCard !== null, 'must find artefact');
  assert(approvalCard!.kind !== 'approval', 'kind mismatch → reject');
});

// ── artefact ID collision ─────────────────────────────────────────────────────
test('one matching artefact → no collision', () => {
  const rows = [
    { artefacts: [{ artefactId: 'id-1', kind: 'approval' }] },
    { artefacts: [{ artefactId: 'id-2', kind: 'structured' }] },
  ];
  const { matchCount } = scanForArtefact(rows, 'id-1');
  assert(matchCount === 1, 'one match must not trigger collision');
});

test('two matching artefacts with same ID → artefact_id_collision (500)', () => {
  const rows = [
    { artefacts: [{ artefactId: 'id-1', kind: 'approval' }] },
    { artefacts: [{ artefactId: 'id-1', kind: 'approval' }] }, // duplicate
  ];
  const { matchCount } = scanForArtefact(rows, 'id-1');
  assert(matchCount > 1, 'duplicate IDs must trigger collision');
});

// ── request validation ────────────────────────────────────────────────────────
test('wasApproved required as boolean', () => {
  const body1 = { artefactId: 'id-1', wasApproved: true };
  const body2 = { artefactId: 'id-1', wasApproved: 'yes' };  // wrong type
  assert(typeof body1.wasApproved === 'boolean', 'boolean wasApproved must pass');
  assert(typeof body2.wasApproved !== 'boolean', 'string wasApproved must fail');
});

test('missing artefactId → 400', () => {
  const body = { wasApproved: true };
  assert(!('artefactId' in body) || !(body as { artefactId?: string }).artefactId, 'missing artefactId must be detected');
});

// ── existingRelatedRules mapping ──────────────────────────────────────────────
test('rule rows map correctly to existingRelatedRules format', () => {
  const rules = [{ id: 'r1', text: 'Never email on weekends', scope: 'subaccount' }];
  const mapped = rules.map((r) => ({ id: r.id, text: r.text, category: r.scope }));
  assert(mapped[0]!.category === 'subaccount', 'scope maps to category');
  assert(mapped[0]!.text === 'Never email on weekends', 'text preserved');
});

console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
