// server/services/scorecardDispatcher.ts
// Impure orchestrator for deterministic-validator dispatch.
// Owns: semaphore (max 3 external/judgementRun), retry-once envelope,
// 5 s timeout, per-slug rate limit (100/min), in-memory circuit breaker.
// DB writes are NOT performed here — callers receive invocationsToWrite[] DTOs.
// Deterministic-validators spec §7, §11 Step 3.

import { planDispatch } from './scorecardDispatcherPure.js';
import { getValidator } from '../lib/scorecardValidators/registry.js';
import { routeCall } from './llmRouter.js';
import { buildJudgePrompt, computeVerdict } from './scorecardJudgeRunnerPure.js';
import { logger } from '../lib/logger.js';
import type { QualityCheck } from '../db/schema/scorecards.js';
import type { ValidatorContext, RunMetadata, ValidatorResult } from '../lib/scorecardValidators/types.js';
import type { NewValidatorInvocation } from '../db/schema/validatorInvocations.js';
import type { LLMCallContext } from './llmRouter/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DispatchInput {
  qc: QualityCheck;
  runOutput: string;
  runMetadata: RunMetadata;
  judgementRunId: string;
  organisationId: string;
  scorecardName: string;
  agentName: string;
  judgeModelId: string;
}

export interface DispatchOutcome {
  evaluationMethod: 'deterministic' | 'deterministic_external' | 'hybrid_deterministic_fail' | 'hybrid_semantic' | 'semantic' | 'inconclusive';
  verdict: 'pass' | 'fail' | 'inconclusive';
  validatorSlug: string | null;
  validatorVersion: string | null;
  score: number | null;
  reasoning: string;
  evidence: Record<string, unknown> | null;
  /** DTOs to be written to validator_invocations by the caller (Chunk 5). */
  invocationsToWrite: NewValidatorInvocation[];
}

// ---------------------------------------------------------------------------
// Semaphore — max 3 concurrent external calls per judgementRunId
// ---------------------------------------------------------------------------

const semaphoreMap = new Map<string, number>();

function acquireSemaphore(judgementRunId: string, max: number): boolean {
  const current = semaphoreMap.get(judgementRunId) ?? 0;
  if (current >= max) return false;
  semaphoreMap.set(judgementRunId, current + 1);
  return true;
}

function releaseSemaphore(judgementRunId: string): void {
  const current = semaphoreMap.get(judgementRunId) ?? 0;
  if (current <= 1) {
    semaphoreMap.delete(judgementRunId);
  } else {
    semaphoreMap.set(judgementRunId, current - 1);
  }
}

// ---------------------------------------------------------------------------
// Rate limiter — 100 calls/min per slug (sliding window, in-memory)
// ---------------------------------------------------------------------------

interface RateLimitWindow {
  count: number;
  windowStart: number;
}

const rateLimitMap = new Map<string, RateLimitWindow>();

function checkRateLimit(slug: string, limitPerMin = 100): boolean {
  const now = Date.now();
  const window = rateLimitMap.get(slug);
  if (!window || now - window.windowStart >= 60_000) {
    rateLimitMap.set(slug, { count: 1, windowStart: now });
    return true;
  }
  if (window.count >= limitPerMin) return false;
  window.count += 1;
  return true;
}

// ---------------------------------------------------------------------------
// Circuit breaker — per slug, in-memory
// Opens when error rate > 20% in a 5-min window (min 5 calls to activate).
// Closes after 2 consecutive successful health-check calls.
// ---------------------------------------------------------------------------

interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half_open';
  errorCount: number;
  callCount: number;
  windowStart: number;
  consecutiveSuccesses: number;
  openedAt?: number;
}

const circuitBreakerMap = new Map<string, CircuitBreakerState>();
const CB_WINDOW_MS = 5 * 60_000;
const CB_ERROR_RATE_THRESHOLD = 0.2;
const CB_MIN_CALLS = 5;
const CB_HEALTH_CHECK_SUCCESSES = 2;
const CB_HALF_OPEN_AFTER_MS = 30_000;

function getCircuitBreaker(slug: string): CircuitBreakerState {
  let cb = circuitBreakerMap.get(slug);
  if (!cb) {
    cb = { state: 'closed', errorCount: 0, callCount: 0, windowStart: Date.now(), consecutiveSuccesses: 0 };
    circuitBreakerMap.set(slug, cb);
  }
  return cb;
}

function isCircuitOpen(slug: string): boolean {
  const cb = getCircuitBreaker(slug);
  if (cb.state === 'closed') return false;
  if (cb.state === 'open') {
    // Allow transition to half_open after cooldown
    if (cb.openedAt && Date.now() - cb.openedAt >= CB_HALF_OPEN_AFTER_MS) {
      cb.state = 'half_open';
      cb.consecutiveSuccesses = 0;
      return false;
    }
    return true;
  }
  // half_open: allow through for health-check probing
  return false;
}

function recordCircuitSuccess(slug: string): void {
  const cb = getCircuitBreaker(slug);
  const now = Date.now();
  if (now - cb.windowStart >= CB_WINDOW_MS) {
    cb.errorCount = 0;
    cb.callCount = 0;
    cb.windowStart = now;
  }
  cb.callCount += 1;
  if (cb.state === 'half_open') {
    cb.consecutiveSuccesses += 1;
    if (cb.consecutiveSuccesses >= CB_HEALTH_CHECK_SUCCESSES) {
      cb.state = 'closed';
      cb.consecutiveSuccesses = 0;
    }
  }
}

function recordCircuitError(slug: string): void {
  const cb = getCircuitBreaker(slug);
  const now = Date.now();
  if (now - cb.windowStart >= CB_WINDOW_MS) {
    cb.errorCount = 0;
    cb.callCount = 0;
    cb.windowStart = now;
  }
  cb.callCount += 1;
  cb.errorCount += 1;
  cb.consecutiveSuccesses = 0;
  if (cb.callCount >= CB_MIN_CALLS && cb.errorCount / cb.callCount > CB_ERROR_RATE_THRESHOLD) {
    if (cb.state !== 'open') {
      cb.state = 'open';
      cb.openedAt = now;
    }
  }
}

// ---------------------------------------------------------------------------
// Timeout wrapper
// ---------------------------------------------------------------------------

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('validator_timeout')), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

// ---------------------------------------------------------------------------
// Build a NewValidatorInvocation DTO (DB write deferred to Chunk 5)
// ---------------------------------------------------------------------------

function makeInvocationDto(params: {
  verdictId: string | null;
  validatorSlug: string;
  validatorVersion: string;
  evaluationMethod: NewValidatorInvocation['evaluationMethod'];
  latencyMs: number;
  externalCallCount: number;
  resultPassed: boolean;
  resultScore: number | null;
  evidence: Record<string, unknown> | null;
  traceId: string | null;
}): NewValidatorInvocation {
  return {
    verdictId: params.verdictId ?? '00000000-0000-0000-0000-000000000000',
    validatorSlug: params.validatorSlug,
    validatorVersion: params.validatorVersion,
    evaluationMethod: params.evaluationMethod,
    latencyMs: params.latencyMs,
    externalCallCount: params.externalCallCount,
    resultPassed: params.resultPassed,
    resultScore: params.resultScore !== null ? String(params.resultScore) : undefined,
    evidenceJson: params.evidence ?? undefined,
    traceId: params.traceId ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Run a single validator with timeout
// ---------------------------------------------------------------------------

async function runValidatorOnce(
  validator: { slug: string; version: string; evaluate: (ctx: ValidatorContext) => Promise<ValidatorResult> },
  ctx: ValidatorContext,
  timeoutMs: number,
): Promise<ValidatorResult & { latencyMs: number }> {
  const start = Date.now();
  const result = await withTimeout(validator.evaluate(ctx), timeoutMs);
  return { ...result, latencyMs: Date.now() - start };
}

// ---------------------------------------------------------------------------
// LLM semantic judge call (mirrors scorecardJudgeJob's existing loop)
// ---------------------------------------------------------------------------

const MAX_JSON_RETRIES = 3;

async function callSemanticJudge(params: {
  qc: QualityCheck;
  runOutput: string;
  scorecardName: string;
  agentName: string;
  judgeModelId: string;
  organisationId: string;
  runId: string;
}): Promise<{ verdict: 'pass' | 'fail' | 'inconclusive'; score: number | null; reasoning: string }> {
  const { qc, runOutput, scorecardName, agentName, judgeModelId, organisationId, runId } = params;
  const { system, user } = buildJudgePrompt({
    scorecardName,
    qualityCheckName: qc.name,
    qualityCheckDesc: qc.description,
    runSummary: runOutput,
    agentName,
  });

  const ctx: LLMCallContext = {
    organisationId,
    runId,
    sourceType: 'system',
    agentName: 'scorecard-judge',
    taskType: 'review',
    routingMode: 'ceiling',
    featureTag: 'scorecard-judge',
    systemCallerPolicy: 'bypass_routing',
    provider: 'anthropic',
    model: judgeModelId,
  };

  for (let attempt = 0; attempt < MAX_JSON_RETRIES; attempt++) {
    const userMsg = attempt === 0 ? user : `${user}\n\n[Retry attempt: ${attempt}]`;
    try {
      const response = await routeCall({
        messages: [{ role: 'user', content: userMsg }],
        system,
        maxTokens: 512,
        context: ctx,
      });
      const raw = typeof response.content === 'string' ? response.content.trim() : '';
      const parsed = JSON.parse(raw) as { observedScore?: unknown; judgeReasoning?: unknown };
      if (typeof parsed.observedScore === 'number' && typeof parsed.judgeReasoning === 'string') {
        const score = parsed.observedScore;
        const reasoning = parsed.judgeReasoning;
        const verdict = computeVerdict(score, qc.passMark);
        return { verdict, score, reasoning };
      }
    } catch {
      // continue to next attempt
    }
  }

  return { verdict: 'inconclusive', score: null, reasoning: '' };
}

// ---------------------------------------------------------------------------
// dispatchCheck — main entry point
// ---------------------------------------------------------------------------

const EXTERNAL_TIMEOUT_MS = 5_000;
const EXTERNAL_SEMAPHORE_MAX = 3;

export async function dispatchCheck(input: DispatchInput): Promise<DispatchOutcome> {
  const {
    qc, runOutput, runMetadata, judgementRunId,
    organisationId, scorecardName, agentName, judgeModelId,
  } = input;

  const invocationsToWrite: NewValidatorInvocation[] = [];
  // verdictId is unknown at dispatch time; Chunk 5 fills it in after insert.
  // We use null here; the caller replaces before writing.
  const pendingVerdictId = null;

  const plan = planDispatch(qc, getValidator);

  // ── Inconclusive (catalogue miss / parameter mismatch) ───────────────────
  if (plan.kind === 'inconclusive') {
    return {
      evaluationMethod: 'inconclusive',
      verdict: 'inconclusive',
      validatorSlug: null,
      validatorVersion: null,
      score: null,
      reasoning: `${plan.reason}: ${plan.detail}`,
      evidence: null,
      invocationsToWrite,
    };
  }

  // ── Semantic (pure LLM path) ──────────────────────────────────────────────
  if (plan.kind === 'semantic') {
    const result = await callSemanticJudge({
      qc, runOutput, scorecardName, agentName, judgeModelId, organisationId,
      runId: runMetadata.runId,
    });
    return {
      evaluationMethod: 'semantic',
      verdict: result.verdict,
      validatorSlug: null,
      validatorVersion: null,
      score: result.score,
      reasoning: result.reasoning,
      evidence: null,
      invocationsToWrite,
    };
  }

  // ── Deterministic path (deterministic | deterministic_external) ──────────
  if (plan.kind === 'deterministic' || plan.kind === 'deterministic_external') {
    const { validator } = plan;
    const isExternal = plan.kind === 'deterministic_external';
    const ctx: ValidatorContext = {
      runOutput,
      runMetadata,
      parameters: qc.validatorParameters ?? {},
    };

    if (isExternal) {
      if (!checkRateLimit(validator.slug)) {
        return {
          evaluationMethod: 'inconclusive',
          verdict: 'inconclusive',
          validatorSlug: validator.slug,
          validatorVersion: validator.version,
          score: null,
          reasoning: 'rate_limit_exceeded',
          evidence: null,
          invocationsToWrite,
        };
      }
      if (isCircuitOpen(validator.slug)) {
        return {
          evaluationMethod: 'inconclusive',
          verdict: 'inconclusive',
          validatorSlug: validator.slug,
          validatorVersion: validator.version,
          score: null,
          reasoning: 'circuit_breaker_open',
          evidence: null,
          invocationsToWrite,
        };
      }
      if (!acquireSemaphore(judgementRunId, EXTERNAL_SEMAPHORE_MAX)) {
        return {
          evaluationMethod: 'inconclusive',
          verdict: 'inconclusive',
          validatorSlug: validator.slug,
          validatorVersion: validator.version,
          score: null,
          reasoning: 'semaphore_limit_exceeded',
          evidence: null,
          invocationsToWrite,
        };
      }
    }

    let result!: ValidatorResult & { latencyMs: number };
    let externalCallCount = 0;

    try {
      try {
        result = await runValidatorOnce(validator, ctx, isExternal ? EXTERNAL_TIMEOUT_MS : 30_000);
        if (isExternal) externalCallCount = 1;
        if (isExternal) recordCircuitSuccess(validator.slug);
      } catch (firstErr) {
        if (!isExternal) throw firstErr;
        // Retry once for external validators
        try {
          result = await runValidatorOnce(validator, ctx, EXTERNAL_TIMEOUT_MS);
          externalCallCount = 2;
          recordCircuitSuccess(validator.slug);
        } catch {
          if (isExternal) recordCircuitError(validator.slug);
          const isTimeout =
            firstErr instanceof Error && firstErr.message === 'validator_timeout';
          return {
            evaluationMethod: 'inconclusive',
            verdict: 'inconclusive',
            validatorSlug: validator.slug,
            validatorVersion: validator.version,
            score: null,
            reasoning: isTimeout ? 'external_timeout' : `validator threw: ${firstErr instanceof Error ? firstErr.message : String(firstErr)}`,
            evidence: null,
            invocationsToWrite,
          };
        }
      }
    } catch (err) {
      return {
        evaluationMethod: 'inconclusive',
        verdict: 'inconclusive',
        validatorSlug: validator.slug,
        validatorVersion: validator.version,
        score: null,
        reasoning: `validator threw: ${err instanceof Error ? err.message : String(err)}`,
        evidence: null,
        invocationsToWrite,
      };
    } finally {
      if (isExternal) releaseSemaphore(judgementRunId);
    }

    const verdict: 'pass' | 'fail' = result.passed ? 'pass' : 'fail';
    const evidenceObj = result.evidence ?? null;

    invocationsToWrite.push(makeInvocationDto({
      verdictId: pendingVerdictId,
      validatorSlug: validator.slug,
      validatorVersion: validator.version,
      evaluationMethod: isExternal ? 'deterministic_external' : 'deterministic',
      latencyMs: result.latencyMs,
      externalCallCount,
      resultPassed: result.passed,
      resultScore: result.score,
      evidence: evidenceObj,
      traceId: null,
    }));

    return {
      evaluationMethod: isExternal ? 'deterministic_external' : 'deterministic',
      verdict,
      validatorSlug: validator.slug,
      validatorVersion: validator.version,
      score: result.score,
      reasoning: result.reasoning,
      evidence: evidenceObj,
      invocationsToWrite,
    };
  }

  // ── Hybrid path ──────────────────────────────────────────────────────────
  if (plan.kind === 'hybrid') {
    const { preconditions, preconditionParams } = plan;

    for (let i = 0; i < preconditions.length; i++) {
      const precondition = preconditions[i]!;
      const params = preconditionParams[i]!;
      const ctx: ValidatorContext = {
        runOutput,
        runMetadata,
        parameters: params,
      };

      let precResult: ValidatorResult & { latencyMs: number };
      const start = Date.now();
      try {
        precResult = await runValidatorOnce(precondition, ctx, 30_000);
      } catch (err) {
        invocationsToWrite.push(makeInvocationDto({
          verdictId: pendingVerdictId,
          validatorSlug: precondition.slug,
          validatorVersion: precondition.version,
          evaluationMethod: 'inconclusive',
          latencyMs: Date.now() - start,
          externalCallCount: 0,
          resultPassed: false,
          resultScore: 0,
          evidence: null,
          traceId: null,
        }));
        return {
          evaluationMethod: 'inconclusive',
          verdict: 'inconclusive',
          validatorSlug: precondition.slug,
          validatorVersion: precondition.version,
          score: null,
          reasoning: `validator threw: ${err instanceof Error ? err.message : String(err)}`,
          evidence: null,
          invocationsToWrite,
        };
      }

      invocationsToWrite.push(makeInvocationDto({
        verdictId: pendingVerdictId,
        validatorSlug: precondition.slug,
        validatorVersion: precondition.version,
        evaluationMethod: 'hybrid_precondition_pass',
        latencyMs: precResult.latencyMs,
        externalCallCount: 0,
        resultPassed: precResult.passed,
        resultScore: precResult.score,
        evidence: precResult.evidence ?? null,
        traceId: null,
      }));

      if (!precResult.passed) {
        // Short-circuit — precondition failed
        return {
          evaluationMethod: 'hybrid_deterministic_fail',
          verdict: 'fail',
          validatorSlug: precondition.slug,
          validatorVersion: precondition.version,
          score: precResult.score,
          reasoning: precResult.reasoning,
          evidence: precResult.evidence ?? null,
          invocationsToWrite,
        };
      }
    }

    // All preconditions passed — fall through to LLM judge
    const result = await callSemanticJudge({
      qc, runOutput, scorecardName, agentName, judgeModelId, organisationId,
      runId: runMetadata.runId,
    });
    return {
      evaluationMethod: 'hybrid_semantic',
      verdict: result.verdict,
      validatorSlug: null,
      validatorVersion: null,
      score: result.score,
      reasoning: result.reasoning,
      evidence: null,
      invocationsToWrite,
    };
  }

  // Should never reach here
  logger.warn('scorecard_dispatcher.unhandled_plan_kind', { qcSlug: qc.slug });
  return {
    evaluationMethod: 'inconclusive',
    verdict: 'inconclusive',
    validatorSlug: null,
    validatorVersion: null,
    score: null,
    reasoning: 'unhandled dispatch plan kind',
    evidence: null,
    invocationsToWrite,
  };
}
