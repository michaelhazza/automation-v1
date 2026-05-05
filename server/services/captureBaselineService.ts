import { and, eq, sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { subaccountBaselines } from '../db/schema/subaccountBaselines.js';
import { subaccountBaselineMetrics } from '../db/schema/subaccountBaselineMetrics.js';
import { subaccounts } from '../db/schema/subaccounts.js';
import { createEvent } from '../lib/tracing.js';
import { logger } from '../lib/logger.js';
import { resolveBaselineOptIn } from '../../shared/schemas/subaccount.js';
import {
  metricMeta,
  type BaselineMetricSlug,
} from '../../shared/constants/baselineMetrics.js';
import {
  METRIC_READERS,
  UNAVAILABLE_INTEGRATION_NOT_CONNECTED,
  type MetricReaderResult,
} from './baselineMetricReaders/registry.js';
import {
  aggregateOutcome,
  isRetryBudgetExhausted,
  nextBackoffMinutes,
} from './baselineRetryClassifierPure.js';

export const captureBaselineService = {
  /**
   * F3 §5 — main capture flow. Called from captureBaselineJobHandler which wraps the
   * call in db.transaction + set_config + withOrgTx so that getOrgScopedDb() works and
   * the RLS app.organisation_id GUC is in effect for the duration of the job.
   */
  async run({
    baselineId,
    organisationId,
    subaccountId,
  }: {
    baselineId: string;
    organisationId: string;
    subaccountId: string;
  }): Promise<void> {
    const orgDb = getOrgScopedDb('captureBaselineService.run');

    // Step 0: cheap idempotency guard at the worker entrypoint.
    const [current] = await orgDb
      .select({ status: subaccountBaselines.status })
      .from(subaccountBaselines)
      .where(eq(subaccountBaselines.id, baselineId));
    if (!current) {
      logger.info('baseline.capture.lock_miss', { event: 'baseline.capture.lock_miss', baseline_id: baselineId, reason: 'not_found' });
      return;
    }
    if (current.status === 'captured' || current.status === 'failed'
        || current.status === 'manual' || current.status === 'reset') {
      logger.info('baseline.capture.lock_miss', { event: 'baseline.capture.lock_miss', baseline_id: baselineId, reason: 'pre_read_terminal', status: current.status });
      return;
    }
    if (current.status === 'capturing') {
      logger.info('baseline.capture.lock_miss', { event: 'baseline.capture.lock_miss', baseline_id: baselineId, reason: 'not_runnable', status: current.status });
      return;
    }

    // Step 1: acquire capturing lock
    const locked = await orgDb.execute(sql`
      UPDATE subaccount_baselines
      SET status = 'capturing', last_attempt_at = now()
      WHERE id = ${baselineId}
        AND status IN ('pending', 'ready')
      RETURNING id, capture_attempt_count
    `);
    const lockedRow = (locked as unknown as { rows: Array<{ id: string; capture_attempt_count: number }> }).rows[0];
    if (!lockedRow) {
      logger.info('baseline.capture.lock_miss', { event: 'baseline.capture.lock_miss', baseline_id: baselineId, reason: 'lock_race' });
      return;
    }

    const captureStartHr = process.hrtime.bigint();
    const attemptNumber = lockedRow.capture_attempt_count + 1;

    createEvent('baseline.capture.started', {
      subaccount_id: subaccountId, baseline_id: baselineId, attempt_number: attemptNumber, version: 1,
    });

    // Step 2: read opted-in metric set
    const [sub] = await orgDb
      .select({ settings: subaccounts.settings })
      .from(subaccounts)
      .where(and(
        eq(subaccounts.id, subaccountId),
        eq(subaccounts.organisationId, organisationId),
      ));
    const optedIn = resolveBaselineOptIn(sub?.settings ?? null);

    // Step 3: per-metric dispatch with 5s timeout
    const READER_TIMEOUT_MS = 5_000;
    const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('reader_timeout')), ms);
        p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
      });

    interface PerMetricEntry {
      slug: BaselineMetricSlug;
      result: MetricReaderResult;
      durationMs: number;
      timedOut: boolean;
    }
    const perMetric: PerMetricEntry[] = [];
    for (const slug of optedIn) {
      const meta = metricMeta(slug);
      const readerStartHr = process.hrtime.bigint();
      let result: MetricReaderResult;
      let timedOut = false;
      try {
        if (meta.readerStatus === 'unavailable_default') {
          result = UNAVAILABLE_INTEGRATION_NOT_CONNECTED;
        } else {
          const reader = METRIC_READERS[slug];
          if (!reader) {
            result = { value: null, source: 'unavailable', unavailable_reason: 'integration_not_connected', errorClass: 'non_retryable' };
          } else {
            result = await withTimeout(reader({ organisationId, subaccountId }), READER_TIMEOUT_MS);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        timedOut = msg === 'reader_timeout';
        result = { value: null, source: 'unavailable', unavailable_reason: 'api_failure', errorClass: 'retryable' };
      }
      const readerDurationMs = Number(process.hrtime.bigint() - readerStartHr) / 1_000_000;
      perMetric.push({ slug, result, durationMs: readerDurationMs, timedOut });

      if (result.source === 'canonical_metric' && result.value) {
        createEvent('baseline.metric.captured', {
          subaccount_id: subaccountId, baseline_id: baselineId, metric_slug: slug,
          source: 'canonical_metric',
          value_summary: { unit: result.value.unit, numeric: result.value.numeric },
          duration_ms: readerDurationMs,
        });
      } else {
        createEvent('baseline.metric.unavailable', {
          subaccount_id: subaccountId, baseline_id: baselineId, metric_slug: slug,
          unavailable_reason: result.unavailable_reason,
          error_class: result.errorClass ?? 'retryable',
          duration_ms: readerDurationMs,
          ...(timedOut ? { timed_out: true, timeout_ms: READER_TIMEOUT_MS, elapsed_ms: readerDurationMs } : {}),
        });
      }
    }

    // Step 4: idempotent metric upsert
    for (const { slug, result } of perMetric) {
      const valueJson = result.value ?? { numeric: 0, unit: metricMeta(slug).unit };
      await orgDb.execute(sql`
        INSERT INTO subaccount_baseline_metrics (baseline_id, metric_slug, value, source, unavailable_reason)
        VALUES (${baselineId}, ${slug}, ${JSON.stringify(valueJson)}::jsonb, ${result.source}, ${result.unavailable_reason ?? null})
        ON CONFLICT (baseline_id, metric_slug)
        DO UPDATE SET
          value = EXCLUDED.value,
          source = EXCLUDED.source,
          unavailable_reason = EXCLUDED.unavailable_reason,
          captured_at = now()
      `);
    }

    // Step 5: final-state decision
    const outcome = aggregateOutcome(
      perMetric.map((m) => ({
        source: m.result.source,
        errorClass: m.result.errorClass,
        unavailableReason: m.result.unavailable_reason,
      })),
      optedIn.length,
    );

    if (outcome.kind === 'success') {
      await orgDb.update(subaccountBaselines)
        .set({ status: 'captured', capturedAt: sql`now()`, confidence: outcome.confidence, readyAt: sql`COALESCE(ready_at, now())`, nextAttemptAt: null })
        .where(eq(subaccountBaselines.id, baselineId));
      createEvent('baseline.capture.succeeded', {
        subaccount_id: subaccountId, baseline_id: baselineId, confidence: outcome.confidence,
        metrics_captured_count: perMetric.filter((m) => m.result.source === 'canonical_metric').length,
        metrics_unavailable_count: perMetric.filter((m) => m.result.source === 'unavailable').length,
        duration_ms: Number(process.hrtime.bigint() - captureStartHr) / 1_000_000,
      });
      return;
    }

    if (outcome.kind === 'non_retryable_failure') {
      await orgDb.update(subaccountBaselines)
        .set({ status: 'failed', failureReason: outcome.reason, captureAttemptCount: attemptNumber, nextAttemptAt: null })
        .where(eq(subaccountBaselines.id, baselineId));
      createEvent('baseline.capture.failed', {
        subaccount_id: subaccountId, baseline_id: baselineId,
        failure_reason: outcome.reason, final_attempt_count: attemptNumber,
        duration_ms: Number(process.hrtime.bigint() - captureStartHr) / 1_000_000,
      });
      return;
    }

    // retryable_failure
    if (isRetryBudgetExhausted(attemptNumber)) {
      await orgDb.update(subaccountBaselines)
        .set({ status: 'failed', failureReason: 'retry_budget_exhausted', captureAttemptCount: attemptNumber, nextAttemptAt: null })
        .where(eq(subaccountBaselines.id, baselineId));
      createEvent('baseline.capture.failed', {
        subaccount_id: subaccountId, baseline_id: baselineId,
        failure_reason: 'retry_budget_exhausted', final_attempt_count: attemptNumber,
        duration_ms: Number(process.hrtime.bigint() - captureStartHr) / 1_000_000,
      });
      return;
    }

    const backoffMin = nextBackoffMinutes(attemptNumber)!;
    const updated = await orgDb.update(subaccountBaselines)
      .set({ status: 'ready', captureAttemptCount: attemptNumber, nextAttemptAt: sql`now() + (${backoffMin} || ' minutes')::interval` })
      .where(eq(subaccountBaselines.id, baselineId))
      .returning({ nextAttemptAt: subaccountBaselines.nextAttemptAt });

    createEvent('baseline.capture.retry_scheduled', {
      subaccount_id: subaccountId, baseline_id: baselineId,
      attempt_number: attemptNumber,
      next_attempt_at: updated[0]?.nextAttemptAt ?? null,
      failure_reasons: perMetric.filter((m) => m.result.source === 'unavailable').map((m) => m.result.unavailable_reason ?? 'no_data_yet'),
      duration_ms: Number(process.hrtime.bigint() - captureStartHr) / 1_000_000,
    });
  },

  /**
   * F3 §6 — manual entry. Called from authenticated HTTP route (inside HTTP middleware
   * withOrgTx), so getOrgScopedDb() resolves correctly.
   */
  async runManual(params: {
    organisationId: string;
    subaccountId: string;
    userId: string;
    metricInputs: Array<{ slug: BaselineMetricSlug; numeric: number; currency?: string }>;
  }): Promise<void> {
    const orgDb = getOrgScopedDb('captureBaselineService.runManual');

    const [baseline] = await orgDb
      .select({ id: subaccountBaselines.id, source: subaccountBaselines.source, status: subaccountBaselines.status })
      .from(subaccountBaselines)
      .where(and(
        eq(subaccountBaselines.subaccountId, params.subaccountId),
        eq(subaccountBaselines.organisationId, params.organisationId),
        sql`status <> 'reset'`,
      ));
    if (!baseline) {
      throw { statusCode: 404, errorCode: 'BASELINE_NOT_FOUND', message: 'No active baseline for this subaccount' };
    }

    if (baseline.status === 'capturing') {
      throw { statusCode: 409, errorCode: 'BASELINE_CAPTURING', message: 'Auto capture in flight; retry shortly' };
    }

    // F3 §6 — lead_count must not exceed the all-time-high observed in
    // canonical_metric_history for this subaccount. Sanity check against
    // order-of-magnitude data-entry mistakes; no-op if no history exists yet.
    const leadCountInput = params.metricInputs.find((m) => m.slug === 'lead_count');
    if (leadCountInput) {
      const result = await orgDb.execute<{ high: string | null }>(sql`
        SELECT MAX(cmh.value::numeric)::text AS high
        FROM canonical_metric_history cmh
        INNER JOIN canonical_accounts ca ON ca.id = cmh.account_id
        WHERE ca.organisation_id = ${params.organisationId}
          AND ca.subaccount_id = ${params.subaccountId}
          AND cmh.metric_slug = 'lead_count'
      `);
      const rows = (result as unknown as { rows?: { high: string | null }[] }).rows
        ?? (result as unknown as { high: string | null }[]);
      const highRaw = Array.isArray(rows) && rows.length > 0 ? rows[0]?.high : null;
      if (highRaw !== null && highRaw !== undefined) {
        const high = Number(highRaw);
        if (Number.isFinite(high) && leadCountInput.numeric > high) {
          throw {
            statusCode: 400,
            errorCode: 'LEAD_COUNT_EXCEEDS_HISTORICAL_HIGH',
            message: `lead_count (${leadCountInput.numeric}) exceeds historical maximum (${high})`,
          };
        }
      }
    }

    const overridden: BaselineMetricSlug[] = [];
    for (const input of params.metricInputs) {
      const meta = metricMeta(input.slug);
      await orgDb.execute(sql`
        INSERT INTO subaccount_baseline_metrics (baseline_id, metric_slug, value, source)
        VALUES (
          ${baseline.id},
          ${input.slug},
          ${JSON.stringify({ numeric: input.numeric, ...(input.currency ? { currency: input.currency } : {}), unit: meta.unit })}::jsonb,
          'manual'
        )
        ON CONFLICT (baseline_id, metric_slug)
        DO UPDATE SET
          value = EXCLUDED.value,
          source = 'manual',
          unavailable_reason = NULL,
          captured_at = now()
      `);
      overridden.push(input.slug);
    }

    const allRows = await orgDb
      .select({ source: subaccountBaselineMetrics.source })
      .from(subaccountBaselineMetrics)
      .where(eq(subaccountBaselineMetrics.baselineId, baseline.id));
    // Spec §6 — 'mixed' means at least one row has a canonical-metric source.
    // Treating 'unavailable' as non-manual (the prior coding) caused fully-manual
    // overrides on top of unavailable readers to be misclassified as 'mixed'.
    const hasCanonical = allRows.some((r) => r.source === 'canonical_metric');
    const newSource: 'manual' | 'mixed' = hasCanonical ? 'mixed' : 'manual';

    const captured = allRows.filter((r) => r.source === 'canonical_metric' || r.source === 'manual').length;
    const [sub] = await orgDb
      .select({ settings: subaccounts.settings })
      .from(subaccounts)
      .where(and(
        eq(subaccounts.id, params.subaccountId),
        eq(subaccounts.organisationId, params.organisationId),
      ));
    const optedIn = resolveBaselineOptIn(sub?.settings ?? null);
    const newConfidence: 'confirmed' | 'partial' =
      optedIn.length > 0 && captured >= optedIn.length ? 'confirmed' : 'partial';

    const result = await orgDb
      .update(subaccountBaselines)
      .set({
        status: 'manual',
        source: newSource,
        confidence: newConfidence,
        capturedAt: sql`COALESCE(captured_at, now())`,
        nextAttemptAt: null,
      })
      .where(and(
        eq(subaccountBaselines.id, baseline.id),
        sql`status <> 'capturing'`,
      ))
      .returning({ id: subaccountBaselines.id });
    if (result.length === 0) {
      throw { statusCode: 409, errorCode: 'BASELINE_CAPTURING', message: 'Auto capture in flight; retry shortly' };
    }

    createEvent('baseline.manual.applied', {
      subaccount_id: params.subaccountId,
      baseline_id: baseline.id,
      user_id: params.userId,
      metrics_overridden: overridden,
    });
  },

  /**
   * F3 §6 — admin reset. Sysadmin entrypoint; resolves the target organisation
   * from the prior baseline row inside a `withAdminConnection` transaction
   * (`SET LOCAL ROLE admin_role` bypasses RLS so the lookup is cross-org).
   * Caller passes only `subaccountId` — the route does not perform an org lookup.
   */
  async adminReset(params: {
    subaccountId: string;
    userId: string;
    reason: string;
  }): Promise<{ priorBaselineId: string; newBaselineId: string; newVersion: number; organisationId: string }> {
    return withAdminConnection(
      {
        source: 'captureBaselineService.adminReset',
        reason: `sysadmin reset: ${params.reason}`,
      },
      async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE admin_role`);

        const [prior] = await tx
          .select({
            id: subaccountBaselines.id,
            version: subaccountBaselines.baselineVersion,
            organisationId: subaccountBaselines.organisationId,
          })
          .from(subaccountBaselines)
          .where(and(
            eq(subaccountBaselines.subaccountId, params.subaccountId),
            sql`status <> 'reset'`,
          ));
        if (!prior) {
          throw { statusCode: 404, errorCode: 'BASELINE_NOT_FOUND' };
        }

        await tx
          .update(subaccountBaselines)
          .set({
            status: 'reset',
            resetAt: sql`now()`,
            resetByUserId: params.userId,
            adminResetReason: params.reason,
          })
          .where(eq(subaccountBaselines.id, prior.id));

        const newVersion = prior.version + 1;
        const [inserted] = await tx
          .insert(subaccountBaselines)
          .values({
            organisationId: prior.organisationId,
            subaccountId: params.subaccountId,
            baselineVersion: newVersion,
            status: 'pending',
          })
          .returning({ id: subaccountBaselines.id });

        createEvent('baseline.admin_reset', {
          subaccount_id: params.subaccountId,
          prior_baseline_id: prior.id,
          new_baseline_id: inserted.id,
          prior_version: prior.version,
          new_version: newVersion,
          user_id: params.userId,
          reason: params.reason,
        });

        return {
          priorBaselineId: prior.id,
          newBaselineId: inserted.id,
          newVersion,
          organisationId: prior.organisationId,
        };
      },
    );
  },
};
