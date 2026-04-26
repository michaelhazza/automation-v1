import { strict as assert } from 'node:assert';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { logger } from '../logger.js';
import {
  _resetWarnedKeysForTesting,
  logDataDependencyMissing,
} from '../derivedDataMissingLog.js';

// ---------------------------------------------------------------------------
// H1 derived-data null-safety helper — Pattern B contract.
// First emit per (service, field, orgId) key is WARN; subsequent emits drop
// to DEBUG. Spec §H1 Approach steps 3 + 5 require coverage of both the
// first-occurrence WARN AND the repeat-DEBUG path so the rate-limiting
// contract is exercised.
//
// Spies the logger object directly (via node:test `mock.method`) instead of
// patching console.* — the helper's contract is "calls logger.warn / logger.debug",
// not "calls console.warn / console.log". The latter is an implementation detail
// of the logger module and is filtered by `LOG_LEVEL` (resolved once at module
// import time), which would silently turn DEBUG-path tests into false PASSes
// when the runner inherits the default `info` level.
// ---------------------------------------------------------------------------

beforeEach(() => {
  mock.method(logger, 'warn', () => {});
  mock.method(logger, 'debug', () => {});
  _resetWarnedKeysForTesting();
});

afterEach(() => {
  mock.restoreAll();
});

test('first emit per key calls logger.warn with the data_dependency_missing event', () => {
  logDataDependencyMissing('documentBundleService', 'utilizationByModelFamily', 'org_a');

  const warnCalls = (logger.warn as unknown as { mock: { calls: { arguments: unknown[] }[] } }).mock.calls;
  const debugCalls = (logger.debug as unknown as { mock: { calls: { arguments: unknown[] }[] } }).mock.calls;

  assert.equal(warnCalls.length, 1);
  assert.equal(debugCalls.length, 0);
  assert.deepEqual(warnCalls[0].arguments, [
    'data_dependency_missing',
    { service: 'documentBundleService', field: 'utilizationByModelFamily', orgId: 'org_a' },
  ]);
});

test('repeat emit for the same key calls logger.debug with repeated=true (not logger.warn)', () => {
  logDataDependencyMissing('documentBundleService', 'utilizationByModelFamily', 'org_a');
  logDataDependencyMissing('documentBundleService', 'utilizationByModelFamily', 'org_a');

  const warnCalls = (logger.warn as unknown as { mock: { calls: { arguments: unknown[] }[] } }).mock.calls;
  const debugCalls = (logger.debug as unknown as { mock: { calls: { arguments: unknown[] }[] } }).mock.calls;

  assert.equal(warnCalls.length, 1, 'WARN fires only on the first call');
  assert.equal(debugCalls.length, 1, 'DEBUG fires on the repeat');
  assert.deepEqual(debugCalls[0].arguments, [
    'data_dependency_missing',
    {
      service: 'documentBundleService',
      field:   'utilizationByModelFamily',
      orgId:   'org_a',
      repeated: true,
    },
  ]);
});

test('different orgIds for the same field both emit WARN (key includes orgId)', () => {
  logDataDependencyMissing('documentBundleService', 'utilizationByModelFamily', 'org_a');
  logDataDependencyMissing('documentBundleService', 'utilizationByModelFamily', 'org_b');

  const warnCalls = (logger.warn as unknown as { mock: { calls: { arguments: unknown[] }[] } }).mock.calls;
  const debugCalls = (logger.debug as unknown as { mock: { calls: { arguments: unknown[] }[] } }).mock.calls;

  assert.equal(warnCalls.length, 2);
  assert.equal(debugCalls.length, 0);
  assert.equal((warnCalls[0].arguments[1] as { orgId: string }).orgId, 'org_a');
  assert.equal((warnCalls[1].arguments[1] as { orgId: string }).orgId, 'org_b');
});

test('different fields for the same orgId both emit WARN (key includes field)', () => {
  logDataDependencyMissing('connectorPollingSync', 'lastSuccessfulSyncAt', 'org_a');
  logDataDependencyMissing('connectorPollingSync', 'lastSyncError', 'org_a');

  const warnCalls = (logger.warn as unknown as { mock: { calls: { arguments: unknown[] }[] } }).mock.calls;
  const debugCalls = (logger.debug as unknown as { mock: { calls: { arguments: unknown[] }[] } }).mock.calls;

  assert.equal(warnCalls.length, 2);
  assert.equal(debugCalls.length, 0);
  assert.equal((warnCalls[0].arguments[1] as { field: string }).field, 'lastSuccessfulSyncAt');
  assert.equal((warnCalls[1].arguments[1] as { field: string }).field, 'lastSyncError');
});

test('different services for the same field+orgId both emit WARN (key includes service)', () => {
  logDataDependencyMissing('serviceA', 'utilizationByModelFamily', 'org_a');
  logDataDependencyMissing('serviceB', 'utilizationByModelFamily', 'org_a');

  const warnCalls = (logger.warn as unknown as { mock: { calls: { arguments: unknown[] }[] } }).mock.calls;

  assert.equal(warnCalls.length, 2);
  assert.equal((warnCalls[0].arguments[1] as { service: string }).service, 'serviceA');
  assert.equal((warnCalls[1].arguments[1] as { service: string }).service, 'serviceB');
});

test('_resetWarnedKeysForTesting clears state so the next call is WARN again', () => {
  logDataDependencyMissing('documentBundleService', 'utilizationByModelFamily', 'org_a');
  logDataDependencyMissing('documentBundleService', 'utilizationByModelFamily', 'org_a');

  const warnCallsBefore = (logger.warn as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
  const debugCallsBefore = (logger.debug as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
  assert.equal(warnCallsBefore, 1);
  assert.equal(debugCallsBefore, 1);

  _resetWarnedKeysForTesting();

  logDataDependencyMissing('documentBundleService', 'utilizationByModelFamily', 'org_a');

  const warnCallsAfter = (logger.warn as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
  const debugCallsAfter = (logger.debug as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
  assert.equal(warnCallsAfter, 2, 'first call after reset is WARN');
  assert.equal(debugCallsAfter, 1, 'no extra DEBUG after reset');
});
