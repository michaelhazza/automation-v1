/**
 * subaccountOnboardingServicePure — onboarding state-machine decisions (pure)
 *
 * Holds the deterministic logic for:
 *   - markReady invariant enforcement (Step 1 + Step 6 + Step 7 minimum)
 *   - step ordering + next-step resolution
 *   - smart-skip fulfilment recognition
 *
 * All database I/O and Configuration Assistant orchestration lives in the
 * impure wrapper `subaccountOnboardingService.ts`.
 *
 * Spec: docs/memory-and-briefings-spec.md §8 (S5)
 */

// ---------------------------------------------------------------------------
// 9-step arc
// ---------------------------------------------------------------------------

export type OnboardingStepId =
  | 'identity'
  | 'audience'
  | 'voice'
  | 'integrations'
  | 'goals'
  | 'intelligence_briefing_config'
  | 'weekly_digest_config'
  | 'portal_mode'
  | 'review_and_provision';

export interface OnboardingStep {
  id: OnboardingStepId;
  /** 1-indexed step number matching spec §8.4. */
  number: number;
  label: string;
  /** True when the step is part of the minimum-viable ready set (§8.2). */
  required: boolean;
}

export const ONBOARDING_STEPS: ReadonlyArray<OnboardingStep> = [
  { id: 'identity',                      number: 1, label: 'Identity',                      required: true },
  { id: 'audience',                      number: 2, label: 'Audience & positioning',        required: false },
  { id: 'voice',                         number: 3, label: 'Voice & brand',                 required: false },
  { id: 'integrations',                  number: 4, label: 'Integrations',                  required: false },
  { id: 'goals',                         number: 5, label: 'Goals & KPIs',                  required: false },
  { id: 'intelligence_briefing_config',  number: 6, label: 'Intelligence Briefing config',  required: true },
  { id: 'weekly_digest_config',          number: 7, label: 'Weekly Digest config',          required: true },
  { id: 'portal_mode',                   number: 8, label: 'Portal mode',                   required: false },
  { id: 'review_and_provision',          number: 9, label: 'Review & provision',            required: false },
] as const;

const MINIMUM_REQUIRED_STEP_IDS: ReadonlySet<OnboardingStepId> = new Set(
  ONBOARDING_STEPS.filter((s) => s.required).map((s) => s.id),
);

// ---------------------------------------------------------------------------
// State shape (mirrors the resumeState JSONB column)
// ---------------------------------------------------------------------------

export interface OnboardingState {
  /** IDs of steps that have been satisfied (answered or skip-fulfilled). */
  completedStepIds: Set<OnboardingStepId>;
  /** Per-step collected answers (ConfigQuestion id → value). */
  answers: Record<string, unknown>;
  /** Smart-skip fulfilment flags keyed by step id. */
  skipFulfilled?: Partial<Record<OnboardingStepId, boolean>>;
}

export function emptyOnboardingState(): OnboardingState {
  return {
    completedStepIds: new Set(),
    answers: {},
    skipFulfilled: {},
  };
}

// ---------------------------------------------------------------------------
// markReady guard
// ---------------------------------------------------------------------------

export interface MarkReadyResult {
  allowed: boolean;
  /** Human-readable reason when `allowed=false`. */
  reason?: string;
  /** Missing required step IDs (empty when allowed=true). */
  missing: OnboardingStepId[];
}

/**
 * Invariant check per §8.2:
 *   A subaccount may transition to `ready` only when Steps 1 (Identity), 6
 *   (Intelligence Briefing config), and 7 (Weekly Digest config) have all
 *   been satisfied (either answered directly or smart-skip fulfilled).
 *
 * Steps 2–5 and 8–9 are optional for the minimum-viable ready state.
 */
export function canMarkReady(state: OnboardingState): MarkReadyResult {
  const missing: OnboardingStepId[] = [];
  for (const id of MINIMUM_REQUIRED_STEP_IDS) {
    if (!state.completedStepIds.has(id) && !state.skipFulfilled?.[id]) {
      missing.push(id);
    }
  }
  if (missing.length === 0) return { allowed: true, missing: [] };
  const labels = missing
    .map((id) => ONBOARDING_STEPS.find((s) => s.id === id)?.label ?? id)
    .join(', ');
  return {
    allowed: false,
    reason: `Cannot mark ready. Missing required step(s): ${labels}.`,
    missing,
  };
}

// ---------------------------------------------------------------------------
// Step ordering
// ---------------------------------------------------------------------------

/**
 * Resolve the next step for the conversation. Skips completed + smart-skipped
 * steps. Returns null when the arc is exhausted (caller proceeds to provision).
 */
export function nextStep(state: OnboardingState): OnboardingStep | null {
  for (const step of ONBOARDING_STEPS) {
    if (state.completedStepIds.has(step.id)) continue;
    if (state.skipFulfilled?.[step.id]) continue;
    return step;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Smart-skip fulfilment recognition
// ---------------------------------------------------------------------------

/**
 * Decide whether the website-scrape payload contains enough information to
 * smart-skip Steps 2 (Audience) and 3 (Voice). Conservative — we skip only
 * when the payload contains non-empty audience + voice signals.
 */
export function computeSmartSkips(websiteScrape: {
  audienceSignal?: string | null;
  voiceSignal?: string | null;
  servicesSignal?: string | null;
} | null): Partial<Record<OnboardingStepId, boolean>> {
  if (!websiteScrape) return {};
  const out: Partial<Record<OnboardingStepId, boolean>> = {};
  if (typeof websiteScrape.audienceSignal === 'string' && websiteScrape.audienceSignal.trim().length >= 20) {
    out.audience = true;
  }
  if (typeof websiteScrape.voiceSignal === 'string' && websiteScrape.voiceSignal.trim().length >= 20) {
    out.voice = true;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Answer recording — returns the next state without mutating input
// ---------------------------------------------------------------------------

export interface RecordAnswerInput {
  state: OnboardingState;
  stepId: OnboardingStepId;
  answers: Record<string, unknown>;
}

export function recordStepAnswer(input: RecordAnswerInput): OnboardingState {
  const completed = new Set(input.state.completedStepIds);
  completed.add(input.stepId);
  return {
    completedStepIds: completed,
    answers: { ...input.state.answers, ...input.answers },
    skipFulfilled: { ...(input.state.skipFulfilled ?? {}) },
  };
}
