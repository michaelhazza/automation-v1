import { canonicalDataService } from './canonicalDataService.js';
import { orgMemoryService } from './orgMemoryService.js';
import { subaccountTagService } from './subaccountTagService.js';
import { workspaceMemoryService } from './workspaceMemoryService.js';
import { taskService } from './taskService.js';
import type { SkillExecutionContext } from './skillExecutor.js';

// ---------------------------------------------------------------------------
// Intelligence Skill Executors
// Called by skillExecutor.ts for Phase 3 intelligence and cross-subaccount skills
// ---------------------------------------------------------------------------

// Default health score weights (overridable via org config in Phase 4)
const DEFAULT_WEIGHTS = {
  pipelineVelocity: 0.30,
  conversationEngagement: 0.25,
  contactGrowth: 0.20,
  revenueTrend: 0.15,
  platformActivity: 0.10,
};

const DEFAULT_ANOMALY_THRESHOLD = 2.0; // standard deviations

// ── Cross-Subaccount Skills ────────────────────────────────────────────────

export async function executeQuerySubaccountCohort(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  if (context.subaccountId) {
    return { error: 'query_subaccount_cohort is only available to org-level agents' };
  }

  const tagFilters = (input.tag_filters ?? []) as Array<{ key: string; value: string }>;
  const explicitIds = input.subaccount_ids as string[] | undefined;

  // Resolve matching subaccounts
  let subaccountIds: string[];
  if (explicitIds?.length) {
    subaccountIds = explicitIds;
  } else {
    subaccountIds = await subaccountTagService.getSubaccountsByTags(context.organisationId, tagFilters);
  }

  if (subaccountIds.length === 0) {
    return { accounts: [], summary: 'No subaccounts match the specified filters.' };
  }

  // Get canonical accounts for these subaccounts
  const allAccounts = await canonicalDataService.getAccountsByOrg(context.organisationId);
  const matchingAccounts = allAccounts.filter(a => a.subaccountId && subaccountIds.includes(a.subaccountId));

  const results = [];
  for (const account of matchingAccounts) {
    const healthSnapshot = await canonicalDataService.getLatestHealthSnapshot(account.id, context.organisationId);
    const contactMetrics = await canonicalDataService.getContactMetrics(account.id, undefined, context.organisationId);
    const oppMetrics = await canonicalDataService.getOpportunityMetrics(account.id, context.organisationId);

    results.push({
      accountId: account.id,
      displayName: account.displayName,
      subaccountId: account.subaccountId,
      healthScore: healthSnapshot?.score ?? null,
      healthTrend: healthSnapshot?.trend ?? null,
      contactGrowthRate: contactMetrics.growthRate,
      pipelineValue: oppMetrics.pipelineValue,
      openDeals: oppMetrics.open,
      staleDeals: oppMetrics.staleDeals,
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
  if (context.subaccountId) {
    return { error: 'read_org_insights is only available to org-level agents' };
  }

  const semanticQuery = input.semantic_query as string | undefined;
  const limit = (input.limit as number) ?? 10;

  if (semanticQuery) {
    // Semantic search
    try {
      const { generateEmbedding } = await import('../lib/embeddings.js');
      const embedding = await generateEmbedding(semanticQuery);
      if (embedding) {
        const scopeTags = {} as Record<string, string>;
        if (input.scope_tag_key) (scopeTags as Record<string, string>)[input.scope_tag_key as string] = input.scope_tag_value as string ?? '';

        const results = await orgMemoryService.getRelevantInsights(
          context.organisationId,
          embedding,
          Object.keys(scopeTags).length > 0 ? scopeTags : undefined,
          limit
        );
        return { insights: results, searchType: 'semantic', query: semanticQuery };
      }
    } catch (err) {
      console.error('[IntelligenceSkills] Semantic search failed, falling back to list retrieval:', err instanceof Error ? err.message : err);
    }
  }

  // List-based retrieval
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
  if (context.subaccountId) {
    return { error: 'write_org_insight is only available to org-level agents' };
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

// ── Intelligence Skills ────────────────────────────────────────────────────

export async function executeComputeHealthScore(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const accountId = input.account_id as string;
  if (!accountId) return { error: 'account_id is required' };

  const account = await canonicalDataService.getAccountById(accountId, context.organisationId);
  if (!account) return { error: `Account ${accountId} not found` };

  // Gather metrics
  const contactMetrics = await canonicalDataService.getContactMetrics(accountId, undefined, context.organisationId);
  const oppMetrics = await canonicalDataService.getOpportunityMetrics(accountId, context.organisationId);
  const convoMetrics = await canonicalDataService.getConversationMetrics(accountId, context.organisationId);
  const revenueMetrics = await canonicalDataService.getRevenueMetrics(accountId, undefined, context.organisationId);

  // Compute factor scores (0-100 each)
  const factors = [];

  // Pipeline velocity: based on open deals and stale deal ratio
  const pipelineScore = oppMetrics.open > 0
    ? Math.max(0, 100 - (oppMetrics.staleDeals / oppMetrics.open) * 100)
    : 50; // neutral if no pipeline
  factors.push({ factor: 'pipeline_velocity', score: Math.round(pipelineScore), weight: DEFAULT_WEIGHTS.pipelineVelocity });

  // Conversation engagement: based on active conversation ratio
  const convoScore = convoMetrics.total > 0
    ? (convoMetrics.active / convoMetrics.total) * 100
    : 50;
  factors.push({ factor: 'conversation_engagement', score: Math.round(convoScore), weight: DEFAULT_WEIGHTS.conversationEngagement });

  // Contact growth: based on growth rate
  const contactScore = Math.min(100, Math.max(0, 50 + contactMetrics.growthRate));
  factors.push({ factor: 'contact_growth', score: Math.round(contactScore), weight: DEFAULT_WEIGHTS.contactGrowth });

  // Revenue trend: simplified — positive revenue = healthy
  const revenueScore = revenueMetrics.totalRevenue > 0 ? 70 : 30;
  factors.push({ factor: 'revenue_trend', score: revenueScore, weight: DEFAULT_WEIGHTS.revenueTrend });

  // Platform activity: based on data freshness
  const daysSinceSync = account.lastSyncAt
    ? (Date.now() - account.lastSyncAt.getTime()) / (1000 * 60 * 60 * 24)
    : 999;
  const activityScore = daysSinceSync < 1 ? 100 : daysSinceSync < 7 ? 70 : daysSinceSync < 30 ? 40 : 10;
  factors.push({ factor: 'platform_activity', score: activityScore, weight: DEFAULT_WEIGHTS.platformActivity });

  // Compute weighted composite
  const compositeScore = Math.round(factors.reduce((sum, f) => sum + f.score * f.weight, 0));

  // Determine trend from history
  const history = await canonicalDataService.getHealthHistory(accountId, 5, context.organisationId);
  let trend: 'improving' | 'stable' | 'declining' = 'stable';
  if (history.length >= 2) {
    const avgRecent = history.slice(0, 2).reduce((s, h) => s + h.score, 0) / 2;
    const avgOlder = history.slice(-2).reduce((s, h) => s + h.score, 0) / Math.min(2, history.length);
    if (avgRecent > avgOlder + 5) trend = 'improving';
    else if (avgRecent < avgOlder - 5) trend = 'declining';
  }

  // Compute confidence based on data completeness
  let dataPoints = 0;
  if (contactMetrics.total > 0) dataPoints++;
  if (oppMetrics.total > 0) dataPoints++;
  if (convoMetrics.total > 0) dataPoints++;
  if (revenueMetrics.transactionCount > 0) dataPoints++;
  if (daysSinceSync < 7) dataPoints++;
  const confidence = Math.min(1.0, dataPoints / 5);

  // Write snapshot
  const snapshot = await canonicalDataService.writeHealthSnapshot({
    organisationId: context.organisationId,
    accountId,
    score: compositeScore,
    factorBreakdown: factors,
    trend,
    confidence,
  });

  return {
    accountId,
    score: compositeScore,
    trend,
    confidence,
    factors,
    snapshotId: snapshot.id,
  };
}

export async function executeDetectAnomaly(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const accountId = input.account_id as string;
  const metricName = input.metric_name as string;
  const currentValue = Number(input.current_value);

  if (!accountId || !metricName || isNaN(currentValue)) {
    return { error: 'account_id, metric_name, and current_value are required' };
  }

  // Get historical baseline from health snapshots
  const history = await canonicalDataService.getHealthHistory(accountId, 30, context.organisationId);
  if (history.length < 3) {
    return {
      anomalyDetected: false,
      reason: 'Insufficient history for baseline (need at least 3 snapshots)',
      currentValue,
      baselineValue: null,
    };
  }

  // Compute baseline mean and standard deviation
  const values = history.map(h => h.score);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);

  const deviation = stdDev > 0 ? Math.abs(currentValue - mean) / stdDev : 0;
  const deviationPercent = mean > 0 ? ((currentValue - mean) / mean) * 100 : 0;
  const direction = currentValue > mean ? 'above' : 'below';

  const anomalyDetected = deviation >= DEFAULT_ANOMALY_THRESHOLD;

  let severity: 'low' | 'medium' | 'high' | 'critical' = 'low';
  if (deviation >= 4) severity = 'critical';
  else if (deviation >= 3) severity = 'high';
  else if (deviation >= 2) severity = 'medium';

  if (anomalyDetected) {
    const description = `${metricName} is ${Math.abs(deviationPercent).toFixed(1)}% ${direction} baseline (${currentValue} vs baseline ${mean.toFixed(1)})`;

    await canonicalDataService.writeAnomalyEvent({
      organisationId: context.organisationId,
      accountId,
      metricName,
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

  // Get recent health snapshot history
  const history = await canonicalDataService.getHealthHistory(accountId, 10, context.organisationId);
  const oppMetrics = await canonicalDataService.getOpportunityMetrics(accountId, context.organisationId);
  const convoMetrics = await canonicalDataService.getConversationMetrics(accountId, context.organisationId);

  const signals: Array<{ signal: string; score: number; weight: number }> = [];

  // Signal 1: Declining health trajectory (compare last 3 to previous 3)
  if (history.length >= 6) {
    const recentAvg = history.slice(0, 3).reduce((s, h) => s + h.score, 0) / 3;
    const olderAvg = history.slice(3, 6).reduce((s, h) => s + h.score, 0) / 3;
    const decline = olderAvg - recentAvg;
    signals.push({ signal: 'health_trajectory', score: Math.min(100, Math.max(0, decline * 5)), weight: 0.30 });
  } else {
    signals.push({ signal: 'health_trajectory', score: 50, weight: 0.30 }); // neutral with insufficient data
  }

  // Signal 2: Pipeline stagnation
  const stagnationScore = oppMetrics.open > 0
    ? Math.min(100, (oppMetrics.staleDeals / oppMetrics.open) * 100)
    : 30;
  signals.push({ signal: 'pipeline_stagnation', score: Math.round(stagnationScore), weight: 0.25 });

  // Signal 3: Conversation engagement decline
  const engagementScore = convoMetrics.total > 0
    ? Math.min(100, Math.max(0, 100 - (convoMetrics.active / convoMetrics.total) * 100))
    : 50;
  signals.push({ signal: 'engagement_decline', score: Math.round(engagementScore), weight: 0.25 });

  // Signal 4: Low health score
  const latestHealth = history[0]?.score ?? 50;
  const lowHealthScore = Math.min(100, Math.max(0, 100 - latestHealth));
  signals.push({ signal: 'low_health', score: lowHealthScore, weight: 0.20 });

  // Compute weighted risk score
  const riskScore = Math.round(signals.reduce((sum, s) => sum + s.score * s.weight, 0));

  // Determine intervention type
  let interventionType: string;
  if (riskScore >= 76) interventionType = 'urgent_escalation';
  else if (riskScore >= 51) interventionType = 'active_intervention';
  else if (riskScore >= 26) interventionType = 'early_warning';
  else interventionType = 'none';

  // Top risk drivers
  const topDrivers = [...signals].sort((a, b) => b.score * b.weight - a.score * a.weight).slice(0, 3);

  return {
    accountId,
    riskScore,
    interventionType,
    drivers: topDrivers.map(d => ({ signal: d.signal, contribution: Math.round(d.score * d.weight) })),
    latestHealthScore: latestHealth,
  };
}

export async function executeGeneratePortfolioReport(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  if (context.subaccountId) {
    return { error: 'generate_portfolio_report is only available to org-level agents' };
  }

  const reportingPeriodDays = (input.reporting_period_days as number) ?? 7;
  const format = (input.format as string) ?? 'structured';

  // Gather portfolio data
  const accounts = await canonicalDataService.getAccountsByOrg(context.organisationId);
  const anomalies = await canonicalDataService.getRecentAnomalies(context.organisationId, 50);
  const orgInsights = await orgMemoryService.getInsightsForPrompt(context.organisationId);

  // Get health snapshots for all accounts
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

  // Compute portfolio summary metrics
  const scoredAccounts = accountHealthData.filter(a => a.healthScore !== null);
  const avgHealth = scoredAccounts.length > 0
    ? Math.round(scoredAccounts.reduce((s, a) => s + (a.healthScore ?? 0), 0) / scoredAccounts.length)
    : null;

  const declining = accountHealthData.filter(a => a.trend === 'declining');
  const improving = accountHealthData.filter(a => a.trend === 'improving');
  const criticalAnomalies = anomalies.filter(a => a.severity === 'critical' || a.severity === 'high');

  return {
    reportType: 'portfolio_intelligence_briefing',
    generatedAt: new Date().toISOString(),
    reportingPeriodDays,
    format,
    portfolioOverview: {
      totalAccounts: accounts.length,
      scoredAccounts: scoredAccounts.length,
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
    orgInsights: orgInsights ?? 'No org-level insights accumulated yet.',
  };
}

export async function executeTriggerAccountIntervention(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  // This skill is HITL-gated (gate level 'review' in actionRegistry)
  // The gate enforcement happens in proposeReviewGatedAction before this executor runs
  // By the time we're here, approval has been granted

  const accountId = input.account_id as string;
  const interventionType = input.intervention_type as string;
  const evidenceSummary = input.evidence_summary as string;
  const recommendedAction = input.recommended_action as string | undefined;
  const urgency = input.urgency as string | undefined;

  if (!accountId || !interventionType || !evidenceSummary) {
    return { error: 'account_id, intervention_type, and evidence_summary are required' };
  }

  // Record the intervention
  return {
    success: true,
    interventionType,
    accountId,
    status: 'executed',
    executedAt: new Date().toISOString(),
    evidence: evidenceSummary,
    recommendedAction: recommendedAction ?? null,
    urgency: urgency ?? 'medium',
    note: 'Intervention executed after HITL approval. The specific execution logic depends on the connector and intervention type — this will be extended in Phase 4 with connector-specific execution paths.',
  };
}
