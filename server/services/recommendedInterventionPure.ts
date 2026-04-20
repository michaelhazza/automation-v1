// ---------------------------------------------------------------------------
// Outcome-weighted intervention recommendation (spec §5.2). Pure decision fn
// consumed by clientPulseInterventionContextService.buildInterventionContext.
// ---------------------------------------------------------------------------

export interface OutcomeAggregate {
  templateSlug: string;
  bandBefore: string;
  trials: number;
  improvedCount: number;
  avgScoreDelta: number;
}

export interface TemplateCandidate {
  slug: string;
  priority: number;
  actionType: string;
}

export type RecommendationReason = 'outcome_weighted' | 'priority_fallback' | 'no_candidates';

export interface RecommendationPick {
  pickedSlug: string;
  reason: RecommendationReason;
}

export function pickRecommendedTemplate(params: {
  candidates: TemplateCandidate[];
  outcomes: OutcomeAggregate[];
  currentBand: string;
  minTrialsForOutcomeWeight: number;
}): RecommendationPick {
  if (params.candidates.length === 0) {
    return { pickedSlug: '', reason: 'no_candidates' };
  }

  const bandOutcomes = new Map<string, OutcomeAggregate>();
  for (const o of params.outcomes) {
    if (o.bandBefore === params.currentBand) bandOutcomes.set(o.templateSlug, o);
  }

  const weighted = params.candidates
    .map((c) => ({
      candidate: c,
      outcome: bandOutcomes.get(c.slug) ?? null,
    }))
    .filter((x) => x.outcome && x.outcome.trials >= params.minTrialsForOutcomeWeight);

  if (weighted.length === 0) {
    // Sparse data — fall back to highest priority, lexicographic tie-break.
    const sorted = [...params.candidates].sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.slug.localeCompare(b.slug);
    });
    return { pickedSlug: sorted[0].slug, reason: 'priority_fallback' };
  }

  const scored = weighted.map((x) => {
    const o = x.outcome!;
    const improveRate = (o.improvedCount / o.trials) * 100;
    const score = improveRate + o.avgScoreDelta;
    return { candidate: x.candidate, outcome: o, score };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.outcome.trials !== a.outcome.trials) return b.outcome.trials - a.outcome.trials;
    if (a.candidate.priority !== b.candidate.priority) return a.candidate.priority - b.candidate.priority;
    return a.candidate.slug.localeCompare(b.candidate.slug);
  });

  return { pickedSlug: scored[0].candidate.slug, reason: 'outcome_weighted' };
}
