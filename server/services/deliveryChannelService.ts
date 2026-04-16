/**
 * deliveryChannelService — available delivery channel aggregator
 *
 * `getAvailableChannels(subaccountId, orgId)` resolves which delivery channels
 * are available for a given subaccount. Consumed by the
 * `GET /api/subaccounts/:id/integrations/available-channels` route.
 *
 * Channel resolution:
 *   email   — always true (inbox always-on invariant; every subaccount has an inbox)
 *   portal  — true when subaccount portalMode is 'transparency' or 'collaborative'
 *   slack   — true when an active Slack integration connection exists for the
 *             subaccount or the org (org-level connections are shared)
 *
 * Spec: docs/memory-and-briefings-spec.md §10.4 (S22)
 */

import { eq, and, isNull, or } from 'drizzle-orm';
import { db } from '../db/index.js';
import { subaccounts, integrationConnections } from '../db/schema/index.js';

export interface AvailableChannels {
  email: boolean;
  portal: boolean;
  slack: boolean;
}

export async function getAvailableChannels(
  subaccountId: string,
  orgId: string,
): Promise<AvailableChannels> {
  // Fetch subaccount to get portalMode
  const [subaccount] = await db
    .select({ portalMode: subaccounts.portalMode })
    .from(subaccounts)
    .where(
      and(
        eq(subaccounts.id, subaccountId),
        eq(subaccounts.organisationId, orgId),
        isNull(subaccounts.deletedAt),
      ),
    )
    .limit(1);

  if (!subaccount) {
    throw { statusCode: 404, message: 'Subaccount not found' };
  }

  // Portal: visible when portalMode is not 'hidden'
  const portalAvailable =
    subaccount.portalMode === 'transparency' ||
    subaccount.portalMode === 'collaborative';

  // Slack: check for an active Slack connection at subaccount or org level
  const slackConnections = await db
    .select({ id: integrationConnections.id })
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organisationId, orgId),
        eq(integrationConnections.providerType, 'slack'),
        eq(integrationConnections.connectionStatus, 'active'),
        or(
          eq(integrationConnections.subaccountId, subaccountId),
          isNull(integrationConnections.subaccountId), // org-level shared connection
        ),
      ),
    )
    .limit(1);

  return {
    email: true, // always-on inbox invariant
    portal: portalAvailable,
    slack: slackConnections.length > 0,
  };
}
