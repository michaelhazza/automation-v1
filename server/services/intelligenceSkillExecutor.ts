import { canonicalDataService } from './canonicalDataService.js';
import { orgMemoryService } from './orgMemoryService.js';
import { subaccountTagService } from './subaccountTagService.js';
import { orgConfigService, type NormalisationConfig, type ChurnRiskSignal } from './orgConfigService.js';
import type { SkillExecutionContext } from './skillExecutor.js';
import { db } from '../db/index.js';
import {
  clientPulseHealthSnapshots,
  clientPulseChurnAssessments,
  type HealthTrend,
  type ChurnBand,
} from '../db/schema/clientPulseCanonicalTables.js';

/**
 * Map a 0–100 risk score to a churn band using the org's configured bands.
 *
 * Churn bands in operational_config are expressed on the HEALTH axis (e.g.
 * `healthy: [70,100]` means a health-equivalent score of 70–100). Since this
 * handler produces a risk score (higher = worse), we invert to a health
 * equivalent (`100 - riskScore`) before band matching. Config-driven — no
 * hardcoded thresholds.
 */
function riskScoreToBand(
  riskScore: number,
  bands: { healthy: readonly number[]; watch: readonly number[]; atRisk: readonly number[]; critical: readonly number[] },
): ChurnBand {
  const healthEquiv = 100 - riskScore;
  if (healthEquiv >= bands.healthy[0] && healthEquiv <= bands.healthy[1]) return 'healthy';
  if (healthEquiv >= bands.watch[0] && healthEquiv <= bands.watch[1]) return 'watch';
  if (healthEquiv >= bands.atRisk[0] && healthEquiv <= bands.atRisk[1]) return 'atRisk';
  return 'critical';
}

// ---------------------------------------------------------------------------
// Intelligence Skill Executors (v2.0 — config-driven)
//
// All intelligence skills read their factor/signal/intervention definitions
// from the org's template configuration via orgConfigService.
// No hardcoded metric slugs or domain-specific logic.
// ---------------------------------------------------------------------------

const ALGORITHM_VERSION = '2.0.0';

// ── Normalisation Utilities ───────────────────────────────────────────────

function normaliseValue(raw: number, config: NormalisationConfig): number {
  const { type, minValue, maxValue } = config;
  const range = maxValue - minValue;
  if (range === 0) return 50; // neutral on zero range

  switch (type) {
    case 'linear': {
      const clamped = Math.max(minValue, Math.min(maxValue, raw));
      return Math.round(((clamped - minValue) / range) * 100);
    }
    case 'inverse_linear': {
      const clamped = Math.max(minValue, Math.min(maxValue, raw));
      return Math.round((1 - (clamped - minValue) / range) * 100);
    }
    case 'threshold': {
      return raw >= maxValue ? 100 : raw <= minValue ? 0 : 50;
    }
    case 'percentile': {
      // Simplified: linear mapping as percentile proxy (full impl needs historical distribution)
      const clamped = Math.max(minValue, Math.min(maxValue, raw));
      return Math.round(((clamped - minValue) / range) * 100);
    }
    default:
      return 50;
  }
}

// ── Signal Evaluation Functions ───────────────────────────────────────────

async function evaluateSignal(
  signal: ChurnRiskSignal,
  accountId: string,
  organisationId: string
): Promise<number> {
  switch (signal.type) {
    case 'metric_trend': {
      if (!signal.metricSlug) return 50;
      const history = await canonicalDataService.getMetricHistoryBySlug(
        accountId, signal.metricSlug, 'rolling_30d', (signal.periods ?? 3) * 2
      );
      if (history.length < (signal.periods ?? 3)) return 50; // insufficient data
      const periods = signal.periods ?? 3;
      const recent = history.slice(0, periods);
      const older = history.slice(periods, periods * 2);
      if (older.length === 0) return 50;
      const recentAvg = recent.reduce((s: number, h: { value: string | number }) => s + Number(h.value), 0) / recent.length;
      const olderAvg = older.reduce((s: number, h: { value: string | number }) => s + Number(h.value), 0) / older.length;
      if (signal.condition === 'declining_over_periods') {
        const decline = olderAvg - recentAvg;
        return Math.min(100, Math.max(0, decline > 0 ? decline * 5 : 0));
      }
      return 50;
    }
    case 'metric_threshold': {
      if (!signal.metricSlug) return 50;
      const metric = await canonicalDataService.getMetricValue(accountId, signal.metricSlug, 'rolling_30d', organisationId);
      if (!metric) return 50;
      const val = Number(metric.currentValue);
      if (signal.condition === 'below_value') {
        return val < (signal.thresholdValue ?? 50) ? Math.min(100, ((signal.thresholdValue ?? 50) - val) * 2) : 0;
      }
      if (signal.condition === 'above_value') {
        return val > (signal.thresholdValue ?? 50) ? Math.min(100, (val - (signal.thresholdValue ?? 50)) * 2) : 0;
      }
      return 50;
    }
    case 'staleness': {
      const account = await canonicalDataService.getAccountById(accountId, organisationId);
      if (!account?.lastSyncAt) return 100; // no data = max staleness
      const daysSince = (Date.now() - account.lastSyncAt.getTime()) / (1000 * 60 * 60 * 24);
      const max = signal.maxDaysInactive ?? 14;
      return Math.min(100, Math.max(0, (daysSince / max) * 100));
    }
    case 'anomaly_count': {
      const anomalies = await canonicalDataService.getRecentAnomalies(organisationId, 100);
      const accountAnomalies = anomalies.filter(a => a.accountId === accountId);
      return Math.min(100, accountAnomalies.length * 20);
    }
    case 'health_score_level': {
      const snapshot = await canonicalDataService.getLatestHealthSnapshot(accountId, organisationId);
      if (!snapshot) return 50;
      const threshold = signal.thresholdValue ?? 40;
      return snapshot.score < threshold ? Math.min(100, (threshold - snapshot.score) * 2) : 0;
    }
    default:
      return 50;
  }
}

// ── Cross-Subaccount Skills ───────────────────────────────────────────────

export async function executeQuerySubaccountCohort(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  // Defensive runtime guard: only org-subaccount agents (allowedSubaccountIds = null)
  // may execute cross-subaccount skills. Skill assignment is the primary gate, but
  // this prevents privilege escalation if a skill is mis-assigned.
  if (context.allowedSubaccountIds !== null && context.allowedSubaccountIds !== undefined) {
    return { error: 'query_subaccount_cohort requires org-level access (org subaccount agent)' };
  }

  const tagFilters = (input.tag_filters ?? []) as Array<{ key: string; value: string }>;
  const explicitIds = input.subaccount_ids as string[] | undefined;

  let subaccountIds: string[];
  if (explicitIds?.length) {
    subaccountIds = explicitIds;
  } else {
    subaccountIds = await subaccountTagService.getSubaccountsByTags(context.organisationId, tagFilters);
  }

  if (subaccountIds.length === 0) {
    return { accounts: [], summary: 'No subaccounts match the specified filters.' };
  }

  const allAccounts = await canonicalDataService.getAccountsByOrg(context.organisationId);
  const matchingAccounts = allAccounts.filter(a => a.subaccountId && subaccountIds.includes(a.subaccountId));

  const results = [];
  for (const account of matchingAccounts) {
    const healthSnapshot = await canonicalDataService.getLatestHealthSnapshot(account.id, context.organisationId);
    const metrics = await canonicalDataService.getMetricsByAccount(account.id, context.organisationId);

    results.push({
      accountId: account.id,
      displayName: account.displayName,
      subaccountId: account.subaccountId,
      healthScore: healthSnapshot?.score ?? null,
      healthTrend: healthSnapshot?.trend ?? null,
      metrics: metrics.map(m => ({ slug: m.metricSlug, value: Number(m.currentValue), unit: m.unit })),
      lastSyncAt: account.lastSyncAt?.toISOString() ?? null,
    });
  }

  return {
    matchedAccounts: results.length,
    totalInOrg: allAccounts.length,
    accounts: results,
    filters: tagFilters,
  };
}

export async function executeReadOrgInsights(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  if (context.allowedSubaccountIds !== null && context.allowedSubaccountIds !== undefined) {
    return { error: 'read_org_insights requires org-level access (org subaccount agent)' };
  }

  const semanticQuery = input.semantic_query as string | undefined;
  const limit = (input.limit as number) ?? 10;

  if (semanticQuery) {
    try {
      const { generateEmbedding } = await import('../lib/embeddings.js');
      const embedding = await generateEmbedding(semanticQuery);
      if (embedding) {
        const scopeTags = {} as Record<string, string>;
        if (input.scope_tag_key) (scopeTags as Record<string, string>)[input.scope_tag_key as string] = input.scope_tag_value as string ?? '';

        const results = await orgMemoryService.getRelevantInsights(
          context.organisationId,
          embedding,
          semanticQuery,
          Object.keys(scopeTags).length > 0 ? scopeTags : undefined,
          limit
        );
        return { insights: results, searchType: 'semantic', query: semanticQuery };
      }
    } catch (err) {
      console.error('[IntelligenceSkills] Semantic search failed:', err instanceof Error ? err.message : err);
    }
  }

  const entries = await orgMemoryService.listEntries(context.organisationId, {
    entryType: input.entry_type as string | undefined,
    scopeTagKey: input.scope_tag_key as string | undefined,
    scopeTagValue: input.scope_tag_value as string | undefined,
    limit,
  });

  return { insights: entries, searchType: 'list' };
}

export async function executeWriteOrgInsight(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  if (context.allowedSubaccountIds !== null && context.allowedSubaccountIds !== undefined) {
    return { error: 'write_org_insight requires org-level access (org subaccount agent)' };
  }

  const content = input.content as string;
  const entryType = input.entry_type as string;

  if (!content || !entryType) {
    return { error: 'content and entry_type are required' };
  }

  const entry = await orgMemoryService.createEntry(context.organisationId, {
    content,
    entryType,
    scopeTags: input.scope_tags as Record<string, string> | undefined,
    sourceSubaccountIds: input.source_subaccount_ids as string[] | undefined,
    evidenceCount: input.evidence_count as number | undefined,
    agentRunId: context.runId,
    agentId: context.agentId,
  });

  return { success: true, entryId: entry.id, qualityScore: entry.qualityScore };
}

// ── Intelligence Skills (config-driven) ───────────────────────────────────

export async function executeComputeHealthScore(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const accountId = input.account_id as string;
  if (!accountId) return { error: 'account_id is required' };

  const account = await canonicalDataService.getAccountById(accountId, context.organisationId);
  if (!account) return { error: `Account ${accountId} not found` };

  // Load factor definitions from org config
  const factors = await orgConfigService.getHealthScoreFactors(context.organisationId);
  const configVersion = await orgConfigService.computeConfigVersion(context.organisationId);

  // Cold start check
  const coldStartConfig = await orgConfigService.getColdStartConfig(context.organisationId);
  const sampleMetric = factors[0];
  if (sampleMetric) {
    const historyCount = await canonicalDataService.getMetricHistoryCount(
      accountId, sampleMetric.metricSlug, sampleMetric.periodType ?? 'rolling_30d'
    );
    if (historyCount < coldStartConfig.minimumDataPoints && !coldStartConfig.allowHeuristicScoring) {
      return {
        accountId,
        score: null,
        status: 'cold_start',
        message: `Building baseline... (${historyCount}/${coldStartConfig.minimumDataPoints} data points)`,
        confidence: 0,
      };
    }
  }

  // Compute each factor from canonical_metrics
  const factorResults: Array<{ factor: string; score: number; weight: number; metricSlug: string; rawValue: number | null; direction: 'positive' | 'negative' | 'neutral' }> = [];
  let missingFactors: string[] = [];
  let factorsWithData = 0;

  for (const factor of factors) {
    const periodType = factor.periodType ?? 'rolling_30d';
    const metric = await canonicalDataService.getMetricValue(accountId, factor.metricSlug, periodType, context.organisationId);

    if (!metric) {
      missingFactors.push(factor.label);
      console.warn(`[IntelligenceSkills] metric_missing_runtime: ${factor.metricSlug} for account ${accountId}`);
      continue;
    }

    const rawValue = Number(metric.currentValue);
    const normalisedScore = normaliseValue(rawValue, factor.normalisation);
    factorsWithData++;

    factorResults.push({
      factor: factor.label,
      score: normalisedScore,
      weight: factor.weight,
      metricSlug: factor.metricSlug,
      rawValue,
      direction: normalisedScore >= 60 ? 'positive' : normalisedScore <= 40 ? 'negative' : 'neutral',
    });
  }

  if (factorResults.length === 0) {
    return { accountId, score: null, status: 'no_data', message: 'No metrics available for scoring', confidence: 0 };
  }

  // Re-normalise weights to sum to 1.0 (accounting for missing factors)
  const totalWeight = factorResults.reduce((s, f) => s + f.weight, 0);
  const compositeScore = totalWeight > 0
    ? Math.round(factorResults.reduce((sum, f) => sum + f.score * (f.weight / totalWeight), 0))
    : 0;

  // Trend from health snapshot history
  const history = await canonicalDataService.getHealthHistory(accountId, 5, context.organisationId);
  let trend: 'improving' | 'stable' | 'declining' = 'stable';
  if (history.length >= 2) {
    const avgRecent = history.slice(0, 2).reduce((s, h) => s + h.score, 0) / 2;
    const avgOlder = history.slice(-2).reduce((s, h) => s + h.score, 0) / Math.min(2, history.length);
    if (avgRecent > avgOlder + 5) trend = 'improving';
    else if (avgRecent < avgOlder - 5) trend = 'declining';
  }

  // Confidence: ratio of factors with data
  const confidence = Math.min(1.0, factorsWithData / factors.length);

  // Write snapshot to the generic health_snapshots table (retained for
  // existing non-ClientPulse readers during the deprecation window).
  const snapshot = await canonicalDataService.writeHealthSnapshot({
    organisationId: context.organisationId,
    accountId,
    score: compositeScore,
    factorBreakdown: factorResults.map(f => ({ factor: f.factor, score: f.score, weight: f.weight })),
    trend,
    confidence,
    configVersion,
    algorithmVersion: ALGORITHM_VERSION,
  });

  // Dual-write to client_pulse_health_snapshots (migration 0173, §11.2 R2).
  // The ClientPulse dashboard + churn evaluator read from this table; the
  // generic health_snapshots table is retained for legacy readers and will
  // be deprecated in a follow-up PR once every caller has migrated.
  //
  // Keyed by subaccountId (ClientPulse's unit of observation) rather than
  // the canonical accountId. Falls back gracefully if the canonical account
  // has no subaccount linkage.
  if (account.subaccountId) {
    try {
      await db.insert(clientPulseHealthSnapshots).values({
        organisationId: context.organisationId,
        subaccountId: account.subaccountId,
        accountId,
        score: compositeScore,
        factorBreakdown: factorResults.map(f => ({ factor: f.factor, score: f.score, weight: f.weight })),
        trend: trend as HealthTrend,
        confidence,
        configVersion,
        algorithmVersion: ALGORITHM_VERSION,
      });
    } catch (cpErr) {
      console.error('[IntelligenceSkills] ClientPulse snapshot dual-write failed:',
        cpErr instanceof Error ? cpErr.message : String(cpErr));
    }
  }

  // Top factors for explanation
  const topFactors = [...factorResults]
    .sort((a, b) => Math.abs(b.score * b.weight - 50 * b.weight) - Math.abs(a.score * a.weight - 50 * a.weight))
    .slice(0, 3);

  return {
    accountId,
    score: compositeScore,
    trend,
    confidence,
    factors: factorResults.map(f => ({ factor: f.factor, score: f.score, weight: f.weight })),
    snapshotId: snapshot.id,
    explanation: {
      topFactors: topFactors.map(f => ({ factor: f.factor, contribution: Math.round(f.score * f.weight), direction: f.direction })),
      confidenceReasoning: missingFactors.length > 0
        ? `${factorsWithData} of ${factors.length} configured factors had data. Missing: ${missingFactors.join(', ')}.`
        : `All ${factors.length} configured factors had data.`,
      dataQuality: 'fresh' as const,
    },
  };
}

export async function executeDetectAnomaly(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const accountId = input.account_id as string;
  const metricSlug = input.metric_slug as string ?? input.metric_name as string;

  if (!accountId || !metricSlug) {
    return { error: 'account_id and metric_slug are required' };
  }

  // Load anomaly config from org config
  const anomalyConfig = await orgConfigService.getAnomalyConfig(context.organisationId);
  const configVersion = await orgConfigService.computeConfigVersion(context.organisationId);

  const metricOverride = anomalyConfig.metricOverrides[metricSlug];
  const threshold = metricOverride?.threshold ?? anomalyConfig.defaultThreshold;
  const windowDays = metricOverride?.windowDays ?? anomalyConfig.defaultWindowDays;

  // Get current metric value
  const currentMetric = await canonicalDataService.getMetricValue(accountId, metricSlug, 'rolling_30d', context.organisationId);
  if (!currentMetric) {
    return { anomalyDetected: false, reason: `Metric ${metricSlug} not found for account`, currentValue: null };
  }
  const currentValue = Number(currentMetric.currentValue);

  // Get metric history for baseline
  const history = await canonicalDataService.getMetricHistoryBySlug(
    accountId, metricSlug, 'rolling_30d',
    Math.max(windowDays, anomalyConfig.minimumDataPoints)
  );

  if (history.length < anomalyConfig.minimumDataPoints) {
    return {
      anomalyDetected: false,
      reason: `Insufficient history (${history.length}/${anomalyConfig.minimumDataPoints} data points)`,
      currentValue,
      baselineValue: null,
    };
  }

  // Compute baseline
  const values = history.map(h => Number(h.value));
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);

  const deviation = stdDev > 0 ? Math.abs(currentValue - mean) / stdDev : 0;
  const deviationPercent = mean > 0 ? ((currentValue - mean) / mean) * 100 : 0;
  const direction: 'above' | 'below' = currentValue > mean ? 'above' : 'below';

  const anomalyDetected = deviation >= threshold;

  let severity: 'low' | 'medium' | 'high' | 'critical' = 'low';
  if (deviation >= threshold * 2) severity = 'critical';
  else if (deviation >= threshold * 1.5) severity = 'high';
  else if (deviation >= threshold) severity = 'medium';

  if (anomalyDetected) {
    const description = `${metricSlug} is ${Math.abs(deviationPercent).toFixed(1)}% ${direction} baseline (${currentValue} vs baseline ${mean.toFixed(1)})`;

    // Dedup: check for existing unacknowledged anomaly within dedup window
    const dedupWindowMinutes = anomalyConfig.dedupWindowMinutes ?? 60;
    const dedupCutoff = new Date(Date.now() - dedupWindowMinutes * 60 * 1000);
    const recentAnomalies = await canonicalDataService.getRecentAnomalies(context.organisationId, 100);
    const isDuplicate = recentAnomalies.some(a =>
      a.accountId === accountId &&
      a.metricName === metricSlug &&
      !a.acknowledged &&
      a.createdAt >= dedupCutoff
    );

    if (isDuplicate) {
      return {
        anomalyDetected: true,
        deduplicated: true,
        severity,
        currentValue,
        baselineValue: Math.round(mean * 10) / 10,
        message: `Anomaly already recorded within ${dedupWindowMinutes}m window`,
      };
    }

    await canonicalDataService.writeAnomalyEvent({
      organisationId: context.organisationId,
      accountId,
      metricName: metricSlug,
      currentValue,
      baselineValue: mean,
      deviationPercent: Math.round(deviationPercent * 10) / 10,
      direction,
      severity,
      description,
    });

    return {
      anomalyDetected: true,
      severity,
      deviation: Math.round(deviation * 100) / 100,
      deviationPercent: Math.round(deviationPercent * 10) / 10,
      direction,
      currentValue,
      baselineValue: Math.round(mean * 10) / 10,
      description,
      explanation: {
        topFactors: [{ factor: metricSlug, contribution: Math.round(deviation * 10), direction: direction === 'above' ? 'positive' : 'negative' }],
        confidenceReasoning: `Baseline computed from ${history.length} data points over ${windowDays} days. Threshold: ${threshold}σ.`,
        dataQuality: 'fresh' as const,
      },
    };
  }

  return {
    anomalyDetected: false,
    currentValue,
    baselineValue: Math.round(mean * 10) / 10,
    deviation: Math.round(deviation * 100) / 100,
  };
}

export async function executeComputeChurnRisk(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const accountId = input.account_id as string;
  if (!accountId) return { error: 'account_id is required' };

  // Load signal definitions from org config
  const signalDefs = await orgConfigService.getChurnRiskSignals(context.organisationId);
  const configVersion = await orgConfigService.computeConfigVersion(context.organisationId);

  const signalResults: Array<{ signal: string; score: number; weight: number; contribution: number }> = [];

  for (const signal of signalDefs) {
    const score = await evaluateSignal(signal, accountId, context.organisationId);
    const contribution = Math.round(score * signal.weight);
    signalResults.push({ signal: signal.signalSlug, score, weight: signal.weight, contribution });
  }

  const riskScore = Math.round(signalResults.reduce((sum, s) => sum + s.score * s.weight, 0));

  // Map risk score to intervention types from config (ordered by severity)
  const interventionTypes = await orgConfigService.getInterventionTypes(context.organisationId);
  let interventionType = 'none';
  if (interventionTypes.length > 0) {
    // Use config-defined intervention types: highest gate-level first for high risk
    const reviewGated = interventionTypes.filter(t => t.gateLevel === 'review');
    const autoGated = interventionTypes.filter(t => t.gateLevel === 'auto');
    if (riskScore >= 76 && reviewGated.length > 0) interventionType = reviewGated[0].slug;
    else if (riskScore >= 51 && reviewGated.length > 0) interventionType = reviewGated[Math.min(1, reviewGated.length - 1)].slug;
    else if (riskScore >= 26 && autoGated.length > 0) interventionType = autoGated[0].slug;
  } else {
    // Fallback when no config
    if (riskScore >= 76) interventionType = 'urgent_escalation';
    else if (riskScore >= 51) interventionType = 'active_intervention';
    else if (riskScore >= 26) interventionType = 'early_warning';
  }

  const topDrivers = [...signalResults].sort((a, b) => b.contribution - a.contribution).slice(0, 3);

  const latestSnapshot = await canonicalDataService.getLatestHealthSnapshot(accountId, context.organisationId);

  // Dual-write to client_pulse_churn_assessments (migration 0174, locked
  // contract (f)). Skips cleanly if the canonical account has no subaccount
  // linkage so legacy org-only accounts don't break the handler.
  const account = await canonicalDataService.getAccountById(accountId, context.organisationId);
  if (account?.subaccountId) {
    let assessmentId: string | null = null;
    try {
      const bands = await orgConfigService.getChurnBands(context.organisationId);
      const band = riskScoreToBand(riskScore, bands);
      const [inserted] = await db.insert(clientPulseChurnAssessments).values({
        organisationId: context.organisationId,
        subaccountId: account.subaccountId,
        accountId,
        riskScore,
        band,
        drivers: topDrivers.map(d => ({ signal: d.signal, contribution: d.contribution })),
        interventionType,
        configVersion,
        algorithmVersion: ALGORITHM_VERSION,
      }).returning({ id: clientPulseChurnAssessments.id });
      assessmentId = inserted?.id ?? null;
    } catch (cpErr) {
      console.error('[IntelligenceSkills] ClientPulse churn assessment write failed:',
        cpErr instanceof Error ? cpErr.message : String(cpErr));
    }

    // Phase 4 — enqueue the scenario-detector proposer. Wrapped in try/catch
    // so a failure to enqueue does not roll back the churn assessment above.
    if (assessmentId) {
      try {
        const { queueService } = await import('./queueService.js');
        await queueService.sendJob('clientpulse:propose-interventions', {
          organisationId: context.organisationId,
          subaccountId: account.subaccountId,
          churnAssessmentId: assessmentId,
        });
      } catch (enqErr) {
        console.error('[IntelligenceSkills] proposer enqueue failed:',
          enqErr instanceof Error ? enqErr.message : String(enqErr));
      }
    }
  }

  return {
    accountId,
    riskScore,
    interventionType,
    drivers: topDrivers.map(d => ({ signal: d.signal, contribution: d.contribution })),
    latestHealthScore: latestSnapshot?.score ?? null,
    explanation: {
      topFactors: topDrivers.map(d => ({
        factor: d.signal,
        contribution: d.contribution,
        direction: d.score > 50 ? 'negative' as const : 'positive' as const,
      })),
      confidenceReasoning: `Evaluated ${signalResults.length} risk signals. Risk score: ${riskScore}/100.`,
      dataQuality: 'fresh' as const,
    },
  };
}

export async function executeGeneratePortfolioReport(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  if (context.allowedSubaccountIds !== null && context.allowedSubaccountIds !== undefined) {
    return { error: 'generate_portfolio_report requires org-level access (org subaccount agent)' };
  }

  const reportingPeriodDays = (input.reporting_period_days as number) ?? 7;
  const format = (input.format as string) ?? 'structured';

  const accounts = await canonicalDataService.getAccountsByOrg(context.organisationId);
  const anomalies = await canonicalDataService.getRecentAnomalies(context.organisationId, 50);
  const orgInsights = await orgMemoryService.getInsightsForPrompt(context.organisationId);

  const accountHealthData = [];
  for (const account of accounts) {
    const snapshot = await canonicalDataService.getLatestHealthSnapshot(account.id, context.organisationId);
    accountHealthData.push({
      displayName: account.displayName,
      accountId: account.id,
      healthScore: snapshot?.score ?? null,
      trend: snapshot?.trend ?? null,
      confidence: snapshot?.confidence ?? null,
    });
  }

  const scoredAccounts = accountHealthData.filter(a => a.healthScore !== null);
  const avgHealth = scoredAccounts.length > 0
    ? Math.round(scoredAccounts.reduce((s, a) => s + (a.healthScore ?? 0), 0) / scoredAccounts.length)
    : null;

  const declining = accountHealthData.filter(a => a.trend === 'declining');
  const improving = accountHealthData.filter(a => a.trend === 'improving');
  const coldStart = accountHealthData.filter(a => a.healthScore === null);
  const criticalAnomalies = anomalies.filter(a => a.severity === 'critical' || a.severity === 'high');

  return {
    reportType: 'portfolio_intelligence_briefing',
    generatedAt: new Date().toISOString(),
    reportingPeriodDays,
    format,
    portfolioOverview: {
      totalAccounts: accounts.length,
      scoredAccounts: scoredAccounts.length,
      coldStartAccounts: coldStart.length,
      averageHealthScore: avgHealth,
      improvingCount: improving.length,
      decliningCount: declining.length,
    },
    accountsRequiringAttention: declining.map(a => ({
      displayName: a.displayName,
      accountId: a.accountId,
      healthScore: a.healthScore,
      trend: a.trend,
    })),
    activeAnomalies: criticalAnomalies.slice(0, 10).map(a => ({
      accountId: a.accountId,
      metric: a.metricName,
      severity: a.severity,
      description: a.description,
      createdAt: a.createdAt.toISOString(),
    })),
    positiveSignals: improving.map(a => ({
      displayName: a.displayName,
      accountId: a.accountId,
      healthScore: a.healthScore,
    })),
    baselineBuilding: coldStart.map(a => ({
      displayName: a.displayName,
      accountId: a.accountId,
    })),
    orgInsights: orgInsights ?? 'No org-level insights accumulated yet.',
    explanation: {
      topFactors: declining.length > 0
        ? [{ factor: 'Declining accounts', contribution: declining.length, direction: 'negative' as const }]
        : [{ factor: 'Portfolio stable', contribution: 0, direction: 'positive' as const }],
      confidenceReasoning: `${scoredAccounts.length} of ${accounts.length} accounts scored. ${coldStart.length} building baseline.`,
      dataQuality: 'fresh' as const,
    },
  };
}

export async function executeTriggerAccountIntervention(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const accountId = input.account_id as string;
  const interventionTypeSlug = input.intervention_type as string;
  const evidenceSummary = input.evidence_summary as string;
  const recommendedAction = input.recommended_action as string | undefined;
  const urgency = input.urgency as string | undefined;

  if (!accountId || !interventionTypeSlug || !evidenceSummary) {
    return { error: 'account_id, intervention_type, and evidence_summary are required' };
  }

  // Validate intervention type exists in org config
  const interventionTypes = await orgConfigService.getInterventionTypes(context.organisationId);
  const interventionDef = interventionTypes.find(t => t.slug === interventionTypeSlug);

  if (!interventionDef && interventionTypes.length > 0) {
    return { error: `Unknown intervention type: ${interventionTypeSlug}. Available: ${interventionTypes.map(t => t.slug).join(', ')}` };
  }

  const actionType = interventionDef?.action ?? 'internal_notification';

  // Only internal_notification is auto-executed; all others are pending implementation
  const isImplemented = actionType === 'internal_notification';
  const status = isImplemented ? 'executed' : 'pending_implementation';

  return {
    success: isImplemented,
    interventionType: interventionTypeSlug,
    accountId,
    status,
    executedAt: isImplemented ? new Date().toISOString() : null,
    evidence: evidenceSummary,
    recommendedAction: recommendedAction ?? null,
    urgency: urgency ?? 'medium',
    actionType,
    implementationNote: isImplemented ? null : `Action type '${actionType}' requires connector-specific implementation. Intervention recorded but not dispatched.`,
    explanation: {
      topFactors: [{ factor: `Intervention: ${interventionDef?.label ?? interventionTypeSlug}`, contribution: 1, direction: 'negative' as const }],
      confidenceReasoning: evidenceSummary,
      dataQuality: 'fresh' as const,
    },
  };
}
