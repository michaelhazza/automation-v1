// client/src/pages/__tests__/DashboardPagePure.test.ts
// Pure-logic tests for the scope-derivation helper.
// Spec: docs/sub-account-optimiser-spec.md §7 / plan Chunk 4 test considerations
import { expect, test, describe } from 'vitest';
import { deriveDashboardScope } from '../dashboardPageScopePure.js';

const ORG_ID = 'org-abc-123';

describe('deriveDashboardScope', () => {
  test('activeClientId === null → org scope + includeDescendantSubaccounts: true', () => {
    const result = deriveDashboardScope({ activeClientId: null, userOrganisationId: ORG_ID });
    expect(result.scope).toEqual({ type: 'org', orgId: ORG_ID });
    expect(result.includeDescendantSubaccounts).toBe(true);
  });

  test('activeClientId !== null → subaccount scope, no includeDescendantSubaccounts', () => {
    const subId = 'sub-xyz-456';
    const result = deriveDashboardScope({ activeClientId: subId, userOrganisationId: ORG_ID });
    expect(result.scope).toEqual({ type: 'subaccount', subaccountId: subId });
    expect(result.includeDescendantSubaccounts).toBeUndefined();
  });

  test('determinism: same input twice → same output', () => {
    const input = { activeClientId: 'sub-det-789', userOrganisationId: ORG_ID };
    const first = deriveDashboardScope(input);
    const second = deriveDashboardScope(input);
    expect(first).toEqual(second);
  });

  test('boundary: empty-string activeClientId → treated as valid subaccount id', () => {
    // The parent state is the source of truth — no normalisation in this helper.
    const result = deriveDashboardScope({ activeClientId: '', userOrganisationId: ORG_ID });
    expect(result.scope).toEqual({ type: 'subaccount', subaccountId: '' });
    expect(result.includeDescendantSubaccounts).toBeUndefined();
  });
});
