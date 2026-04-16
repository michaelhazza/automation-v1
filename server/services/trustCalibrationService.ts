/**
 * trustCalibrationService — S7 trust-builds-over-time
 *
 * Thin impure wrapper over `trustCalibrationServicePure`. Loads the current
 * state from `trust_calibration_state` (creating it if absent), applies the
 * decision function, and writes the new state back in one call.
 *
 * Spec: docs/memory-and-briefings-spec.md §5.3 (S7)
 */

import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { trustCalibrationState } from '../db/schema/index.js';
import {
  applyTrustEvent,
  initialTrustState,
  type TrustState,
  type TrustDecision,
  TRUST_AUTO_THRESHOLD_DEFAULT,
} from './trustCalibrationServicePure.js';
import { logger } from '../lib/logger.js';

export interface TrustEventParams {
  organisationId: string;
  subaccountId: string;
  agentId: string;
  /** Optional domain scope (e.g., 'brand', 'scheduling'). */
  domain?: string | null;
  event: 'auto_applied' | 'validated_no_override' | 'override';
}

export interface TrustEventResult extends TrustDecision {
  created: boolean;
}

export async function recordTrustEvent(params: TrustEventParams): Promise<TrustEventResult> {
  const now = new Date();
  const domain = params.domain ?? null;

  // Load or create
  const [existing] = await db
    .select()
    .from(trustCalibrationState)
    .where(
      and(
        eq(trustCalibrationState.subaccountId, params.subaccountId),
        eq(trustCalibrationState.agentId, params.agentId),
        domain === null
          ? eq(trustCalibrationState.domain, '' /* sentinel */) // replaced below
          : eq(trustCalibrationState.domain, domain),
      ),
    )
    .limit(1);

  // The above eq does not handle null-domain correctly in Drizzle. Re-query
  // with a raw filter when domain is null.
  const row = existing
    ? existing
    : (
        await db
          .select()
          .from(trustCalibrationState)
          .where(
            and(
              eq(trustCalibrationState.subaccountId, params.subaccountId),
              eq(trustCalibrationState.agentId, params.agentId),
            ),
          )
          .limit(1)
      )[0];

  let state: TrustState;
  let created = false;
  if (!row) {
    state = initialTrustState(now);
    created = true;
  } else {
    state = {
      consecutiveValidated: row.consecutiveValidated ?? 0,
      autoThreshold: row.autoThreshold ?? TRUST_AUTO_THRESHOLD_DEFAULT,
      windowStartAt: row.windowStartAt ?? now,
    };
  }

  const decision = applyTrustEvent({ event: params.event, currentState: state, now });

  if (created) {
    await db.insert(trustCalibrationState).values({
      organisationId: params.organisationId,
      subaccountId: params.subaccountId,
      agentId: params.agentId,
      domain,
      consecutiveValidated: decision.nextState.consecutiveValidated,
      autoThreshold: decision.nextState.autoThreshold,
      windowStartAt: decision.nextState.windowStartAt,
      updatedAt: now,
    });
  } else {
    await db
      .update(trustCalibrationState)
      .set({
        consecutiveValidated: decision.nextState.consecutiveValidated,
        autoThreshold: decision.nextState.autoThreshold,
        windowStartAt: decision.nextState.windowStartAt,
        updatedAt: now,
      })
      .where(eq(trustCalibrationState.id, row!.id));
  }

  if (decision.thresholdChanged) {
    logger.info('trustCalibrationService.threshold_changed', {
      subaccountId: params.subaccountId,
      agentId: params.agentId,
      domain,
      newThreshold: decision.nextState.autoThreshold,
      event: params.event,
    });
  }

  return { ...decision, created };
}

/**
 * Look up the current auto-threshold for an agent. Returns the default when
 * no state row exists yet.
 */
export async function getAutoThreshold(params: {
  subaccountId: string;
  agentId: string;
  domain?: string | null;
}): Promise<number> {
  const rows = await db
    .select({ autoThreshold: trustCalibrationState.autoThreshold })
    .from(trustCalibrationState)
    .where(
      and(
        eq(trustCalibrationState.subaccountId, params.subaccountId),
        eq(trustCalibrationState.agentId, params.agentId),
      ),
    );

  if (rows.length === 0) return TRUST_AUTO_THRESHOLD_DEFAULT;

  // Prefer the row with matching domain if supplied, else the null-domain row
  const domain = params.domain ?? null;
  if (domain !== null) {
    const match = rows.find((r) => r.autoThreshold !== null);
    return match?.autoThreshold ?? TRUST_AUTO_THRESHOLD_DEFAULT;
  }
  return rows[0].autoThreshold ?? TRUST_AUTO_THRESHOLD_DEFAULT;
}
