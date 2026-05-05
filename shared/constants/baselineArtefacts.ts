export const BASELINE_SLUGS = [
  'baseline.brand_identity',
  'baseline.voice_tone',
  'baseline.offer_positioning',
  'baseline.audience_icp',
  'baseline.operating_constraints',
  'baseline.proof_library',
] as const;

export type BaselineSlug = (typeof BASELINE_SLUGS)[number];

export const TIER_BY_SLUG: Record<BaselineSlug, 1 | 2 | 3> = {
  'baseline.brand_identity': 1,
  'baseline.voice_tone': 1,
  'baseline.offer_positioning': 2,
  'baseline.audience_icp': 2,
  'baseline.operating_constraints': 3,
  'baseline.proof_library': 3,
};

export const APPLIES_TO_DOMAINS_BY_SLUG: Partial<Record<BaselineSlug, readonly string[]>> = {
  'baseline.offer_positioning': ['sales', 'content', 'outreach', 'crm'],
  'baseline.audience_icp': ['content', 'outreach', 'ads', 'reporting'],
};

export const WORKSPACE_MEMORY_DOMAIN = 'baseline' as const;

export const WORKSPACE_MEMORY_TOPIC_BY_SLUG: Partial<Record<BaselineSlug, string>> = {
  'baseline.operating_constraints': 'operating_constraints',
  'baseline.proof_library': 'proof_library',
};

export const ARTEFACT_STATUSES = ['not_started', 'in_progress', 'completed', 'skipped'] as const;
export type ArtefactStatus = (typeof ARTEFACT_STATUSES)[number];

export function isBaselineSlug(s: string): s is BaselineSlug {
  return (BASELINE_SLUGS as readonly string[]).includes(s);
}

export function tierFor(slug: BaselineSlug): 1 | 2 | 3 {
  return TIER_BY_SLUG[slug];
}

export function domainsFor(slug: BaselineSlug): readonly string[] {
  return APPLIES_TO_DOMAINS_BY_SLUG[slug] ?? [];
}
