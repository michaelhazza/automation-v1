import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  mergeAndOrderReferences,
  enforceRunBudget,
  applyFailurePolicy,
  smallDocumentFragmentationWarning,
  type MergedReference,
  type ResolvedDocumentLite,
} from '../runContextLoaderPure.js';

test('mergeAndOrderReferences — sorts by attachment_order ascending across both sources', () => {
  const refs: MergedReference[] = [
    { kind: 'reference_document', id: 'a', attachmentOrder: 3, createdAt: '2026-04-01T00:00:00Z' },
    { kind: 'agent_data_source',  id: 'b', attachmentOrder: 1, createdAt: '2026-04-02T00:00:00Z' },
    { kind: 'reference_document', id: 'c', attachmentOrder: 2, createdAt: '2026-04-03T00:00:00Z' },
  ];
  const sorted = mergeAndOrderReferences(refs);
  assert.deepEqual(sorted.map(r => r.id), ['b', 'c', 'a']);
});

test('mergeAndOrderReferences — sub-sorts duplicates by created_at ascending', () => {
  const refs: MergedReference[] = [
    { kind: 'reference_document', id: 'a', attachmentOrder: 1, createdAt: '2026-04-02T00:00:00Z' },
    { kind: 'reference_document', id: 'b', attachmentOrder: 1, createdAt: '2026-04-01T00:00:00Z' },
  ];
  assert.deepEqual(mergeAndOrderReferences(refs).map(r => r.id), ['b', 'a']);
});

test('enforceRunBudget — stops at first reference that would exceed budget', () => {
  const resolved: ResolvedDocumentLite[] = [
    { id: 'a', tokensUsed: 1000, failureReason: null },
    { id: 'b', tokensUsed: 1500, failureReason: null },
    { id: 'c', tokensUsed:  500, failureReason: null },
  ];
  const result = enforceRunBudget(resolved, 2000);
  assert.deepEqual(result.included.map(r => r.id), ['a']);
  assert.deepEqual(result.skipped.map(s => ({ id: s.id, reason: s.reason })), [
    { id: 'b', reason: 'budget_exceeded' },
    { id: 'c', reason: 'budget_exceeded' },
  ]);
});

test('enforceRunBudget — failure_reason references do not consume budget', () => {
  const resolved: ResolvedDocumentLite[] = [
    { id: 'a', tokensUsed: 0, failureReason: 'auth_revoked' },
    { id: 'b', tokensUsed: 1500, failureReason: null },
  ];
  const result = enforceRunBudget(resolved, 2000);
  assert.deepEqual(result.included.map(r => r.id), ['b']);
});

test('applyFailurePolicy — strict blocks run on degraded', () => {
  const result = applyFailurePolicy('strict', { state: 'degraded' });
  assert.equal(result.action, 'block_run');
});

test('applyFailurePolicy — strict blocks run on broken', () => {
  assert.equal(applyFailurePolicy('strict', { state: 'broken' }).action, 'block_run');
});

test('applyFailurePolicy — tolerant serves stale on degraded, blocks on broken', () => {
  assert.equal(applyFailurePolicy('tolerant', { state: 'degraded' }).action, 'serve_stale_with_warning');
  assert.equal(applyFailurePolicy('tolerant', { state: 'broken' }).action, 'block_run');
});

test('applyFailurePolicy — best_effort serves stale silently on degraded, skips on broken', () => {
  assert.equal(applyFailurePolicy('best_effort', { state: 'degraded' }).action, 'serve_stale_silent');
  assert.equal(applyFailurePolicy('best_effort', { state: 'broken' }).action, 'skip_reference');
});

test('smallDocumentFragmentationWarning — fires when >50% are small', () => {
  const small = Array.from({ length: 4 }, (_, i) => ({ id: `s${i}`, tokensUsed: 100, failureReason: null as null }));
  const large = Array.from({ length: 3 }, (_, i) => ({ id: `l${i}`, tokensUsed: 1000, failureReason: null as null }));
  assert.equal(smallDocumentFragmentationWarning([...small, ...large])?.fragmentedCount, 4);
});

test('smallDocumentFragmentationWarning — null when <=50% are small', () => {
  const docs: ResolvedDocumentLite[] = [
    { id: 'a', tokensUsed: 100, failureReason: null },
    { id: 'b', tokensUsed: 1000, failureReason: null },
    { id: 'c', tokensUsed: 1000, failureReason: null },
  ];
  assert.equal(smallDocumentFragmentationWarning(docs), null);
});
