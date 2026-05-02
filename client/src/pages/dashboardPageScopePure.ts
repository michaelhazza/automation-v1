/**
 * client/src/pages/dashboardPageScopePure.ts
 *
 * Pure scope-derivation helper for DashboardPage.
 * Extracted for testability per the extract-pure-logic convention.
 *
 * Spec: docs/sub-account-optimiser-spec.md §7
 */

import type { AgentRecommendationsListProps } from '../components/recommendations/AgentRecommendationsList.js';

export function deriveDashboardScope(input: {
  activeClientId: string | null;
  userOrganisationId: string;
}): { scope: AgentRecommendationsListProps['scope']; includeDescendantSubaccounts?: boolean } {
  if (input.activeClientId === null) {
    return {
      scope: { type: 'org', orgId: input.userOrganisationId },
      includeDescendantSubaccounts: true,
    };
  }
  return { scope: { type: 'subaccount', subaccountId: input.activeClientId } };
}
