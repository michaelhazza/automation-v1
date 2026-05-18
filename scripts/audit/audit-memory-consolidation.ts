/**
 * audit-memory-consolidation.ts
 *
 * CLI audit script for the memory tiered consolidation feature.
 * Implements seven checks per spec §13.2.
 *
 * Usage:
 *   npx tsx scripts/audit/audit-memory-consolidation.ts \
 *     --env staging \
 *     [--warmup-days 14] \
 *     [--out scripts/audit/_logs/result.json] \
 *     [--trend-log scripts/audit/_logs/trend.jsonl] \
 *     [--no-todo-routing]
 *
 * Exit codes: 0 (pass or warn), 1 (fail or DB error).
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import type { AuditCheckResult, MemoryConsolidationAuditResult } from '../../shared/types/memoryConsolidation.js';
import { isValidPromotionTransition } from '../../shared/types/memoryConsolidation.js';
import {
  ACTIVE_MEMORY_CONSOLIDATION_CONFIG_VERSION,
  MEMORY_CONSOLIDATION_CONFIG_HISTORY,
} from '../../server/config/memoryConsolidationConfig.js';
import { getMemoryConsolidationTierEnabled } from '../../server/config/featureFlags.js';

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/** Combine per-check verdicts into an overall audit verdict. */
export function combinedVerdict(checks: AuditCheckResult[]): 'pass' | 'warn' | 'fail' {
  if (checks.some(c => c.status === 'fail')) return 'fail';
  if (checks.some(c => c.status === 'warn')) return 'warn';
  return 'pass';
}

/** Format one todo entry line per spec §13.4. */
export function formatTodoEntry(
  checkName: string,
  finding: string,
  env: string,
  runDate: string,
  evidencePath: string,
): string {
  return `- **[${runDate}] [${env}] [${checkName}]** ${finding}. Evidence: \`${evidencePath}\`.`;
}

/**
 * Check 7 — Config version consistency verdict (pure, no DB).
 * Returns pass if ACTIVE version exists in HISTORY; fail otherwise.
 */
export function check7ConfigVersionVerdict(
  activeVersion: number,
  historyVersions: number[],
): AuditCheckResult {
  const found = historyVersions.includes(activeVersion);
  return {
    checkName: 'check7_config_version',
    status: found ? 'pass' : 'fail',
    findings: found
      ? [`Config version ${activeVersion} found in history.`]
      : [`ACTIVE_MEMORY_CONSOLIDATION_CONFIG_VERSION=${activeVersion} not found in MEMORY_CONSOLIDATION_CONFIG_HISTORY (available: ${historyVersions.join(', ')}).`],
    evidence: { activeVersion, historyVersions, consistent: found },
  };
}

/** Check 3 flag-state report (pure). Always returns pass with informational finding. */
export function check3FlagStateVerdict(flagEnabled: boolean): AuditCheckResult {
  return {
    checkName: 'check3_flag_state',
    status: 'pass',
    findings: [`MEMORY_CONSOLIDATION_TIER_ENABLED=${flagEnabled}.`],
    evidence: { flagEnabled },
  };
}

// ---------------------------------------------------------------------------
// Narrow drizzle-compatible DB interface for the audit checks
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

interface DrizzleClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute(query: ReturnType<typeof sql>): Promise<any>;
  transaction<T>(fn: (tx: DrizzleClient) => Promise<T>): Promise<T>;
}

function toRows<T extends AnyRecord>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const r = result as { rows?: T[] };
  return r.rows ?? [];
}

// ---------------------------------------------------------------------------
// DB-backed checks (run at audit time)
// ---------------------------------------------------------------------------

/**
 * Check 1 — Tier distribution per tenant.
 * Eligible tenants (>=100 non-deleted entries) must have all four tiers
 * represented after the warmup window. During warmup: warn instead of fail.
 */
async function runCheck1TierDistribution(
  db: DrizzleClient,
  warmupDays: number,
): Promise<AuditCheckResult> {
  try {
    type Row1 = { organisation_id: string; subaccount_id: string; consolidation_tier: string; cnt: string | number; total: string | number };
    const rawRows = toRows<Row1>(await db.execute(sql`
      SELECT
        organisation_id,
        subaccount_id,
        consolidation_tier,
        COUNT(*) AS cnt,
        SUM(COUNT(*)) OVER (PARTITION BY organisation_id, subaccount_id) AS total
      FROM workspace_memory_entries
      WHERE deleted_at IS NULL
      GROUP BY organisation_id, subaccount_id, consolidation_tier
      ORDER BY organisation_id, subaccount_id, consolidation_tier
    `));

    const TIERS = ['working', 'episodic', 'semantic', 'procedural'];
    const MIN_ENTRIES = 100;
    const postWarmup = warmupDays <= 0;

    const tenantMap = new Map<string, { tiers: Set<string>; total: number }>();
    for (const row of rawRows) {
      const key = `${row.organisation_id}:${row.subaccount_id}`;
      if (!tenantMap.has(key)) {
        tenantMap.set(key, { tiers: new Set(), total: Number(row.total) });
      }
      tenantMap.get(key)!.tiers.add(row.consolidation_tier);
    }

    const evidence: Array<{ tenant: string; tiers: string[]; total: number; eligible: boolean; missingTiers: string[] }> = [];
    let anyFail = false;
    let anyWarn = false;

    for (const [key, { tiers, total }] of tenantMap) {
      const eligible = total >= MIN_ENTRIES;
      const missingTiers = TIERS.filter(t => !tiers.has(t));
      evidence.push({ tenant: key, tiers: Array.from(tiers), total, eligible, missingTiers });

      if (!eligible) continue;
      if (missingTiers.length > 0) {
        if (postWarmup) {
          anyFail = true;
        } else {
          anyWarn = true;
        }
      }
    }

    const status = anyFail ? 'fail' : anyWarn ? 'warn' : 'pass';
    const ineligible = evidence.filter(e => !e.eligible).length;
    const findings: string[] = [];
    if (ineligible > 0) findings.push(`${ineligible} tenant(s) below ${MIN_ENTRIES}-entry threshold (n/a for those).`);
    if (anyFail) findings.push('One or more eligible tenants have empty tiers post-warmup.');
    else if (anyWarn) findings.push('Empty tiers detected during warmup window; escalates to fail post-warmup.');
    else findings.push('All eligible tenants have all four tiers represented.');

    return { checkName: 'check1_tier_distribution', status, findings, evidence };
  } catch (err) {
    return {
      checkName: 'check1_tier_distribution',
      status: 'fail',
      findings: [err instanceof Error ? err.message : String(err)],
      evidence: { error: err instanceof Error ? err.message : String(err) },
    };
  }
}

/**
 * Check 2 — Promotion event reconciliation.
 * Counts workspace_memory_entry_tier_transitions rows and checks for
 * persisted invalid transitions per spec §13.2.
 */
async function runCheck2PromotionReconciliation(
  db: DrizzleClient,
  warmupDays: number,
): Promise<AuditCheckResult> {
  try {
    type Row2 = { old_tier: string; new_tier: string; cnt: string | number };
    const tRows = toRows<Row2>(await db.execute(sql`
      SELECT old_tier, new_tier, COUNT(*) AS cnt
      FROM workspace_memory_entry_tier_transitions
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY old_tier, new_tier
    `));

    const invalidRows = tRows.filter(
      r => !isValidPromotionTransition(
        r.old_tier as Parameters<typeof isValidPromotionTransition>[0],
        r.new_tier as Parameters<typeof isValidPromotionTransition>[1],
      )
    );

    const postWarmup = warmupDays <= 0;
    const totalTransitions = tRows.reduce((s, r) => s + Number(r.cnt), 0);

    const findings: string[] = [];
    let status: AuditCheckResult['status'] = 'pass';

    findings.push(`${totalTransitions} tier transition(s) recorded in last 30 days.`);

    if (invalidRows.length > 0) {
      status = 'fail';
      findings.push(`${invalidRows.length} persisted invalid promotion transition(s) detected.`);
    } else if (totalTransitions === 0 && postWarmup) {
      status = 'warn';
      findings.push('No promotion transitions in last 30 days (post-warmup). Expected at least one if flag is ON.');
    } else if (totalTransitions === 0 && !postWarmup) {
      status = 'warn';
      findings.push('No promotion transitions in last 30 days (within warmup window).');
    }

    return {
      checkName: 'check2_promotion_reconciliation',
      status,
      findings,
      evidence: { transitionCounts: tRows, invalidTransitions: invalidRows, warmupDays },
    };
  } catch (err) {
    return {
      checkName: 'check2_promotion_reconciliation',
      status: 'fail',
      findings: [err instanceof Error ? err.message : String(err)],
      evidence: { error: err instanceof Error ? err.message : String(err) },
    };
  }
}

/**
 * Check 4 — Recent retrieval activity.
 * Checks that agent_run_prompts has rows in the last 7 days.
 */
async function runCheck4RetrievalActivity(db: DrizzleClient): Promise<AuditCheckResult> {
  try {
    type Row4 = { cnt: string | number };
    const rawRows = toRows<Row4>(await db.execute(sql`
      SELECT COUNT(*) AS cnt
      FROM agent_run_prompts arp
      JOIN agent_runs ar ON ar.id = arp.agent_run_id
      WHERE ar.started_at >= NOW() - INTERVAL '7 days'
        AND arp.payload IS NOT NULL
    `));
    const cnt = Number(rawRows[0]?.cnt ?? 0);

    if (cnt === 0) {
      return {
        checkName: 'check4_retrieval_activity',
        status: 'warn',
        findings: ['No retrieval traces found in the last 7 days.'],
        evidence: { recentRetrievalCount: cnt },
      };
    }

    return {
      checkName: 'check4_retrieval_activity',
      status: 'pass',
      findings: [`${cnt} retrieval trace(s) found in the last 7 days.`],
      evidence: { recentRetrievalCount: cnt },
    };
  } catch (err) {
    return {
      checkName: 'check4_retrieval_activity',
      status: 'fail',
      findings: [err instanceof Error ? err.message : String(err)],
      evidence: { error: err instanceof Error ? err.message : String(err) },
    };
  }
}

/**
 * Check 5 — Reinforcement batch flush health.
 * 5a: trace-derived activity (distinct days), 5b: last_accessed_at reconciliation.
 * Flag OFF: returns pass (reinforcement is a no-op).
 */
async function runCheck5ReinforcementHealth(
  db: DrizzleClient,
  flagEnabled: boolean,
): Promise<AuditCheckResult> {
  if (!flagEnabled) {
    return {
      checkName: 'check5_reinforcement_health',
      status: 'pass',
      findings: ['Flag OFF — reinforcement batch is a no-op. Check skipped.'],
      evidence: { flagEnabled: false },
    };
  }

  try {
    type Row5a = { distinct_days: string | number };
    const rawDayRows = toRows<Row5a>(await db.execute(sql`
      SELECT COUNT(DISTINCT DATE(ar.started_at)) AS distinct_days
      FROM agent_run_prompts arp
      JOIN agent_runs ar ON ar.id = arp.agent_run_id
      WHERE ar.started_at >= NOW() - INTERVAL '7 days'
        AND arp.payload IS NOT NULL
    `));
    const distinctDays = Number(rawDayRows[0]?.distinct_days ?? 0);

    if (distinctDays === 0) {
      return {
        checkName: 'check5_reinforcement_health',
        status: 'fail',
        findings: ['No reinforcement activity (0 distinct days) in the last 7 days.'],
        evidence: { distinctDays, flagEnabled },
      };
    }

    type Row5b = { entry_id: string; last_accessed_at: string | null };

    // Sample blocks that have recent last_accessed_at (sub-check 5b pass case).
    const rawSampleRows = toRows<Row5b>(await db.execute(sql`
      SELECT id AS entry_id, last_accessed_at
      FROM workspace_memory_entries
      WHERE deleted_at IS NULL
        AND last_accessed_at >= NOW() - INTERVAL '7 days'
      LIMIT 10
    `));

    // Look for blocks with access_count > 0 but stale last_accessed_at (drift indicator).
    const rawDriftedRows = toRows<Row5b>(await db.execute(sql`
      SELECT id AS entry_id, last_accessed_at
      FROM workspace_memory_entries
      WHERE deleted_at IS NULL
        AND (last_accessed_at IS NULL OR last_accessed_at < NOW() - INTERVAL '7 days')
        AND access_count > 0
      LIMIT 10
    `));

    if (rawDriftedRows.length >= 5) {
      return {
        checkName: 'check5_reinforcement_health',
        status: 'fail',
        findings: [
          `${rawDriftedRows.length} blocks with access_count > 0 have stale last_accessed_at (>7 days). Batch flusher may be failing.`,
        ],
        evidence: { distinctDays, driftedSample: rawDriftedRows, flagEnabled },
      };
    }

    return {
      checkName: 'check5_reinforcement_health',
      status: 'pass',
      findings: [
        `${distinctDays} distinct day(s) of reinforcement activity in last 7 days.`,
        `${rawSampleRows.length} recently-accessed blocks sampled; ${rawDriftedRows.length} drift candidate(s).`,
      ],
      evidence: {
        distinctDays,
        recentSample: rawSampleRows,
        driftedSample: rawDriftedRows,
        flagEnabled,
      },
    };
  } catch (err) {
    return {
      checkName: 'check5_reinforcement_health',
      status: 'fail',
      findings: [err instanceof Error ? err.message : String(err)],
      evidence: { error: err instanceof Error ? err.message : String(err) },
    };
  }
}

/**
 * Check 6 — Cross-tenant utility metric via mv_memory_utility_30d.
 * MUST use withAdminConnection (cross-tenant aggregate read).
 * Compare to prior trend log entry if available.
 */
async function runCheck6UtilityTrend(
  db: DrizzleClient,
  priorResult: MemoryConsolidationAuditResult | null,
): Promise<AuditCheckResult> {
  try {
    /* audit-check-6: cross-tenant aggregate — admin read required */
    type Row6 = { agent_id: string; entry_utility_30d: string | null; block_utility_30d: string | null };
    const rawRows = toRows<Row6>(await db.execute(sql`
      SELECT agent_id, entry_utility_30d, block_utility_30d
      FROM mv_memory_utility_30d
      ORDER BY agent_id
    `));

    if (rawRows.length === 0) {
      return {
        checkName: 'check6_utility_trend',
        status: 'warn',
        findings: ['mv_memory_utility_30d is empty. View may not have been refreshed yet.'],
        evidence: { rowCount: 0 },
      };
    }

    const priorCheck6 = priorResult?.checks.find(c => c.checkName === 'check6_utility_trend');
    const priorEvidence = priorCheck6?.evidence as
      | { rows: Array<{ agent_id: string; entry_utility_30d: string | null }> }
      | undefined;

    const findings: string[] = [`${rawRows.length} agent utility row(s) in mv_memory_utility_30d.`];
    let status: AuditCheckResult['status'] = 'pass';

    if (priorEvidence?.rows) {
      const priorMap = new Map(priorEvidence.rows.map(r => [r.agent_id, r.entry_utility_30d]));
      for (const row of rawRows) {
        const priorVal = priorMap.get(row.agent_id);
        if (priorVal == null || row.entry_utility_30d == null) continue;
        const delta = Number(row.entry_utility_30d) - Number(priorVal);
        if (delta < -0.15) {
          status = 'fail';
          findings.push(`Agent ${row.agent_id}: entry utility dropped ${(delta * 100).toFixed(1)}pp (>15pp threshold).`);
        } else if (delta < -0.05 && status !== 'fail') {
          status = 'warn';
          findings.push(`Agent ${row.agent_id}: entry utility dropped ${(delta * 100).toFixed(1)}pp (>5pp threshold).`);
        }
      }
    }

    return {
      checkName: 'check6_utility_trend',
      status,
      findings,
      evidence: { rows: rawRows, priorRunAt: priorResult?.runAt ?? null },
    };
  } catch (err) {
    return {
      checkName: 'check6_utility_trend',
      status: 'fail',
      findings: [err instanceof Error ? err.message : String(err)],
      evidence: { error: err instanceof Error ? err.message : String(err) },
    };
  }
}

// ---------------------------------------------------------------------------
// Trend log helpers
// ---------------------------------------------------------------------------

function readLastTrendEntry(trendLogPath: string): MemoryConsolidationAuditResult | null {
  if (!fs.existsSync(trendLogPath)) return null;
  const content = fs.readFileSync(trendLogPath, 'utf8').trim();
  if (!content) return null;
  const lines = content.split('\n').filter(l => l.trim());
  const last = lines[lines.length - 1];
  try {
    return JSON.parse(last) as MemoryConsolidationAuditResult;
  } catch {
    return null;
  }
}

function appendTrendLog(trendLogPath: string, result: MemoryConsolidationAuditResult): void {
  const dir = path.dirname(trendLogPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.appendFileSync(trendLogPath, JSON.stringify(result) + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// Todo routing
// ---------------------------------------------------------------------------

function routeFailsTodoMd(
  result: MemoryConsolidationAuditResult,
  evidencePath: string,
): void {
  const todoPath = path.resolve(process.cwd(), 'tasks', 'todo.md');
  const runDate = result.runAt.slice(0, 10);
  const newEntries: string[] = [];

  for (const check of result.checks) {
    if (check.status !== 'fail') continue;
    for (const finding of check.findings) {
      newEntries.push(formatTodoEntry(check.checkName, finding, result.env, runDate, evidencePath));
    }
  }

  if (newEntries.length === 0) return;

  const SECTION = '## Deferred from audit-memory-consolidation';
  let existing = '';
  if (fs.existsSync(todoPath)) {
    existing = fs.readFileSync(todoPath, 'utf8');
  }

  if (existing.includes(SECTION)) {
    const updated = existing.replace(SECTION, `${SECTION}\n${newEntries.join('\n')}`);
    fs.writeFileSync(todoPath, updated, 'utf8');
  } else {
    const append = `\n${SECTION}\n${newEntries.join('\n')}\n`;
    fs.appendFileSync(todoPath, append, 'utf8');
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): {
  env: string;
  warmupDays: number;
  out: string | null;
  trendLog: string;
  noTodoRouting: boolean;
} {
  const args = argv.slice(2);
  let env = 'local-dev';
  let warmupDays = 14;
  let out: string | null = null;
  let trendLog: string | null = null;
  let noTodoRouting = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--env' && args[i + 1]) { env = args[++i]; continue; }
    if (a === '--warmup-days' && args[i + 1]) { warmupDays = parseInt(args[++i], 10); continue; }
    if (a === '--out' && args[i + 1]) { out = args[++i]; continue; }
    if (a === '--trend-log' && args[i + 1]) { trendLog = args[++i]; continue; }
    if (a === '--no-todo-routing') { noTodoRouting = true; continue; }
  }

  const defaultTrendLog = path.resolve(
    process.cwd(),
    `scripts/audit/_logs/memory-consolidation-audit-trend-${env}.jsonl`,
  );

  return { env, warmupDays, out, trendLog: trendLog ?? defaultTrendLog, noTodoRouting };
}

async function main(): Promise<void> {
  const { env, warmupDays, out, trendLog: trendLogPath, noTodoRouting } = parseArgs(process.argv);
  const runAt = new Date().toISOString();
  const runDate = runAt.slice(0, 10);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  let exitCode = 0;

  try {
    const priorResult = readLastTrendEntry(trendLogPath);
    const flagEnabled = getMemoryConsolidationTierEnabled();

    /* audit-check-1: cross-tenant aggregate — admin read required */
    const check1 = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE admin_role`);
      return runCheck1TierDistribution(tx as unknown as DrizzleClient, warmupDays);
    });
    /* audit-check-2: cross-tenant aggregate — admin read required */
    const check2 = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE admin_role`);
      return runCheck2PromotionReconciliation(tx as unknown as DrizzleClient, warmupDays);
    });
    const check3 = check3FlagStateVerdict(flagEnabled);
    /* audit-check-4: cross-tenant aggregate — admin read required */
    const check4 = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE admin_role`);
      return runCheck4RetrievalActivity(tx as unknown as DrizzleClient);
    });
    /* audit-check-5: cross-tenant aggregate — admin read required */
    const check5 = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE admin_role`);
      return runCheck5ReinforcementHealth(tx as unknown as DrizzleClient, flagEnabled);
    });

    // Check 6 uses a transaction with admin_role to read the cross-tenant MV.
    const check6 = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE admin_role`);
      /* audit-check-6: cross-tenant aggregate — admin read required */
      return runCheck6UtilityTrend(tx as unknown as DrizzleClient, priorResult);
    });

    const check7 = check7ConfigVersionVerdict(
      ACTIVE_MEMORY_CONSOLIDATION_CONFIG_VERSION,
      MEMORY_CONSOLIDATION_CONFIG_HISTORY.map(c => c.version),
    );

    const checks = [check1, check2, check3, check4, check5, check6, check7];
    const overallStatus = combinedVerdict(checks);

    const result: MemoryConsolidationAuditResult = {
      schemaVersion: 1,
      runAt,
      env,
      warmupDays,
      flagState: flagEnabled ? 'on' : 'off',
      overallStatus,
      checks,
    };

    process.stdout.write(JSON.stringify(result, null, 2) + '\n');

    const defaultOutPath = path.resolve(
      process.cwd(),
      `scripts/audit/_logs/memory-consolidation-audit-${env}-${runDate}.json`,
    );
    const outPath = out ?? defaultOutPath;
    const outDir = path.dirname(outPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');

    appendTrendLog(trendLogPath, result);

    if (overallStatus === 'fail' && !noTodoRouting) {
      try {
        routeFailsTodoMd(result, outPath);
      } catch (todoErr) {
        console.warn('[audit] Warning: failed to write to tasks/todo.md:', todoErr instanceof Error ? todoErr.message : String(todoErr));
      }
    }

    if (overallStatus === 'fail') {
      exitCode = 1;
    }
  } catch (err) {
    console.error('[audit] Fatal error:', err instanceof Error ? err.message : String(err));
    exitCode = 1;
  } finally {
    await pool.end();
  }

  process.exit(exitCode);
}

main();
