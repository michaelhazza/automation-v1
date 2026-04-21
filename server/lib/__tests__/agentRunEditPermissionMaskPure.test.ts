import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  buildPermissionMask,
  type PermissionMaskUserContext,
} from '../agentRunEditPermissionMaskPure.js';
import type { LinkedEntityType } from '../../../shared/types/agentExecutionLog.js';

function mkUser(overrides: Partial<PermissionMaskUserContext> = {}): PermissionMaskUserContext {
  return {
    id: 'u-1',
    role: 'user',
    organisationId: 'org-1',
    orgPermissions: new Set<string>(),
    canManageWorkspace: false,
    canManageSkills: false,
    canEditAgents: false,
    ...overrides,
  };
}

const RUN_ORG = 'org-1';
const RUN_SUB = 'sub-1';

test('unlinked event (clarification/run.completed) — no entity → no edit', () => {
  const mask = buildPermissionMask({
    entityType: null,
    entityId: null,
    user: mkUser({ orgPermissions: new Set(['org.agents.view']) }),
    runOrganisationId: RUN_ORG,
    runSubaccountId: RUN_SUB,
  });
  assert.equal(mask.canView, true);
  assert.equal(mask.canEdit, false);
  assert.equal(mask.editHref, null);
});

test('cross-org access — mask is empty for non-admins', () => {
  const mask = buildPermissionMask({
    entityType: 'memory_entry',
    entityId: 'm-1',
    user: mkUser({ organisationId: 'other-org' }),
    runOrganisationId: RUN_ORG,
    runSubaccountId: RUN_SUB,
  });
  assert.equal(mask.canView, false);
  assert.equal(mask.canEdit, false);
});

test('memory_entry with canManageWorkspace → view + edit', () => {
  const mask = buildPermissionMask({
    entityType: 'memory_entry',
    entityId: 'm-1',
    user: mkUser({ canManageWorkspace: true }),
    runOrganisationId: RUN_ORG,
    runSubaccountId: RUN_SUB,
  });
  assert.equal(mask.canView, true);
  assert.equal(mask.canEdit, true);
  assert.ok(mask.editHref);
});

test('memory_entry without workspace-manage → view only when workspace.view held', () => {
  const mask = buildPermissionMask({
    entityType: 'memory_entry',
    entityId: 'm-1',
    user: mkUser({ orgPermissions: new Set(['org.workspace.view']) }),
    runOrganisationId: RUN_ORG,
    runSubaccountId: RUN_SUB,
  });
  assert.equal(mask.canView, true);
  assert.equal(mask.canEdit, false);
  assert.equal(mask.editHref, null);
});

test('prompt / llm_request / action — canEdit always false', () => {
  for (const type of ['prompt', 'llm_request', 'action'] as LinkedEntityType[]) {
    const mask = buildPermissionMask({
      entityType: type,
      entityId: 'x-1',
      user: mkUser({ role: 'org_admin' }),
      runOrganisationId: RUN_ORG,
      runSubaccountId: RUN_SUB,
    });
    assert.equal(mask.canEdit, false, `${type}: canEdit must be false`);
    assert.equal(mask.editHref, null, `${type}: editHref must be null`);
  }
});

test('canViewPayload is strictly tighter than canView — positive case', () => {
  const mask = buildPermissionMask({
    entityType: 'memory_entry',
    entityId: 'm-1',
    user: mkUser({ canManageWorkspace: true, canEditAgents: true }),
    runOrganisationId: RUN_ORG,
    runSubaccountId: RUN_SUB,
  });
  assert.equal(mask.canView, true);
  assert.equal(mask.canViewPayload, true);
});

test('canViewPayload false when canEditAgents false', () => {
  const mask = buildPermissionMask({
    entityType: 'memory_entry',
    entityId: 'm-1',
    user: mkUser({ canManageWorkspace: true, canEditAgents: false }),
    runOrganisationId: RUN_ORG,
    runSubaccountId: RUN_SUB,
  });
  assert.equal(mask.canView, true);
  assert.equal(mask.canViewPayload, false);
});

test('read-time recomputation: same entity, two different users → different masks', () => {
  const runCtx = {
    entityType: 'memory_entry' as const,
    entityId: 'm-1',
    runOrganisationId: RUN_ORG,
    runSubaccountId: RUN_SUB,
  };
  const withEdit = buildPermissionMask({
    ...runCtx,
    user: mkUser({ canManageWorkspace: true }),
  });
  const viewOnly = buildPermissionMask({
    ...runCtx,
    user: mkUser({ orgPermissions: new Set(['org.workspace.view']) }),
  });
  assert.equal(withEdit.canEdit, true);
  assert.equal(viewOnly.canEdit, false);
});

test('system_admin has full mask on every editable entity type', () => {
  const admin = mkUser({ role: 'system_admin' });
  // data_source is deliberately excluded: no per-item edit route exists,
  // so canEdit is always false regardless of role (see the data_source case).
  for (const type of [
    'memory_entry',
    'memory_block',
    'policy_rule',
    'skill',
    'agent',
  ] as LinkedEntityType[]) {
    const mask = buildPermissionMask({
      entityType: type,
      entityId: 'x-1',
      user: admin,
      runOrganisationId: RUN_ORG,
      runSubaccountId: RUN_SUB,
    });
    assert.equal(mask.canView, true, `${type}: system_admin canView`);
    assert.equal(mask.canEdit, true, `${type}: system_admin canEdit`);
  }
});

test('data_source: canEdit is always false (no per-item edit route)', () => {
  // data_source links to the subaccount knowledge page for view; no edit route.
  const mask = buildPermissionMask({
    entityType: 'data_source',
    entityId: 'ds-1',
    user: mkUser({ role: 'system_admin' }),
    runOrganisationId: RUN_ORG,
    runSubaccountId: RUN_SUB,
  });
  assert.equal(mask.canView, true);
  assert.equal(mask.canEdit, false);
  assert.equal(mask.editHref, null);
  assert.ok(mask.viewHref, 'viewHref should point to knowledge page');
});
