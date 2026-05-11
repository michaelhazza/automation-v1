/**
 * e2bSandboxPure.test.ts — Pure tests for e2bSandboxPure.ts helpers.
 *
 * Spec B §8.2.1, §13.1, §15.3, §25.1.
 *
 * Covers:
 *   - e2bTerminalSignalToInternal: every signal type + edge cases → SandboxTerminalState
 *   - assertNotLatestTemplateVersion: 'latest' throws; non-latest passes
 *   - buildE2bMetadataTags: tag map shape and content
 *   - credentialAliasPath: path format per spec §11.1
 *
 * No DB, no network, no e2b SDK.
 *
 * Runnable via:
 *   npx vitest run server/services/sandbox/__tests__/e2bSandboxPure.test.ts
 */

import { describe, test, expect } from 'vitest';
import {
  e2bTerminalSignalToInternal,
  assertNotLatestTemplateVersion,
  buildE2bMetadataTags,
  credentialAliasPath,
  type E2bTerminalSignal,
} from '../e2bSandboxPure.js';

// ---------------------------------------------------------------------------
// e2bTerminalSignalToInternal
// ---------------------------------------------------------------------------

describe('e2bTerminalSignalToInternal', () => {
  test('ambiguous:true → provider_unavailable (overrides type)', () => {
    const signal: E2bTerminalSignal = { type: 'finished', exitCode: 0, ambiguous: true };
    expect(e2bTerminalSignalToInternal(signal)).toBe('provider_unavailable');
  });

  test('type=unknown → provider_unavailable', () => {
    const signal: E2bTerminalSignal = { type: 'unknown' };
    expect(e2bTerminalSignalToInternal(signal)).toBe('provider_unavailable');
  });

  test('type=unknown + ambiguous:false → provider_unavailable (type wins)', () => {
    const signal: E2bTerminalSignal = { type: 'unknown', ambiguous: false };
    expect(e2bTerminalSignalToInternal(signal)).toBe('provider_unavailable');
  });

  test('type=finished, exitCode=0 → completed', () => {
    const signal: E2bTerminalSignal = { type: 'finished', exitCode: 0 };
    expect(e2bTerminalSignalToInternal(signal)).toBe('completed');
  });

  test('type=finished, no exitCode → completed', () => {
    const signal: E2bTerminalSignal = { type: 'finished' };
    expect(e2bTerminalSignalToInternal(signal)).toBe('completed');
  });

  test('type=finished, exitCode=1 → crashed (non-zero exit)', () => {
    const signal: E2bTerminalSignal = { type: 'finished', exitCode: 1 };
    expect(e2bTerminalSignalToInternal(signal)).toBe('crashed');
  });

  test('type=finished, exitCode=127 → crashed (command not found)', () => {
    const signal: E2bTerminalSignal = { type: 'finished', exitCode: 127 };
    expect(e2bTerminalSignalToInternal(signal)).toBe('crashed');
  });

  test('type=timeout → timed_out', () => {
    const signal: E2bTerminalSignal = { type: 'timeout' };
    expect(e2bTerminalSignalToInternal(signal)).toBe('timed_out');
  });

  test('type=killed → timed_out (default for explicit termination)', () => {
    const signal: E2bTerminalSignal = { type: 'killed' };
    expect(e2bTerminalSignalToInternal(signal)).toBe('timed_out');
  });

  test('type=error → crashed', () => {
    const signal: E2bTerminalSignal = { type: 'error' };
    expect(e2bTerminalSignalToInternal(signal)).toBe('crashed');
  });

  test('type=error + exitCode supplied → crashed', () => {
    const signal: E2bTerminalSignal = { type: 'error', exitCode: 2 };
    expect(e2bTerminalSignalToInternal(signal)).toBe('crashed');
  });

  // Guard: ambiguous flag takes precedence over specific types
  test('ambiguous:true + type=timeout → provider_unavailable', () => {
    const signal: E2bTerminalSignal = { type: 'timeout', ambiguous: true };
    expect(e2bTerminalSignalToInternal(signal)).toBe('provider_unavailable');
  });

  test('ambiguous:true + type=error → provider_unavailable', () => {
    const signal: E2bTerminalSignal = { type: 'error', ambiguous: true };
    expect(e2bTerminalSignalToInternal(signal)).toBe('provider_unavailable');
  });

  test('ambiguous:true + type=killed → provider_unavailable', () => {
    const signal: E2bTerminalSignal = { type: 'killed', ambiguous: true };
    expect(e2bTerminalSignalToInternal(signal)).toBe('provider_unavailable');
  });
});

// ---------------------------------------------------------------------------
// assertNotLatestTemplateVersion
// ---------------------------------------------------------------------------

describe('assertNotLatestTemplateVersion', () => {
  test("throws when templateVersion is 'latest'", () => {
    expect(() => assertNotLatestTemplateVersion('latest', 'TestContext')).toThrow(
      /TestContext.*latest.*not allowed/,
    );
  });

  test("throws when templateVersion is 'latest' (case-sensitive — 'LATEST' is fine)", () => {
    // Spec §15.3 bans exactly the string 'latest'. Other casing is not banned.
    expect(() => assertNotLatestTemplateVersion('LATEST', 'TestContext')).not.toThrow();
  });

  test('does not throw for a sha256 digest', () => {
    expect(() =>
      assertNotLatestTemplateVersion(
        'sha256:abc123def456',
        'TestContext',
      ),
    ).not.toThrow();
  });

  test('does not throw for a semver string', () => {
    expect(() => assertNotLatestTemplateVersion('v1.0.0', 'TestContext')).not.toThrow();
  });

  test('error message includes the context label', () => {
    expect(() =>
      assertNotLatestTemplateVersion('latest', 'E2bSandbox.constructor'),
    ).toThrow(/E2bSandbox\.constructor/);
  });
});

// ---------------------------------------------------------------------------
// buildE2bMetadataTags
// ---------------------------------------------------------------------------

describe('buildE2bMetadataTags', () => {
  const ctx = {
    organisationId: 'org-111',
    subaccountId: 'sub-222',
    runId: 'run-333',
    agentId: 'agent-444',
    taskId: 'task-555',
    sandboxExecutionId: 'exec-666',
    templateName: 'synthetos-sandbox',
    templateVersion: 'v1.0.0',
  };

  test('returns all 8 required tag keys (spec §8.2.1)', () => {
    const tags = buildE2bMetadataTags(ctx);
    expect(Object.keys(tags).sort()).toEqual(
      [
        'agent_id',
        'org_id',
        'run_id',
        'sandbox_execution_id',
        'subaccount_id',
        'task_id',
        'template_name',
        'template_version',
      ].sort(),
    );
  });

  test('maps organisationId → org_id', () => {
    const tags = buildE2bMetadataTags(ctx);
    expect(tags['org_id']).toBe('org-111');
  });

  test('maps subaccountId → subaccount_id', () => {
    const tags = buildE2bMetadataTags(ctx);
    expect(tags['subaccount_id']).toBe('sub-222');
  });

  test('maps sandboxExecutionId → sandbox_execution_id', () => {
    const tags = buildE2bMetadataTags(ctx);
    expect(tags['sandbox_execution_id']).toBe('exec-666');
  });

  test('maps templateName → template_name', () => {
    const tags = buildE2bMetadataTags(ctx);
    expect(tags['template_name']).toBe('synthetos-sandbox');
  });

  test('maps templateVersion → template_version', () => {
    const tags = buildE2bMetadataTags(ctx);
    expect(tags['template_version']).toBe('v1.0.0');
  });

  test('all values are strings', () => {
    const tags = buildE2bMetadataTags(ctx);
    for (const [key, value] of Object.entries(tags)) {
      expect(typeof value).toBe('string');
      void key;
    }
  });
});

// ---------------------------------------------------------------------------
// credentialAliasPath
// ---------------------------------------------------------------------------

describe('credentialAliasPath', () => {
  test('produces /workspace/secrets/{alias}.token format (spec §11.1)', () => {
    expect(credentialAliasPath('openai_api')).toBe('/workspace/secrets/openai_api.token');
  });

  test('works for compound alias names', () => {
    expect(credentialAliasPath('github_org_repo')).toBe(
      '/workspace/secrets/github_org_repo.token',
    );
  });

  test('preserves alias characters verbatim', () => {
    expect(credentialAliasPath('aws_session_xyz')).toBe(
      '/workspace/secrets/aws_session_xyz.token',
    );
  });
});
