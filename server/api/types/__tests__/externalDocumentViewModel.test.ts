import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { toExternalDocumentViewModel } from '../externalDocumentViewModel.js';

test('active reference with recent fetch maps cleanly', () => {
  const vm = toExternalDocumentViewModel({
    id: 'ref-1',
    externalFileName: 'Q1 plan.gdoc',
    attachmentState: 'active',
    lastFetchEvent: { fetchedAt: new Date('2026-04-30T09:00:00Z'), failureReason: null },
  });
  assert.deepEqual(vm, {
    id: 'ref-1',
    name: 'Q1 plan.gdoc',
    state: 'active',
    lastFetchedAt: '2026-04-30T09:00:00.000Z',
    failureReason: null,
    canRebind: false,
  });
});

test('broken reference exposes canRebind = true and surfaces failureReason', () => {
  const vm = toExternalDocumentViewModel({
    id: 'ref-2',
    externalFileName: 'gone.pdf',
    attachmentState: 'broken',
    lastFetchEvent: { fetchedAt: new Date('2026-04-30T09:00:00Z'), failureReason: 'auth_revoked' },
  });
  assert.equal(vm.state, 'broken');
  assert.equal(vm.canRebind, true);
  assert.equal(vm.failureReason, 'auth_revoked');
});

test('null attachmentState defaults to active; missing name falls back', () => {
  const vm = toExternalDocumentViewModel({
    id: 'ref-3',
    externalFileName: null,
    attachmentState: null,
    lastFetchEvent: null,
  });
  assert.equal(vm.state, 'active');
  assert.equal(vm.name, '(untitled)');
  assert.equal(vm.lastFetchedAt, null);
});

test('failure within staleness window → degraded', () => {
  const vm = toExternalDocumentViewModel({
    id: 'ref-4',
    externalFileName: 'recent fail.gdoc',
    attachmentState: 'active',
    lastFetchEvent: { fetchedAt: new Date('2026-04-30T08:50:00Z'), failureReason: 'rate_limited' },
    now: new Date('2026-04-30T09:00:00Z'),
  });
  assert.equal(vm.state, 'degraded');
});

test('failure beyond staleness window → broken (mapper overrides persisted active)', () => {
  const vm = toExternalDocumentViewModel({
    id: 'ref-5',
    externalFileName: 'old fail.gdoc',
    attachmentState: 'active',
    lastFetchEvent: { fetchedAt: new Date('2026-04-20T09:00:00Z'), failureReason: 'auth_revoked' },
    now: new Date('2026-04-30T09:00:00Z'),
  });
  assert.equal(vm.state, 'broken');
  assert.equal(vm.canRebind, true);
});
