// evalGateRunner.ts — Entry point for verify-support-agent-eval-thresholds.sh
//
// Fetches the two most recent non-partial support_eval_runs for the target org
// and passes them to evaluateGateDecision. Exits 0 on pass/fail_open, 1 on fail.
//
// Run via: node --import tsx/esm server/scripts/evalGateRunner.ts
// Requires: DATABASE_URL and EVAL_ORG_ID environment variables.

import { desc, eq, and } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { supportEvalRuns } from '../db/schema/supportEvalRuns.js';
import { evaluateGateDecision, type SupportEvalRunSnapshot } from '../services/supportEvalHarnessPure.js';

const DATABASE_URL = process.env.DATABASE_URL;
const EVAL_ORG_ID = process.env.EVAL_ORG_ID;

if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is not set');
  process.exit(1);
}

if (!EVAL_ORG_ID) {
  console.error('ERROR: EVAL_ORG_ID is not set');
  process.exit(1);
}

const client = postgres(DATABASE_URL, { max: 1 });
const db = drizzle(client);

const rows = await db
  .select()
  .from(supportEvalRuns)
  .where(and(eq(supportEvalRuns.organisationId, EVAL_ORG_ID), eq(supportEvalRuns.partial, false)))
  .orderBy(desc(supportEvalRuns.runAt))
  .limit(2);

const snapshots: SupportEvalRunSnapshot[] = rows.map((r) => ({
  id: r.id,
  classificationAccuracyPerIntent: r.classificationAccuracyPerIntent as Record<string, number>,
  draftJudgeScoreAvg: Number(r.draftJudgeScoreAvg),
  thresholdClassificationMin: Number(r.thresholdClassificationMin),
  thresholdJudgeMin: Number(r.thresholdJudgeMin),
  partial: r.partial,
  rowCount: r.rowCount,
}));

const result = evaluateGateDecision(snapshots);

console.log(`eval gate verdict: ${result.verdict} — ${result.reason}`);

// Emit phase1.support.eval_drift_detected on fail_open (regression set unavailable)
// per spec §5.5.2.
if (result.verdict === 'fail_open') {
  const payload = JSON.stringify({
    event: 'phase1.support.eval_drift_detected',
    reason: 'regression_set_unavailable',
    rowCount: snapshots.length,
    verdict: result.verdict,
  });
  console.log(payload);
}

await client.end();

if (result.verdict === 'fail') {
  process.exit(1);
}

// pass or fail_open both exit 0
process.exit(0);
