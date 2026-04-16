/**
 * portalConfigService — portal mode + portalFeatures update (§6.3 S16+S17)
 *
 * Owns:
 *   - PATCH of portalMode + portalFeatures on subaccounts
 *   - audit log write on every change
 *   - WebSocket re-publish so active client-portal sessions respond live
 *
 * Spec: docs/memory-and-briefings-spec.md §6.2, §6.3 (S16, S17)
 */

import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { subaccounts } from '../db/schema/index.js';
import type { PortalMode } from '../db/schema/subaccounts.js';
import { PORTAL_FEATURE_BY_KEY } from '../config/portalFeatureRegistry.js';
import { resolveAllPortalFeatures } from '../lib/portalGate.js';
import { emitSubaccountUpdate } from '../websocket/emitters.js';
import { auditService } from './auditService.js';
import { logger } from '../lib/logger.js';

const VALID_MODES: ReadonlySet<PortalMode> = new Set(['hidden', 'transparency', 'collaborative']);

export interface UpdatePortalConfigInput {
  subaccountId: string;
  organisationId: string;
  actorUserId: string;
  /** New portal mode (optional — omit to leave unchanged). */
  portalMode?: PortalMode;
  /** Partial feature overrides — merged with existing state. */
  portalFeatures?: Partial<Record<string, boolean>>;
}

export interface UpdatePortalConfigResult {
  subaccountId: string;
  portalMode: PortalMode;
  portalFeatures: Record<string, boolean>;
  effectiveFeatures: Record<string, boolean>;
}

export async function updatePortalConfig(
  input: UpdatePortalConfigInput,
): Promise<UpdatePortalConfigResult> {
  // Validate inputs
  if (input.portalMode && !VALID_MODES.has(input.portalMode)) {
    throw {
      statusCode: 400,
      message: `invalid portalMode '${input.portalMode}'`,
      errorCode: 'INVALID_PORTAL_MODE',
    };
  }
  if (input.portalFeatures) {
    for (const key of Object.keys(input.portalFeatures)) {
      if (!PORTAL_FEATURE_BY_KEY.has(key as never)) {
        throw {
          statusCode: 400,
          message: `unknown feature key '${key}'`,
          errorCode: 'UNKNOWN_FEATURE_KEY',
        };
      }
    }
  }

  // Load current state
  const [current] = await db
    .select({
      id: subaccounts.id,
      portalMode: subaccounts.portalMode,
      portalFeatures: subaccounts.portalFeatures,
    })
    .from(subaccounts)
    .where(
      and(
        eq(subaccounts.id, input.subaccountId),
        eq(subaccounts.organisationId, input.organisationId),
        isNull(subaccounts.deletedAt),
      ),
    )
    .limit(1);

  if (!current) {
    throw { statusCode: 404, message: 'Subaccount not found' };
  }

  const prevMode = (current.portalMode as PortalMode) ?? 'hidden';
  const prevFeatures = (current.portalFeatures as Record<string, boolean> | null) ?? {};

  // Compute next state
  const nextMode = input.portalMode ?? prevMode;
  const nextFeatures: Record<string, boolean> = { ...prevFeatures };
  if (input.portalFeatures) {
    for (const [k, v] of Object.entries(input.portalFeatures)) {
      if (v === undefined) {
        delete nextFeatures[k]; // undefined removes the override
      } else {
        nextFeatures[k] = Boolean(v);
      }
    }
  }

  // Persist
  await db
    .update(subaccounts)
    .set({
      portalMode: nextMode,
      portalFeatures: nextFeatures,
      updatedAt: new Date(),
    })
    .where(eq(subaccounts.id, input.subaccountId));

  // Audit log
  await auditService.log({
    actorId: input.actorUserId,
    actorType: 'user',
    action: 'portal.config.updated',
    organisationId: input.organisationId,
    entityType: 'subaccount',
    entityId: input.subaccountId,
    metadata: {
      prevMode,
      nextMode,
      prevFeatures,
      nextFeatures,
    },
  });

  // Compute effective feature visibility (mode floor applied) and re-publish
  const effective = resolveAllPortalFeatures(nextMode, nextFeatures);

  try {
    emitSubaccountUpdate(input.subaccountId, 'portal:config:updated', {
      portalMode: nextMode,
      portalFeatures: nextFeatures,
      effectiveFeatures: effective,
    });
  } catch (err) {
    logger.warn('portalConfigService.ws_emit_failed', {
      subaccountId: input.subaccountId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  logger.info('portalConfigService.updated', {
    subaccountId: input.subaccountId,
    prevMode,
    nextMode,
    actorUserId: input.actorUserId,
  });

  return {
    subaccountId: input.subaccountId,
    portalMode: nextMode,
    portalFeatures: nextFeatures,
    effectiveFeatures: effective,
  };
}
