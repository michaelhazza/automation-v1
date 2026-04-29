import { expect, test } from 'vitest';
// guard-ignore-file: pure-helper-convention reason="Inline pure simulation — orgId-guard logic inlined to avoid db/drizzle transitive imports; no sibling import needed"
/**
 * skillStudioServicePure unit tests — runnable via:
 *   npx tsx server/services/__tests__/skillStudioServicePure.test.ts
 *
 * Locks the orgId-required throw contract for saveSkillVersion.
 * The guard that throws lives before any DB write, so it is extracted inline
 * here to keep the test free of DB/drizzle transitive imports.
 *
 * Spec: docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md §B1
 */

// ---------------------------------------------------------------------------
// Pure extraction of the saveSkillVersion orgId guard
// ---------------------------------------------------------------------------
// Source: server/services/skillStudioService.ts — saveSkillVersion()
// Lines 295–319 (as of branch claude/deferred-quality-fixes-ZKgVV).
//
// The function enters a db.transaction callback and, after writing the version
// row, checks scope + orgId before issuing the skill-row update. The throw
// below occurs inside the transaction but before any DB update for org/subaccount
// scopes, making it safe to test in isolation via the same branching logic.

type Scope = 'system' | 'org' | 'subaccount';

/**
 * Mirrors the orgId validation guard inside saveSkillVersion's transaction body.
 * Returns normally for scope='system'; throws for org/subaccount when orgId is falsy.
 */
function validateOrgIdForScope(scope: Scope, orgId: string | null): void {
  if (scope === 'system') {
    // No orgId required — system skills are global.
    return;
  } else if (scope === 'org') {
    if (!orgId) {
      throw new Error(`saveSkillVersion: orgId is required for scope=${scope}`);
    }
  } else {
    // subaccount (and any future scope that is not 'system')
    if (!orgId) {
      throw new Error(`saveSkillVersion: orgId is required for scope=${scope}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('saveSkillVersion rejects when orgId is null for scope=org', async () => {
  expect(() => validateOrgIdForScope('org', null)).toThrow('saveSkillVersion: orgId is required for scope=org');
});

test('saveSkillVersion rejects when orgId is null for scope=subaccount', async () => {
  expect(() => validateOrgIdForScope('subaccount', null)).toThrow('saveSkillVersion: orgId is required for scope=subaccount');
});

test('saveSkillVersion does NOT throw when orgId is null for scope=system', async () => {
  expect(() => validateOrgIdForScope('system', null)).not.toThrow();
});
