import { sql } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import type { SyntheticCheck, SyntheticResult } from './types.js';
import { bucket15min } from './types.js';
import type { HeuristicContext } from '../heuristics/types.js';
import {
  isMonitoringSilent,
  parseProofOfLifeHoursEnv,
  parseSilenceHoursEnv,
} from './incidentSilencePure.js';

export { isMonitoringSilent } from './incidentSilencePure.js';

export const incidentSilence: SyntheticCheck = {
  id: 'incident-silence',
  description: "No system incidents recorded in the configured silence window despite recent monitoring activity from other synthetic checks.",
  defaultSeverity: 'high',

  // @rls-allowlist-bypass: system_incidents run [ref: spec §3.3.1]
  async run(ctx: HeuristicContext): Promise<SyntheticResult> {
    const silenceHours = parseSilenceHoursEnv();
    const proofOfLifeHours = parseProofOfLifeHoursEnv();

    const silenceCutoff = new Date(ctx.now.getTime() - silenceHours * 60 * 60 * 1000);
    const proofCutoff = new Date(ctx.now.getTime() - proofOfLifeHours * 60 * 60 * 1000);

    const result = await db.execute<{
      incidents_in_window: string;
      synthetic_fires_in_proof_window: string;
    }>(sql`
      WITH params AS (
        SELECT
          ${silenceCutoff}::timestamptz AS silence_cutoff,
          ${proofCutoff}::timestamptz   AS proof_cutoff
      )
      SELECT
        (SELECT COUNT(*) FROM system_incidents si, params
         WHERE si.created_at >= params.silence_cutoff
           AND si.is_test_incident = false
           AND NOT (si.source = 'synthetic'
                    AND si.latest_error_detail->>'checkId' = 'incident-silence'))  AS incidents_in_window,
        (SELECT COUNT(*) FROM system_incidents si, params
         WHERE si.source = 'synthetic'
           AND si.created_at >= params.proof_cutoff
           AND NOT (si.latest_error_detail->>'checkId' = 'incident-silence'))      AS synthetic_fires_in_proof_window
    `);

    const row = result[0];
    if (!row) return { fired: false };

    const incidentsInWindow = Number(row.incidents_in_window);
    const syntheticFiresInProofWindow = Number(row.synthetic_fires_in_proof_window);

    if (!isMonitoringSilent(incidentsInWindow, syntheticFiresInProofWindow)) {
      return { fired: false };
    }

    return {
      fired: true,
      severity: 'high',
      resourceKind: 'system',
      resourceId: 'monitoring',
      summary: `No system incidents recorded in the last ${silenceHours} hours despite recent monitoring activity.`,
      bucketKey: bucket15min(ctx.now),
      metadata: {
        checkId: 'incident-silence',
        silenceHours,
        proofOfLifeHours,
        syntheticFiresInProofWindow,
      },
    };
  },
};
