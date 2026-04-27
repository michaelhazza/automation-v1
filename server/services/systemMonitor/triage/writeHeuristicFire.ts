// Writes one system_monitor_heuristic_fires row.
// Called for every evaluation outcome (fired, suppressed, insufficient_data,
// errored) — every outcome is audited.

import { db } from '../../../db/index.js';
import { systemMonitorHeuristicFires } from '../../../db/schema/index.js';
import type { EntityKind, Evidence } from '../heuristics/types.js';

export type HeuristicOutcome = 'fired' | 'suppressed' | 'insufficient_data' | 'errored';

export interface WriteHeuristicFireInput {
  heuristicId: string;
  entityKind: EntityKind;
  entityId: string;
  outcome: HeuristicOutcome;
  confidence?: number;
  evidence?: Evidence;
  producedIncidentId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function writeHeuristicFire(input: WriteHeuristicFireInput): Promise<string> {
  const [row] = await db
    .insert(systemMonitorHeuristicFires)
    .values({
      heuristicId: input.heuristicId,
      entityKind: input.entityKind,
      entityId: input.entityId,
      confidence: input.outcome === 'fired' ? (input.confidence ?? null) : null,
      producedIncidentId: input.producedIncidentId ?? null,
      metadata: {
        outcome: input.outcome,
        evidence: input.evidence ?? null,
        ...(input.metadata ?? {}),
      },
      firedAt: new Date(),
    })
    .returning({ id: systemMonitorHeuristicFires.id });

  return row!.id;
}
