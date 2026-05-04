// ---------------------------------------------------------------------------
// approvalChannelServicePure — pure channel orchestration logic
//
// No DB, no I/O. All functions are deterministic and side-effect-free.
// Impure orchestration lives in approvalChannelService.ts.
//
// Spec: tasks/builds/agentic-commerce/spec.md §11.1, §13.2, §13.3
// Plan: tasks/builds/agentic-commerce/plan.md § Chunk 9
// ---------------------------------------------------------------------------

import type { ApprovalResolution } from '../../shared/types/approvalChannel.js';

// ---------------------------------------------------------------------------
// Types for pure channel fan-out
// ---------------------------------------------------------------------------

export interface SubaccountChannel {
  id: string;
  channelType: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface OrgChannel {
  id: string;
  channelType: string;
  enabled: boolean;
  config: Record<string, unknown>;
  organisationId: string;
}

export interface ActiveGrant {
  id: string;
  orgChannelId: string;
  subaccountId: string;
  active: boolean;
}

export interface FanOutTarget {
  channelId: string;
  channelType: string;
  source: 'subaccount' | 'org_grant';
  config: Record<string, unknown>;
}

export type GrantTransitionState = 'active' | 'revoked';

// ---------------------------------------------------------------------------
// collectEligibleChannels
//
// Returns the fan-out target list for a given (subaccount, org) pair.
// - Subaccount-owned channels: included only if enabled = true.
// - Org channels: included only if there is an active grant for this
//   subaccount AND the org channel itself is enabled.
// ---------------------------------------------------------------------------

export function collectEligibleChannels(
  subaccountChannels: SubaccountChannel[],
  orgChannels: OrgChannel[],
  activeGrants: ActiveGrant[],
): FanOutTarget[] {
  const targets: FanOutTarget[] = [];

  // Subaccount-owned channels (enabled only)
  for (const ch of subaccountChannels) {
    if (!ch.enabled) continue;
    targets.push({
      channelId: ch.id,
      channelType: ch.channelType,
      source: 'subaccount',
      config: ch.config,
    });
  }

  // Build a set of orgChannelIds that have an active grant for this subaccount
  const grantedOrgChannelIds = new Set(
    activeGrants.filter((g) => g.active).map((g) => g.orgChannelId),
  );

  // Org channels: must have an active grant AND be enabled
  for (const ch of orgChannels) {
    if (!ch.enabled) continue;
    if (!grantedOrgChannelIds.has(ch.id)) continue;
    targets.push({
      channelId: ch.id,
      channelType: ch.channelType,
      source: 'org_grant',
      config: ch.config,
    });
  }

  return targets;
}

// ---------------------------------------------------------------------------
// classifyResponse
//
// First-response-wins: 'winning' if the charge row is still pending_approval;
// 'superseded' if another response already resolved it.
// ---------------------------------------------------------------------------

export function classifyResponse(
  currentRowStatus: string,
  _response: { decision: 'approved' | 'denied' },
): 'winning' | 'superseded' {
  return currentRowStatus === 'pending_approval' ? 'winning' : 'superseded';
}

// ---------------------------------------------------------------------------
// computeNotificationPayload
//
// Builds the "resolved by Y via Z at T" message for losing channels.
// ---------------------------------------------------------------------------

export function computeNotificationPayload(resolution: ApprovalResolution): {
  actionId: string;
  message: string;
  decision: 'approved' | 'denied';
} {
  const { actionId, resolvedBy, decision, resolutionMessage } = resolution;
  const { userId, channelType, respondedAt } = resolvedBy;
  const ts = respondedAt.toISOString();
  const message = `${resolutionMessage} (resolved by user ${userId} via ${channelType} at ${ts})`;
  return { actionId, message, decision };
}

// ---------------------------------------------------------------------------
// validateGrantTransition
//
// Grant lifecycle rules:
//   active  → revoked  : allowed
//   revoked → active   : rejected (re-enabling revoked grants is not permitted)
//   same    → same     : rejected (no-op transitions are rejected at service layer)
// ---------------------------------------------------------------------------

export type GrantTransitionResult =
  | { valid: true }
  | { valid: false; reason: string };

export function validateGrantTransition(
  currentState: GrantTransitionState,
  newState: GrantTransitionState,
): GrantTransitionResult {
  if (currentState === newState) {
    return { valid: false, reason: 'no_op_transition' };
  }
  if (currentState === 'active' && newState === 'revoked') {
    return { valid: true };
  }
  // revoked → active is not permitted (re-enablement requires a new grant row)
  return { valid: false, reason: 'revoked_grant_cannot_be_reactivated' };
}
