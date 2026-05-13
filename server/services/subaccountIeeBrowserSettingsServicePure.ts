// subaccountIeeBrowserSettingsServicePure.ts — pure helpers for IEE browser settings.
//
// Pure module — no DB, no IO. Exported for unit testing and consumption by
// the impure service layer and route handlers.

import { z } from 'zod';
import type { NewAuditEvent } from '../db/schema/auditEvents.js';

// ---------------------------------------------------------------------------
// Response type
// ---------------------------------------------------------------------------

export interface IeeBrowserSettingsResponse {
  subaccountId: string;
  organisationId: string;
  status: 'on' | 'off';
  rolloutApproved: boolean;
  browserProfileRetentionDays: number;
  perTaskCostCeilingCents: number;
  perSubaccountDailyCostCeilingCents: number;
  settingsVersion: number;
  updatedAt: Date | null;
  updatedByUserId: string | null;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

/** Zod schema for PATCH /api/subaccounts/:id/iee-browser-settings body.
 *  Note: rolloutApproved is NOT accepted here — it is admin-only. */
export const patchBodySchema = z.object({
  status: z.enum(['on', 'off']).optional(),
  browserProfileRetentionDays: z.number().int().min(7).max(90).optional(),
  perTaskCostCeilingCents: z.number().int().min(1).max(10000).optional(),
  perSubaccountDailyCostCeilingCents: z.number().int().min(1).max(100000).optional(),
  expectedSettingsVersion: z.number().int(),
});

export type PatchBody = z.infer<typeof patchBodySchema>;

/** Zod schema for POST /api/admin/iee-browser/rollout-approval/:subaccountId body. */
export const rolloutBodySchema = z.object({
  approved: z.boolean(),
  expectedSettingsVersion: z.number().int(),
});

export type RolloutBody = z.infer<typeof rolloutBodySchema>;

// ---------------------------------------------------------------------------
// ETag conflict detection
// ---------------------------------------------------------------------------

/**
 * Returns true if the expectedVersion does not match the currentVersion,
 * indicating an ETag conflict that should produce a 409.
 */
export function isETagConflict(expected: number, current: number): boolean {
  return expected !== current;
}

// ---------------------------------------------------------------------------
// Lazy-create logic
// ---------------------------------------------------------------------------

/**
 * Returns true when the request should trigger a lazy INSERT of a new row.
 * Only valid when the caller expects the row to not exist (version 0) AND
 * the row is actually absent.
 */
export function isLazyCreate(expectedVersion: number, rowExists: boolean): boolean {
  return expectedVersion === 0 && !rowExists;
}

/**
 * Returns true if the error is a PostgreSQL unique-violation (23505).
 * Used to detect lazy-create races where two concurrent requests both try to INSERT.
 */
export function isLazyCreatePkConflict(err: unknown): boolean {
  if (typeof err === 'object' && err !== null) {
    return (err as { code?: string }).code === '23505';
  }
  return false;
}

// ---------------------------------------------------------------------------
// Audit row builder
// ---------------------------------------------------------------------------

/**
 * Builds the audit event row for a rollout-approval change.
 * Must be inserted in the same transaction as the settings update.
 */
export function buildRolloutAuditRow(params: {
  actorUserId: string;
  orgId: string;
  subaccountId: string;
  priorValue: boolean;
  newValue: boolean;
}): NewAuditEvent {
  return {
    action: 'iee_browser.rollout_approval_set',
    actorType: 'user',
    actorId: params.actorUserId,
    organisationId: params.orgId,
    entityType: 'subaccount_iee_browser_settings',
    entityId: params.subaccountId,
    metadata: {
      priorValue: params.priorValue,
      newValue: params.newValue,
    },
  };
}

// ---------------------------------------------------------------------------
// Synthesised defaults
// ---------------------------------------------------------------------------

/**
 * Returns a synthesised defaults object when no row exists for the subaccount.
 * settingsVersion is 0 — the "row absent" sentinel (NOT a real DB row).
 * The DB default for real rows is 1.
 */
export function synthesiseDefaults(
  subaccountId: string,
  organisationId: string,
): IeeBrowserSettingsResponse {
  return {
    subaccountId,
    organisationId,
    status: 'off',
    rolloutApproved: false,
    browserProfileRetentionDays: 30,
    perTaskCostCeilingCents: 100,
    perSubaccountDailyCostCeilingCents: 500,
    settingsVersion: 0,
    updatedAt: null,
    updatedByUserId: null,
  };
}
