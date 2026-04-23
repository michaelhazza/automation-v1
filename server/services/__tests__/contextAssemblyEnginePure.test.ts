/**
 * Golden-fixture tests for contextAssemblyEnginePure (§11.1).
 *
 * These tests enforce two invariants:
 * 1. GOLDEN_HASH matches ASSEMBLY_VERSION=1 serialization — any format change
 *    without bumping the fixture deliberately fails.
 * 2. ASSEMBLY_VERSION is currently 1 — bumping the format without bumping
 *    the constant also fails.
 *
 * If you need to change the serialization format:
 *   a. Update ASSEMBLY_VERSION in contextAssemblyEnginePure.ts
 *   b. Update GOLDEN_HASH below to the new expected value
 *   c. Update EXPECTED_ASSEMBLY_VERSION below
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSEMBLY_VERSION,
  serializeDocument,
  computePrefixHash,
  computeAssembledPrefixHash,
  assemblePrefix,
  validateAssembly,
} from '../contextAssemblyEnginePure.js';
import type { PrefixHashComponents } from '../../../shared/types/cachedContext.js';
import type { ResolvedExecutionBudget } from '../../../shared/types/cachedContext.js';

const EXPECTED_ASSEMBLY_VERSION = 1;

// Golden fixture — derived from the reference implementation.
// DO NOT change GOLDEN_HASH without also bumping ASSEMBLY_VERSION.
const GOLDEN_COMPONENTS: PrefixHashComponents = {
  orderedDocumentIds: ['doc-aaaa-0001', 'doc-bbbb-0002'],
  documentSerializedBytesHashes: [
    'abc123def456abc123def456abc123def456abc123def456abc123def456abc123',
    'def789abc012def789abc012def789abc012def789abc012def789abc012def789',
  ],
  includedFlags: [
    { documentId: 'doc-aaaa-0001', included: true, reason: 'attached_and_active' },
    { documentId: 'doc-bbbb-0002', included: true, reason: 'attached_and_active' },
  ],
  modelFamily: 'anthropic.claude-sonnet-4-6',
  assemblyVersion: 1,
};

// Compute expected hash deterministically — this IS the golden value.
import { createHash } from 'node:crypto';
const GOLDEN_HASH = createHash('sha256')
  .update(JSON.stringify({
    orderedDocumentIds: GOLDEN_COMPONENTS.orderedDocumentIds,
    documentSerializedBytesHashes: GOLDEN_COMPONENTS.documentSerializedBytesHashes,
    includedFlags: GOLDEN_COMPONENTS.includedFlags,
    modelFamily: GOLDEN_COMPONENTS.modelFamily,
    assemblyVersion: GOLDEN_COMPONENTS.assemblyVersion,
  }), 'utf8')
  .digest('hex');

test('ASSEMBLY_VERSION is currently 1', () => {
  assert.equal(ASSEMBLY_VERSION, EXPECTED_ASSEMBLY_VERSION);
});

test('computePrefixHash produces stable output for golden fixture', () => {
  const hash = computePrefixHash(GOLDEN_COMPONENTS);
  assert.equal(hash, GOLDEN_HASH);
});

test('computePrefixHash is deterministic (same input → same output)', () => {
  const hash1 = computePrefixHash(GOLDEN_COMPONENTS);
  const hash2 = computePrefixHash(GOLDEN_COMPONENTS);
  assert.equal(hash1, hash2);
});

test('computePrefixHash differs when orderedDocumentIds changes', () => {
  const modified: PrefixHashComponents = {
    ...GOLDEN_COMPONENTS,
    orderedDocumentIds: ['doc-cccc-0003', 'doc-dddd-0004'],
  };
  assert.notEqual(computePrefixHash(modified), GOLDEN_HASH);
});

test('computePrefixHash differs when assemblyVersion changes', () => {
  const modified: PrefixHashComponents = { ...GOLDEN_COMPONENTS, assemblyVersion: 2 };
  assert.notEqual(computePrefixHash(modified), GOLDEN_HASH);
});

test('computePrefixHash differs when modelFamily changes', () => {
  const modified: PrefixHashComponents = {
    ...GOLDEN_COMPONENTS,
    modelFamily: 'anthropic.claude-opus-4-7',
  };
  assert.notEqual(computePrefixHash(modified), GOLDEN_HASH);
});

test('serializeDocument produces correct delimiter structure', () => {
  const result = serializeDocument({ documentId: 'doc-1', version: 3, content: 'hello world' });
  assert.ok(result.startsWith('---DOC_START---\n'));
  assert.ok(result.includes('id: doc-1\nversion: 3\n---\nhello world\n---DOC_END---\n'));
});

test('serializeDocument is deterministic', () => {
  const args = { documentId: 'doc-x', version: 1, content: 'test content' };
  assert.equal(serializeDocument(args), serializeDocument(args));
});

test('assemblePrefix joins documents across snapshots in bundleId order', () => {
  const versionMap = new Map([
    ['doc-a:1', { content: 'content A' }],
    ['doc-b:2', { content: 'content B' }],
  ]);
  const result = assemblePrefix({
    snapshots: [
      { bundleId: 'bundle-z', orderedDocumentVersions: [{ documentId: 'doc-b', documentVersion: 2 }] },
      { bundleId: 'bundle-a', orderedDocumentVersions: [{ documentId: 'doc-a', documentVersion: 1 }] },
    ],
    versionsByDocumentVersionKey: versionMap,
  });
  // bundle-a comes before bundle-z (ascending bundleId sort)
  const indexA = result.indexOf('id: doc-a');
  const indexB = result.indexOf('id: doc-b');
  assert.ok(indexA < indexB, 'bundle-a docs should appear before bundle-z docs');
});

test('computeAssembledPrefixHash is deterministic', () => {
  const input = {
    snapshotPrefixHashesByBundleIdAsc: [GOLDEN_HASH, 'otherhash'],
    modelFamily: 'anthropic.claude-sonnet-4-6',
    assemblyVersion: ASSEMBLY_VERSION,
  };
  assert.equal(computeAssembledPrefixHash(input), computeAssembledPrefixHash(input));
});

test('validateAssembly returns ok when within budget', () => {
  const budget: ResolvedExecutionBudget = {
    maxInputTokens: 100_000,
    maxOutputTokens: 4_000,
    maxTotalCostUsd: 5,
    perDocumentMaxTokens: 50_000,
    reserveOutputTokens: 4_000,
    softWarnRatio: 0.7,
    resolvedFrom: { taskConfigId: null, modelTierPolicyId: 'p1', orgCeilingPolicyId: null },
    modelFamily: 'anthropic.claude-sonnet-4-6',
    modelContextWindow: 200_000,
  };
  const result = validateAssembly({
    assembledPrefixTokens: 10_000,
    variableInputTokens: 1_000,
    perDocumentTopTokens: [{ documentId: 'doc-x', documentName: 'Doc X', tokens: 10_000 }],
    resolvedBudget: budget,
  });
  assert.equal(result.kind, 'ok');
  if (result.kind === 'ok') {
    assert.equal(result.softWarnTripped, false);
  }
});

test('validateAssembly trips soft_warn when above ratio', () => {
  const budget: ResolvedExecutionBudget = {
    maxInputTokens: 10_000,
    maxOutputTokens: 1_000,
    maxTotalCostUsd: 1,
    perDocumentMaxTokens: 50_000,
    reserveOutputTokens: 1_000,
    softWarnRatio: 0.7,
    resolvedFrom: { taskConfigId: null, modelTierPolicyId: 'p1', orgCeilingPolicyId: null },
    modelFamily: 'anthropic.claude-sonnet-4-6',
    modelContextWindow: 200_000,
  };
  // 7500 prefix + 500 variable + 1000 reserve + 100 overhead = 9100 → above 0.7*10000=7000
  const result = validateAssembly({
    assembledPrefixTokens: 7_500,
    variableInputTokens: 500,
    perDocumentTopTokens: [{ documentId: 'd', documentName: 'D', tokens: 7_500 }],
    resolvedBudget: budget,
  });
  assert.equal(result.kind, 'ok');
  if (result.kind === 'ok') {
    assert.equal(result.softWarnTripped, true);
  }
});

test('validateAssembly returns breach when max_input_tokens exceeded', () => {
  const budget: ResolvedExecutionBudget = {
    maxInputTokens: 5_000,
    maxOutputTokens: 1_000,
    maxTotalCostUsd: 1,
    perDocumentMaxTokens: 50_000,
    reserveOutputTokens: 1_000,
    softWarnRatio: 0.7,
    resolvedFrom: { taskConfigId: null, modelTierPolicyId: 'p1', orgCeilingPolicyId: null },
    modelFamily: 'anthropic.claude-sonnet-4-6',
    modelContextWindow: 200_000,
  };
  const result = validateAssembly({
    assembledPrefixTokens: 6_000,
    variableInputTokens: 0,
    perDocumentTopTokens: [],
    resolvedBudget: budget,
  });
  assert.equal(result.kind, 'breach');
  if (result.kind === 'breach') {
    assert.equal(result.payload.thresholdBreached, 'max_input_tokens');
  }
});

test('validateAssembly returns breach when per_document_cap exceeded', () => {
  const budget: ResolvedExecutionBudget = {
    maxInputTokens: 800_000,
    maxOutputTokens: 4_000,
    maxTotalCostUsd: 5,
    perDocumentMaxTokens: 50_000,
    reserveOutputTokens: 4_000,
    softWarnRatio: 0.7,
    resolvedFrom: { taskConfigId: null, modelTierPolicyId: 'p1', orgCeilingPolicyId: null },
    modelFamily: 'anthropic.claude-sonnet-4-6',
    modelContextWindow: 1_000_000,
  };
  const result = validateAssembly({
    assembledPrefixTokens: 100_000,
    variableInputTokens: 0,
    perDocumentTopTokens: [{ documentId: 'big-doc', documentName: 'Big Doc', tokens: 90_000 }],
    resolvedBudget: budget,
  });
  assert.equal(result.kind, 'breach');
  if (result.kind === 'breach') {
    assert.equal(result.payload.thresholdBreached, 'per_document_cap');
  }
});
