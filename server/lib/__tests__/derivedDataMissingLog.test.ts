import { afterEach, beforeEach, expect, test, vi } from 'vitest';
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
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'debug').mockImplementation(() => {});
  _resetWarnedKeysForTesting();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('first emit per key calls logger.warn with the data_dependency_missing event', () => {
  logDataDependencyMissing('documentBundleService', 'utilizationByModelFamily', 'org_a');

  const warnCalls = (logger.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  const debugCalls = (logger.debug as unknown as { mock: { calls: unknown[][] } }).mock.calls;

  expect(warnCalls.length).toBe(1);
  expect(debugCalls.length).toBe(0);
  expect(warnCalls[0]).toEqual([
    'data_dependency_missing',
    { service: 'documentBundleService', field: 'utilizationByModelFamily', orgId: 'org_a' },
  ]);
});

test('repeat emit for the same key calls logger.debug with repeated=true (not logger.warn)', () => {
  logDataDependencyMissing('documentBundleService', 'utilizationByModelFamily', 'org_a');
  logDataDependencyMissing('documentBundleService', 'utilizationByModelFamily', 'org_a');

  const warnCalls = (logger.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  const debugCalls = (logger.debug as unknown as { mock: { calls: unknown[][] } }).mock.calls;

  expect(warnCalls.length, 'WARN fires only on the first call').toBe(1);
  expect(debugCalls.length, 'DEBUG fires on the repeat').toBe(1);
  expect(debugCalls[0]).toEqual([
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

  const warnCalls = (logger.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  const debugCalls = (logger.debug as unknown as { mock: { calls: unknown[][] } }).mock.calls;

  expect(warnCalls.length).toBe(2);
  expect(debugCalls.length).toBe(0);
  expect((warnCalls[0][1] as { orgId: string }).orgId).toBe('org_a');
  expect((warnCalls[1][1] as { orgId: string }).orgId).toBe('org_b');
});

test('different fields for the same orgId both emit WARN (key includes field)', () => {
  logDataDependencyMissing('connectorPollingSync', 'lastSuccessfulSyncAt', 'org_a');
  logDataDependencyMissing('connectorPollingSync', 'lastSyncError', 'org_a');

  const warnCalls = (logger.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  const debugCalls = (logger.debug as unknown as { mock: { calls: unknown[][] } }).mock.calls;

  expect(warnCalls.length).toBe(2);
  expect(debugCalls.length).toBe(0);
  expect((warnCalls[0][1] as { field: string }).field).toBe('lastSuccessfulSyncAt');
  expect((warnCalls[1][1] as { field: string }).field).toBe('lastSyncError');
});

test('different services for the same field+orgId both emit WARN (key includes service)', () => {
  logDataDependencyMissing('serviceA', 'utilizationByModelFamily', 'org_a');
  logDataDependencyMissing('serviceB', 'utilizationByModelFamily', 'org_a');

  const warnCalls = (logger.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls;

  expect(warnCalls.length).toBe(2);
  expect((warnCalls[0][1] as { service: string }).service).toBe('serviceA');
  expect((warnCalls[1][1] as { service: string }).service).toBe('serviceB');
});

test('_resetWarnedKeysForTesting clears state so the next call is WARN again', () => {
  logDataDependencyMissing('documentBundleService', 'utilizationByModelFamily', 'org_a');
  logDataDependencyMissing('documentBundleService', 'utilizationByModelFamily', 'org_a');

  const warnCallsBefore = (logger.warn as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
  const debugCallsBefore = (logger.debug as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
  expect(warnCallsBefore).toBe(1);
  expect(debugCallsBefore).toBe(1);

  _resetWarnedKeysForTesting();

  logDataDependencyMissing('documentBundleService', 'utilizationByModelFamily', 'org_a');

  const warnCallsAfter = (logger.warn as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
  const debugCallsAfter = (logger.debug as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
  expect(warnCallsAfter, 'first call after reset is WARN').toBe(2);
  expect(debugCallsAfter, 'no extra DEBUG after reset').toBe(1);
});
