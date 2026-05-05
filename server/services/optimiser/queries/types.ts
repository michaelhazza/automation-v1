// ---------------------------------------------------------------------------
// Query module contracts for the sub-account optimiser.
//
// Every query module returns QueryRow<TEvidence>[] — one row per logical
// metric key (e.g. agent_id, workflow_id, phrase) within the supplied
// subaccountId window.
//
// The `run` function receives an OrgScopedTx from the caller's DB context.
// Modules are read-only and read-replica safe.
// ---------------------------------------------------------------------------

import type { OrgScopedTx } from '../../../db/index.js';

export interface QueryRow<TEvidence = Record<string, unknown>> {
  subaccountId: string;
  metricKey: string;
  metricValue: number;
  computedAt: Date;
  evidence: TEvidence;
}

export interface QueryModule<TEvidence = Record<string, unknown>> {
  category: string;
  authoritativeTimestampColumn: string;
  readReplicaSafe: true;
  run(tx: OrgScopedTx, subaccountId: string): Promise<QueryRow<TEvidence>[]>;
}
