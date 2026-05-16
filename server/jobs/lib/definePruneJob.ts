import { sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { withOrgTx } from '../../instrumentation.js';
import { withAdminConnection } from '../../lib/adminDbConnection.js';
import { logger } from '../../lib/logger.js';
import { recordSecurityEvent, type SecurityEventInputV2 } from '../../services/securityAuditService.js';

export interface PruneJobConfig {
  source: string;
  /** Simple SQL identifier (^[a-z][a-z0-9_]*$) — runtime-validated before sql.raw(). */
  table: string;
  /** Retention in whole days. Mutually exclusive with `retentionMillis`. */
  retentionDays?: number;
  /** Retention in milliseconds — for sub-day windows (e.g. webhook nonce dedup
   *  uses 10 minutes). Mutually exclusive with `retentionDays`. */
  retentionMillis?: number;
  /** Simple SQL identifier (^[a-z][a-z0-9_]*$) — runtime-validated before sql.raw(). */
  cutoffColumn: string;
  batchSize?: number;
  preDeleteGUC?: { name: string; value: string };
  /** Appended inside the cutoff condition parens: `AND (cutoffColumn < cutoff ${extraWhere})`.
   *  Must start with `AND` or `OR` — runtime-validated to prevent arbitrary SQL concatenation. */
  extraWhere?: string;
  emitSecurityEvent?: { event: SecurityEventInputV2['event'] };
}

export interface PruneJobResult {
  status: 'success' | 'partial' | 'failed';
  orgsAttempted: number;
  orgsSucceeded: number;
  orgsFailed: number;
  rowsDeleted: number;
  durationMs: number;
}

export function computePruneStatus(orgsSucceeded: number, orgsFailed: number): 'success' | 'partial' | 'failed' {
  if (orgsFailed === 0) return 'success';
  if (orgsSucceeded === 0) return 'failed';
  return 'partial';
}

export function definePruneJob(config: PruneJobConfig): () => Promise<PruneJobResult> {
  const { source, table, retentionDays, retentionMillis, cutoffColumn, batchSize, preDeleteGUC, extraWhere, emitSecurityEvent } = config;
  if (!/^[a-z][a-z0-9_]*$/.test(table)) {
    throw new Error(`definePruneJob: table must be a simple SQL identifier, got: ${JSON.stringify(table)}`);
  }
  if (!/^[a-z][a-z0-9_]*$/.test(cutoffColumn)) {
    throw new Error(`definePruneJob: cutoffColumn must be a simple SQL identifier, got: ${JSON.stringify(cutoffColumn)}`);
  }
  if (extraWhere !== undefined && !/^(AND|OR)\s/i.test(extraWhere)) {
    throw new Error(`definePruneJob: extraWhere must start with AND or OR, got: ${JSON.stringify(extraWhere)}`);
  }
  const hasDays = typeof retentionDays === 'number';
  const hasMillis = typeof retentionMillis === 'number';
  if (hasDays === hasMillis) {
    throw new Error('definePruneJob: exactly one of retentionDays or retentionMillis must be provided');
  }
  const offsetMillis = hasMillis ? retentionMillis! : retentionDays! * 86_400_000;
  const tableRaw = sql.raw(table);
  const columnRaw = sql.raw(cutoffColumn);
  const extra = extraWhere ? sql.raw(` ${extraWhere}`) : sql.raw('');

  return async function runPruneJob(): Promise<PruneJobResult> {
    const jobRunId = crypto.randomUUID();
    const startedAt = Date.now();
    const cutoff = new Date(Date.now() - offsetMillis);

    logger.info(`${source}.started`, { jobRunId, scheduledAt: new Date().toISOString(), cutoff: cutoff.toISOString(), retentionDays, retentionMillis });

    let orgs: Array<{ id: string }>;
    try {
      orgs = await withAdminConnection(
        { source, reason: `Daily cross-org prune of ${table}: enumerate orgs`, skipAudit: true },
        async (tx) => {
          await tx.execute(sql`SET LOCAL ROLE admin_role`);
          return (await tx.execute(sql`SELECT id FROM organisations`)) as unknown as Array<{ id: string }>;
        },
      );
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const result: PruneJobResult = { status: 'failed', orgsAttempted: 0, orgsSucceeded: 0, orgsFailed: 0, rowsDeleted: 0, durationMs };
      logger.error(`${source}.completed`, { jobRunId, ...result, error: err instanceof Error ? err.message : String(err) });
      return result;
    }

    let orgsSucceeded = 0;
    let orgsFailed = 0;
    let rowsDeleted = 0;

    for (const org of orgs) {
      logger.info(`${source}.org_started`, { jobRunId, orgId: org.id });
      const orgStart = Date.now();
      try {
        let orgRowsDeleted = 0;

        if (batchSize) {
          let batchCount = 0;
          while (true) {
            const batchDeleted = await db.transaction(async (orgTx) => {
              await orgTx.execute(sql`SELECT set_config('app.organisation_id', ${org.id}, true)`);
              return withOrgTx(
                { tx: orgTx, organisationId: org.id, source: `${source}:per-org-batch` },
                async () => {
                  if (preDeleteGUC) {
                    await orgTx.execute(sql`SELECT set_config(${preDeleteGUC.name}, ${preDeleteGUC.value}, true)`);
                  }
                  const deleted = (await orgTx.execute(
                    sql`DELETE FROM ${tableRaw}
                        WHERE id IN (
                          SELECT id FROM ${tableRaw}
                          WHERE organisation_id = ${org.id}::uuid
                            AND (${columnRaw} < ${cutoff}${extra})
                          ORDER BY ${columnRaw} ASC, id ASC
                          LIMIT ${batchSize}
                          FOR UPDATE SKIP LOCKED
                        )
                        RETURNING id`,
                  )) as unknown as Array<{ id: string }>;
                  return deleted.length;
                },
              );
            });
            orgRowsDeleted += batchDeleted;
            batchCount++;
            if (batchDeleted < batchSize) break;
            logger.debug(`${source}.batch_completed`, { jobRunId, orgId: org.id, batchCount, batchDeleted });
          }
        } else {
          orgRowsDeleted = await db.transaction(async (orgTx) => {
            await orgTx.execute(sql`SELECT set_config('app.organisation_id', ${org.id}, true)`);
            return withOrgTx(
              { tx: orgTx, organisationId: org.id, source: `${source}:per-org` },
              async () => {
                if (preDeleteGUC) {
                  await orgTx.execute(sql`SELECT set_config(${preDeleteGUC.name}, ${preDeleteGUC.value}, true)`);
                }
                const deleted = (await orgTx.execute(
                  sql`DELETE FROM ${tableRaw}
                      WHERE organisation_id = ${org.id}::uuid
                        AND (${columnRaw} < ${cutoff}${extra})
                      RETURNING id`,
                )) as unknown as Array<{ id: string }>;
                return deleted.length;
              },
            );
          });
        }

        rowsDeleted += orgRowsDeleted;
        orgsSucceeded++;
        const orgDurationMs = Date.now() - orgStart;
        logger.info(`${source}.org_completed`, { jobRunId, orgId: org.id, rowsDeleted: orgRowsDeleted, durationMs: orgDurationMs, status: 'success' });

        if (emitSecurityEvent) {
          await recordSecurityEvent({
            event: emitSecurityEvent.event,
            organisationId: org.id,
            meta: { rowsDeleted: orgRowsDeleted, durationMs: orgDurationMs },
          });
        }
      } catch (err) {
        orgsFailed++;
        logger.error(`${source}.org_failed`, {
          jobRunId,
          orgId: org.id,
          error: err instanceof Error ? err.message : String(err),
          errorClass: err instanceof Error ? 'tx_failure' : 'unknown',
          status: 'failed',
        });
      }
    }

    const result: PruneJobResult = {
      status: computePruneStatus(orgsSucceeded, orgsFailed),
      orgsAttempted: orgs.length,
      orgsSucceeded,
      orgsFailed,
      rowsDeleted,
      durationMs: Date.now() - startedAt,
    };

    logger.info(`${source}.completed`, { jobRunId, ...result });
    return result;
  };
}
