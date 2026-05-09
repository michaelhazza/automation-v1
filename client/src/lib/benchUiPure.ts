// client/src/lib/benchUiPure.ts
// Pure UI helpers for the Model Bench page.
// Trust & Verification Layer spec §12.4, §14.
// All exports are pure: no DOM, no API, no side effects.

// ── formatCostEstimate ────────────────────────────────────────────────────────

/**
 * Formats a cost in cents into a human-readable dollar string.
 * < 1 cent → "< $0.01"
 * >= 1 cent → "$X.XX"
 */
export function formatCostEstimate(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  if (cents < 1) return '< $0.01';
  return `$${(cents / 100).toFixed(2)}`;
}

// ── formatVerdict ─────────────────────────────────────────────────────────────

const VERDICT_LABEL: Record<string, string> = {
  pass: 'Pass',
  fail: 'Fail',
  inconclusive: 'Inconclusive',
  error: 'Error',
};

export function formatVerdict(verdict: string | null | undefined): string {
  if (!verdict) return '—';
  return VERDICT_LABEL[verdict] ?? verdict;
}

// ── riskPillClass ─────────────────────────────────────────────────────────────

/**
 * Returns Tailwind classes for a regression-risk pill.
 * low → green, medium → amber, high → red.
 */
export function riskPillClass(risk: 'low' | 'medium' | 'high' | null | undefined): string {
  switch (risk) {
    case 'low':    return 'bg-green-100 text-green-800';
    case 'medium': return 'bg-amber-100 text-amber-800';
    case 'high':   return 'bg-red-100 text-red-800';
    default:       return 'bg-slate-100 text-slate-600';
  }
}

// ── riskLabel ─────────────────────────────────────────────────────────────────

export function riskLabel(risk: 'low' | 'medium' | 'high' | null | undefined): string {
  switch (risk) {
    case 'low':    return 'Low risk';
    case 'medium': return 'Medium risk';
    case 'high':   return 'High risk';
    default:       return 'Unknown';
  }
}

// ── benchStateLabel ───────────────────────────────────────────────────────────

export function benchStateLabel(state: string | null | undefined): string {
  switch (state) {
    case 'awaiting_confirm':  return 'Awaiting confirmation';
    case 'running':           return 'Running';
    case 'awaiting_approval': return 'Awaiting approval';
    case 'completed':         return 'Completed';
    case 'partial':           return 'Partial';
    case 'failed':            return 'Failed';
    case 'cancelled':         return 'Cancelled';
    default:                  return state ?? '—';
  }
}

// ── verdictPassRate ───────────────────────────────────────────────────────────

/**
 * Computes the pass rate (0–1) for a given candidate from bench results.
 */
export function verdictPassRate(
  results: Array<{ candidateModelId: string; verdict: string | null | undefined }>,
  candidateModelId: string,
): number {
  const rows = results.filter(r => r.candidateModelId === candidateModelId);
  if (rows.length === 0) return 0;
  const passes = rows.filter(r => r.verdict === 'pass').length;
  return passes / rows.length;
}

// ── formatPassRate ────────────────────────────────────────────────────────────

export function formatPassRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

// ── computeRegressionRisk ─────────────────────────────────────────────────────
// Mirror of server scorecardServicePure.computeRegressionRisk (spec §6.6).

export function computeRegressionRisk(
  variance: number,
  sampleCount: number,
): 'low' | 'medium' | 'high' {
  if (!Number.isFinite(variance) || !Number.isFinite(sampleCount) || variance < 0 || sampleCount < 0) {
    return 'high';
  }
  if (variance >= 0.15) return 'high';
  if (variance < 0.05) {
    return sampleCount >= 5 ? 'low' : 'medium';
  }
  return 'medium';
}
