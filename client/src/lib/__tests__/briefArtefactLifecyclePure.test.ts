/**
 * briefArtefactLifecyclePure.test.ts
 *
 * Pure-function tests for the client-side artefact lifecycle resolver.
 * Run via: npx tsx client/src/lib/__tests__/briefArtefactLifecyclePure.test.ts
 */

import { resolveLifecyclePure } from '../briefArtefactLifecyclePure.js';
import type { BriefChatArtefact } from '../../../../shared/types/briefResultContract.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
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

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function makeStructured(id: string, parentId?: string): BriefChatArtefact {
  return {
    kind: 'structured',
    artefactId: id,
    parentArtefactId: parentId,
    summary: `Result ${id}`,
    entityType: 'contacts',
    filtersApplied: [],
    rows: [],
    rowCount: 0,
    truncated: false,
    suggestions: [],
    costCents: 1,
    source: 'canonical',
    status: parentId ? 'updated' : 'final',
  } as BriefChatArtefact;
}

function makeApproval(id: string, parentId?: string): BriefChatArtefact {
  return {
    kind: 'approval',
    artefactId: id,
    parentArtefactId: parentId,
    summary: `Approval ${id}`,
    actionSlug: 'crm.send_email',
    actionArgs: {},
    affectedRecordIds: [],
    riskLevel: 'low',
  } as BriefChatArtefact;
}

// ── Empty state ───────────────────────────────────────────────────────────────

test('empty artefacts → empty result', () => {
  const r = resolveLifecyclePure({ artefacts: [] });
  assert(r.chainTips.size === 0, 'no tips');
  assert(r.orphans.length === 0, 'no orphans');
  assert(r.superseded.size === 0, 'no superseded');
});

// ── Single artefact ───────────────────────────────────────────────────────────

test('single artefact is its own tip', () => {
  const A = makeStructured('A');
  const r = resolveLifecyclePure({ artefacts: [A] });
  assert(r.chainTips.size === 1, 'one tip');
  assert(r.chainTips.get('A')?.artefactId === 'A', 'A is tip');
  assert(r.orphans.length === 0, 'no orphans');
});

// ── Linear chain ──────────────────────────────────────────────────────────────

test('linear chain A→B: tip is B, A is superseded', () => {
  const A = makeStructured('A');
  const B = makeStructured('B', 'A');
  const r = resolveLifecyclePure({ artefacts: [A, B] });
  assert(r.chainTips.size === 1, 'one chain');
  assert(r.chainTips.get('A')?.artefactId === 'B', 'B is tip');
  const sup = r.superseded.get('A') ?? [];
  assert(sup.some(x => x.artefactId === 'A'), 'A is superseded');
});

test('three-link chain A→B→C: tip is C', () => {
  const A = makeStructured('A');
  const B = makeStructured('B', 'A');
  const C = makeStructured('C', 'B');
  const r = resolveLifecyclePure({ artefacts: [A, B, C] });
  assert(r.chainTips.get('A')?.artefactId === 'C', 'C is tip');
  const sup = r.superseded.get('A') ?? [];
  assert(sup.length === 2, 'two superseded');
});

// ── Multiple independent chains ───────────────────────────────────────────────

test('two independent chains: two tips', () => {
  const A = makeStructured('A');
  const B = makeStructured('B', 'A');
  const C = makeApproval('C');
  const r = resolveLifecyclePure({ artefacts: [A, B, C] });
  assert(r.chainTips.size === 2, 'two chain tips');
  assert(r.chainTips.get('A')?.artefactId === 'B', 'B is tip of chain A');
  assert(r.chainTips.get('C')?.artefactId === 'C', 'C is its own tip');
});

// ── Orphan handling ───────────────────────────────────────────────────────────

test('orphan: parentArtefactId present but parent absent → orphans list', () => {
  const B = makeStructured('B', 'missing-A');
  const r = resolveLifecyclePure({ artefacts: [B] });
  assert(r.orphans.length === 1, 'one orphan');
  assert(r.orphans[0]!.artefactId === 'B', 'B is orphan');
});

// ── Out-of-order arrival ──────────────────────────────────────────────────────

test('out-of-order: B arrives before its parent A — still resolves correctly once A arrives', () => {
  const A = makeStructured('A');
  const B = makeStructured('B', 'A');
  // Arrival order: B first, A second
  const r = resolveLifecyclePure({ artefacts: [B, A] });
  assert(r.chainTips.get('A')?.artefactId === 'B', 'B is tip after A arrives');
  assert(r.orphans.length === 0, 'no orphans once A present');
});

// ── Status variants do not affect resolution ──────────────────────────────────

test('status pending → updated → final: final is tip', () => {
  const A = { ...makeStructured('A'), status: 'pending' } as BriefChatArtefact;
  const B = { ...makeStructured('B', 'A'), status: 'updated' } as BriefChatArtefact;
  const C = { ...makeStructured('C', 'B'), status: 'final' } as BriefChatArtefact;
  const r = resolveLifecyclePure({ artefacts: [A, B, C] });
  assert(r.chainTips.get('A')?.artefactId === 'C', 'C (final) is tip');
});

// ──────────────────────────────────────────────────────────────────────────────

console.log('');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
