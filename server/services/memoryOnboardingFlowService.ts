/**
 * memoryOnboardingFlowService — Memory & Briefings 9-step onboarding arc (S5)
 *
 * Impure wrapper over `subaccountOnboardingServicePure`. Persists state to
 * `subaccount_onboarding_state.resumeState` JSONB column (migration 0135).
 *
 * Named distinctly from the Phase F `subaccountOnboardingService` which
 * manages playbook-level onboarding state per module.
 *
 * Spec: docs/memory-and-briefings-spec.md §8 (S5)
 */

import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  subaccounts,
  subaccountOnboardingState,
} from '../db/schema/index.js';
import type { OnboardingResumeState } from '../db/schema/subaccountOnboardingState.js';
import {
  ONBOARDING_STEPS,
  canMarkReady,
  nextStep,
  recordStepAnswer,
  computeSmartSkips,
  emptyOnboardingState,
  type OnboardingState,
  type OnboardingStepId,
  type OnboardingStep,
} from './subaccountOnboardingServicePure.js';
import { logger } from '../lib/logger.js';

const ONBOARDING_WORKFLOW_SLUG = 'memory-briefings-onboarding';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface StartOnboardingInput {
  subaccountId: string;
  organisationId: string;
  websiteScrape?: {
    audienceSignal?: string | null;
    voiceSignal?: string | null;
    servicesSignal?: string | null;
  } | null;
}

export interface OnboardingStatus {
  subaccountId: string;
  currentStep: OnboardingStep | null;
  answers: Record<string, unknown>;
  completedStepIds: OnboardingStepId[];
  skipFulfilled: Partial<Record<OnboardingStepId, boolean>>;
  isReady: boolean;
}

export async function startOnboarding(input: StartOnboardingInput): Promise<OnboardingStatus> {
  const state = emptyOnboardingState();
  state.skipFulfilled = computeSmartSkips(input.websiteScrape ?? null);

  await persistResumeState(input.subaccountId, input.organisationId, state);

  logger.info('memoryOnboardingFlowService.started', {
    subaccountId: input.subaccountId,
    skipFulfilled: state.skipFulfilled,
  });

  return toStatus(input.subaccountId, state);
}

export async function getNextStep(
  subaccountId: string,
  organisationId: string,
): Promise<OnboardingStatus> {
  const state = await loadState(subaccountId, organisationId);
  return toStatus(subaccountId, state);
}

export interface RecordAnswerInput {
  subaccountId: string;
  organisationId: string;
  stepId: OnboardingStepId;
  answers: Record<string, unknown>;
}

export async function recordAnswer(input: RecordAnswerInput): Promise<OnboardingStatus> {
  const state = await loadState(input.subaccountId, input.organisationId);
  const next = recordStepAnswer({
    state,
    stepId: input.stepId,
    answers: input.answers,
  });
  await persistResumeState(input.subaccountId, input.organisationId, next);
  return toStatus(input.subaccountId, next);
}

export interface MarkReadyInput {
  subaccountId: string;
  organisationId: string;
}

export interface MarkReadyOutcome {
  markedReady: boolean;
  reason?: string;
  missing: OnboardingStepId[];
}

export async function markReady(input: MarkReadyInput): Promise<MarkReadyOutcome> {
  const state = await loadState(input.subaccountId, input.organisationId);
  const decision = canMarkReady(state);

  if (!decision.allowed) {
    return {
      markedReady: false,
      reason: decision.reason,
      missing: decision.missing,
    };
  }

  // Flip the subaccount to 'active' status.
  await db
    .update(subaccounts)
    .set({ status: 'active', updatedAt: new Date() })
    .where(
      and(
        eq(subaccounts.id, input.subaccountId),
        eq(subaccounts.organisationId, input.organisationId),
        isNull(subaccounts.deletedAt),
      ),
    );

  // Clear resumeState — onboarding is complete.
  await db
    .update(subaccountOnboardingState)
    .set({
      status: 'completed',
      completedAt: new Date(),
      resumeState: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(subaccountOnboardingState.subaccountId, input.subaccountId),
        eq(subaccountOnboardingState.organisationId, input.organisationId),
        eq(subaccountOnboardingState.workflowSlug, ONBOARDING_WORKFLOW_SLUG),
      ),
    );

  logger.info('memoryOnboardingFlowService.markedReady', {
    subaccountId: input.subaccountId,
  });

  return { markedReady: true, missing: [] };
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

async function loadState(subaccountId: string, organisationId: string): Promise<OnboardingState> {
  const [row] = await db
    .select({
      resumeState: subaccountOnboardingState.resumeState,
    })
    .from(subaccountOnboardingState)
    .where(
      and(
        eq(subaccountOnboardingState.subaccountId, subaccountId),
        eq(subaccountOnboardingState.organisationId, organisationId),
        eq(subaccountOnboardingState.workflowSlug, ONBOARDING_WORKFLOW_SLUG),
      ),
    )
    .limit(1);

  if (!row || !row.resumeState) return emptyOnboardingState();

  const resume = row.resumeState as OnboardingResumeState | null;
  if (!resume) return emptyOnboardingState();

  const answers = resume.answers ?? {};
  const completedStepIds = new Set<OnboardingStepId>();
  for (const step of ONBOARDING_STEPS) {
    // Trust proceduralFlags as the authoritative source — it is written by
    // persistResumeState after every recordAnswer call, so it is always
    // up-to-date and avoids the fragile key-prefix scan.
    if (resume.proceduralFlags?.[step.id]) {
      completedStepIds.add(step.id);
    }
  }

  return {
    completedStepIds,
    answers,
    skipFulfilled: (resume.proceduralFlags as Partial<Record<OnboardingStepId, boolean>>) ?? {},
  };
}

async function persistResumeState(
  subaccountId: string,
  organisationId: string,
  state: OnboardingState,
): Promise<void> {
  const now = new Date();
  const payload: OnboardingResumeState = {
    currentStep: nextStep(state)?.number ?? 9,
    answers: state.answers,
    proceduralFlags: Object.fromEntries(
      Array.from(state.completedStepIds).map((id) => [id, true]),
    ),
    updatedAt: now.toISOString(),
  };

  if (state.skipFulfilled) {
    for (const [stepId, val] of Object.entries(state.skipFulfilled)) {
      if (val && payload.proceduralFlags) payload.proceduralFlags[stepId] = true;
    }
  }

  await db
    .insert(subaccountOnboardingState)
    .values({
      organisationId,
      subaccountId,
      workflowSlug: ONBOARDING_WORKFLOW_SLUG,
      status: 'in_progress',
      startedAt: now,
      resumeState: payload,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [subaccountOnboardingState.subaccountId, subaccountOnboardingState.workflowSlug],
      set: {
        resumeState: payload,
        status: 'in_progress',
        updatedAt: now,
      },
    });
}

function toStatus(subaccountId: string, state: OnboardingState): OnboardingStatus {
  const readyDecision = canMarkReady(state);
  return {
    subaccountId,
    currentStep: nextStep(state),
    answers: state.answers,
    completedStepIds: Array.from(state.completedStepIds),
    skipFulfilled: state.skipFulfilled ?? {},
    isReady: readyDecision.allowed,
  };
}
