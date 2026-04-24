/**
 * Workflow Studio Service — backend for the conversational authoring UI.
 *
 * Spec: tasks/Workflows-spec.md §10.8.
 *
 * Provides the four tool implementations the Workflow Author agent calls
 * (plus a fifth — simulate_run — added in spec round 6) and the
 * save-and-open-pr endpoint that lives behind the human-clicked "Save"
 * button. The agent never writes files; everything goes through this
 * service which:
 *
 *   - read_existing_Workflow  — read-only file fetch from server/Workflows/
 *   - validate_candidate      — runs the §4 DAG validator against text
 *   - simulate_run            — static analysis returning parallelism
 *                               profile, critical path, irreversible count
 *   - estimate_cost           — pessimistic-mode cost estimate (default)
 *   - propose_save            — UI-only signal; the human clicks Save
 *
 * The save endpoint:
 *   - re-runs the validator (defense in depth — invariant 14)
 *   - opens a GitHub PR under the human admin's identity
 *   - records an audit event
 *
 * Phase 1 implementation note: a full validator pass requires the file's
 * Zod schemas to exist at runtime, which is impractical from a string.
 * Studio's validate_candidate uses a structural-only validator (no Zod
 * schema introspection); the full Zod-aware validator runs at PR-merge
 * time via the seeder. Both validators share the same DAG / template-ref
 * / sideEffectType / kebab_case rules.
 */

import { eq, and, desc } from 'drizzle-orm';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { db } from '../db/index.js';
import { workflowStudioSessions, users } from '../db/schema/index.js';
import type {
  WorkflowStudioSession,
  WorkflowStudioValidationState,
} from '../db/schema/index.js';
import type {
  WorkflowDefinition,
  ValidationError,
} from '../lib/workflow/types.js';
import { logger } from '../lib/logger.js';
import { validateDefinition as runtimeValidateDefinition } from '../lib/workflow/validator.js';
import { hashValue } from '../lib/workflow/hash.js';
import { renderWorkflowFile } from '../lib/workflow/renderer.js';
import { createWorkflowPr } from './workflowStudioGithub.js';

// Re-export the renderer so existing imports of
// WorkflowStudioService.renderWorkflowFile keep working.
export { renderWorkflowFile };

const WorkflowS_DIR = resolve(process.cwd(), 'server/Workflows');

// ─── Definition/file consistency (spec invariant 14) ─────────────────────────
//
// Studio's save flow does NOT accept caller-supplied fileContents. The
// server is the only producer of the file body via renderWorkflowFile()
// below. The flow is:
//
//   1. Caller (UI or agent tool) submits a structured `definition` only
//   2. Server validates the definition via the runtime validator
//   3. Server canonicalises + hashes the validated definition
//   4. Server renders the .Workflow.ts file deterministically from the
//      validated definition, embedding the hash as a magic comment
//   5. Server commits THAT generated file via the GitHub PR helper
//
// This closes the validate-one-thing-commit-another attack: there is no
// fileContents field at any boundary the caller can tamper with. The
// magic hash comment is no longer security-relevant — it is now just an
// audit trail in git history showing which definition produced the file.
// (The actual comment string lives in the pure renderer module.)

/**
 * Computes the canonical hash of a validated definition. Same algorithm
 * as the engine's hashValue helper — canonical JSON (key-sorted) → SHA256.
 * Exposed so the validate route can return it for UI display.
 */
export function computeDefinitionHash(definition: unknown): string {
  return hashValue(definition);
}

// renderWorkflowFile lives in ../lib/workflow/renderer.ts (pure module
// with no DB / env dependencies so the unit test suite can import it
// directly). It is re-exported at the top of this file.

// ─── Structural validator (no Zod required) ──────────────────────────────────

// Lightweight typed shapes used by the simulateRun + estimateCost helpers
// below. These are NOT validation types — every Studio validation call
// goes through the canonical runtime validator. They exist only so the
// static-analysis helpers can iterate steps without `any`.
interface SimulationStep {
  id?: string;
  type?: string;
  dependsOn?: string[];
  sideEffectType?: string;
  humanReviewRequired?: boolean;
}

interface SimulationDefinition {
  slug?: string;
  name?: string;
  description?: string;
  version?: number;
  steps?: SimulationStep[];
}

// ─── Tool implementations ────────────────────────────────────────────────────
//
// Studio's structural validator has been retired in favour of delegating
// to the canonical runtime validator at server/lib/workflow/validator.ts.
// That validator implements all 13 spec rules including cycle detection,
// orphan detection, and max DAG depth — the previous Studio subset only
// covered ~7 rules and made false claims in its comments. The single
// source of truth is now the runtime validator; see the
// `validateCandidate` method below.

export const WorkflowStudioService = {
  /**
   * Computes the canonical hash of a validated definition. Re-exports
   * the module-level helper as a method on the service object so route
   * handlers can call it via the service singleton.
   */
  computeDefinitionHash(definition: unknown): string {
    return computeDefinitionHash(definition);
  },

  /**
   * Validates the definition and renders the deterministic Workflow
   * file. Used by the /api/system/workflow-studio/render endpoint and
   * by the Studio UI's preview pane. Returns either the rendered file
   * + canonical hash, or a structured validation error.
   */
  validateAndRender(
    definition: unknown
  ): { ok: true; fileContents: string; definitionHash: string } | { ok: false; errors: ValidationError[] } {
    if (!definition || typeof definition !== 'object') {
      return {
        ok: false,
        errors: [{ rule: 'missing_field', message: 'definition must be an object' }],
      };
    }
    const validation = this.validateCandidate(definition);
    if (!validation.ok) return validation;
    const definitionHash = computeDefinitionHash(definition);
    const fileContents = renderWorkflowFile(definition as Record<string, unknown>, definitionHash);
    return { ok: true, fileContents, definitionHash };
  },

  /** read_existing_Workflow tool. Read-only, file system. */
  readExistingWorkflow(slug: string): { found: boolean; contents?: string } {
    const safeSlug = slug.replace(/[^a-z0-9_-]/g, '');
    if (!safeSlug || safeSlug !== slug) {
      throw { statusCode: 400, message: 'invalid slug' };
    }
    const filePath = resolve(WorkflowS_DIR, `${safeSlug}.Workflow.ts`);
    if (!filePath.startsWith(WorkflowS_DIR)) {
      throw { statusCode: 400, message: 'path traversal blocked' };
    }
    if (!existsSync(filePath)) {
      return { found: false };
    }
    return { found: true, contents: readFileSync(filePath, 'utf8') };
  },

  /** Lists known Workflow slugs (for the agent to pick from). */
  listExistingWorkflows(): string[] {
    if (!existsSync(WorkflowS_DIR)) return [];
    return readdirSync(WorkflowS_DIR)
      .filter((f) => f.endsWith('.Workflow.ts'))
      .map((f) => f.replace('.Workflow.ts', ''))
      .sort();
  },

  /**
   * validate_candidate tool. Accepts either a parsed definition object or
   * a JSON string. Delegates to the canonical runtime validator
   * (server/lib/workflow/validator.ts) which implements all 13 spec
   * rules including cycle detection, orphan detection, and max DAG
   * depth — the previous structural-only subset has been retired so
   * Studio and runtime always agree.
   *
   * The runtime validator's `outputSchema` check is presence-only
   * (`if (!step.outputSchema)`) so a JSON definition with literal
   * `outputSchema: {}` works correctly even though it has no real Zod
   * instance attached.
   */
  validateCandidate(
    input: unknown
  ): { ok: true } | { ok: false; errors: ValidationError[] } {
    let parsed: unknown = input;
    if (typeof input === 'string') {
      try {
        parsed = JSON.parse(input);
      } catch (err) {
        return {
          ok: false,
          errors: [
            {
              rule: 'missing_field',
              message: `invalid JSON: ${err instanceof Error ? err.message : 'parse failed'}`,
            },
          ],
        };
      }
    }
    if (!parsed || typeof parsed !== 'object') {
      return {
        ok: false,
        errors: [{ rule: 'missing_field', message: 'definition must be an object' }],
      };
    }
    // Cast to WorkflowDefinition — validator only inspects structural
    // shape, so a plain JSON object works without real Zod instances.
    return runtimeValidateDefinition(parsed as WorkflowDefinition);
  },

  /**
   * simulate_run tool. Static analysis pass — returns parallelism profile,
   * critical path length, side-effect summary, topological order. No
   * execution.
   */
  simulateRun(input: unknown): {
    ok: boolean;
    summary?: {
      stepCount: number;
      maxParallelism: number;
      criticalPathLength: number;
      irreversibleCount: number;
      reversibleCount: number;
      humanReviewCount: number;
      topologicalOrder: string[];
    };
    errors?: ValidationError[];
  } {
    const result = this.validateCandidate(input);
    if (!result.ok) return { ok: false, errors: result.errors };

    let parsed: SimulationDefinition;
    try {
      parsed = typeof input === 'string' ? JSON.parse(input) : (input as SimulationDefinition);
    } catch {
      return { ok: false, errors: [{ rule: 'missing_field', message: 'parse failed' }] };
    }

    const steps = (parsed.steps ?? []) as SimulationStep[];
    const stepsById = new Map(steps.map((s) => [s.id!, s]));

    // Topological order via Kahn's algorithm (we know there's no cycle —
    // validate_candidate would have caught it).
    const inDeg = new Map<string, number>();
    const childrenOf = new Map<string, string[]>();
    for (const s of steps) {
      inDeg.set(s.id!, 0);
      childrenOf.set(s.id!, []);
    }
    for (const s of steps) {
      for (const dep of s.dependsOn ?? []) {
        if (!stepsById.has(dep)) continue;
        inDeg.set(s.id!, (inDeg.get(s.id!) ?? 0) + 1);
        childrenOf.get(dep)!.push(s.id!);
      }
    }

    // BFS layers — same algorithm as the engine's ready-set computation.
    let frontier: string[] = [];
    for (const [id, d] of inDeg) if (d === 0) frontier.push(id);
    const order: string[] = [];
    let maxParallelism = 0;
    const remaining = new Map(inDeg);
    while (frontier.length > 0) {
      maxParallelism = Math.max(maxParallelism, frontier.length);
      order.push(...frontier);
      const next: string[] = [];
      for (const id of frontier) {
        for (const child of childrenOf.get(id) ?? []) {
          const r = (remaining.get(child) ?? 0) - 1;
          remaining.set(child, r);
          if (r === 0) next.push(child);
        }
      }
      frontier = next;
    }

    // Critical path = longest path through the DAG.
    const longest = new Map<string, number>();
    for (const id of order) {
      const s = stepsById.get(id);
      if (!s) continue;
      let max = 0;
      for (const dep of s.dependsOn ?? []) {
        max = Math.max(max, longest.get(dep) ?? 0);
      }
      longest.set(id, 1 + max);
    }
    const criticalPathLength = Math.max(0, ...longest.values());

    return {
      ok: true,
      summary: {
        stepCount: steps.length,
        maxParallelism,
        criticalPathLength,
        irreversibleCount: steps.filter((s) => s.sideEffectType === 'irreversible').length,
        reversibleCount: steps.filter((s) => s.sideEffectType === 'reversible').length,
        humanReviewCount: steps.filter((s) => (s as { humanReviewRequired?: boolean }).humanReviewRequired === true)
          .length,
        topologicalOrder: order,
      },
    };
  },

  /**
   * estimate_cost tool. Phase 1 returns a coarse pessimistic estimate using
   * a flat per-step cost. Phase 1.5 will replace with the rolling
   * actual-vs-estimated feedback loop from WorkflowCostEstimatorService.
   *
   * mode defaults to 'pessimistic' (spec round 7 / item #5).
   */
  estimateCost(
    input: unknown,
    options?: { mode?: 'optimistic' | 'pessimistic' }
  ): { cents: number; mode: 'optimistic' | 'pessimistic'; perStep: Record<string, number> } {
    const mode = options?.mode ?? 'pessimistic';
    const result = this.validateCandidate(input);
    if (!result.ok) return { cents: 0, mode, perStep: {} };

    let parsed: SimulationDefinition;
    try {
      parsed = typeof input === 'string' ? JSON.parse(input) : (input as SimulationDefinition);
    } catch {
      return { cents: 0, mode, perStep: {} };
    }

    // Coarse heuristic (spec §6.5 — accuracy ±50% acceptable):
    //   prompt:        $0.05 optimistic / $0.20 pessimistic
    //   agent_call:    $0.15 optimistic / $0.60 pessimistic (handoffs, retries)
    //   user_input:    $0
    //   approval:      $0
    //   conditional:   $0
    const PER_STEP: Record<string, [number, number]> = {
      prompt: [5, 20],
      agent_call: [15, 60],
      user_input: [0, 0],
      approval: [0, 0],
      conditional: [0, 0],
    };

    const perStep: Record<string, number> = {};
    let total = 0;
    for (const step of parsed.steps ?? []) {
      const [opt, pess] = PER_STEP[step.type ?? ''] ?? [0, 0];
      const cents = mode === 'pessimistic' ? pess : opt;
      perStep[step.id ?? ''] = cents;
      total += cents;
    }

    return { cents: total, mode, perStep };
  },

  // ─── Sessions + save flow ──────────────────────────────────────────────────

  async createSession(userId: string): Promise<WorkflowStudioSession> {
    const [created] = await db
      .insert(workflowStudioSessions)
      .values({ createdByUserId: userId })
      .returning();
    logger.info('workflow_studio_session_started', {
      event: 'workflow_studio.session_started',
      sessionId: created.id,
      userId,
    });
    return created;
  },

  async listSessions(userId: string): Promise<WorkflowStudioSession[]> {
    return db
      .select()
      .from(workflowStudioSessions)
      .where(eq(workflowStudioSessions.createdByUserId, userId))
      .orderBy(desc(workflowStudioSessions.updatedAt));
  },

  /**
   * Loads a Studio session, scoped to the user that created it. Returns
   * null when the session doesn't exist OR belongs to a different user.
   * The route layer surfaces both as 404 to avoid leaking session ids.
   */
  async getSession(id: string, userId: string): Promise<WorkflowStudioSession | null> {
    const [row] = await db
      .select()
      .from(workflowStudioSessions)
      .where(
        and(
          eq(workflowStudioSessions.id, id),
          eq(workflowStudioSessions.createdByUserId, userId)
        )
      );
    return row ?? null;
  },

  // (getSessionByIdUnscoped intentionally removed — review finding #3.
  // The skill executor now uses context.userId from SkillExecutionContext
  // and the strict updateCandidate(sessionId, userId, ...) helper.)

  /**
   * Updates the candidate file contents on a session. Always scoped by
   * createdByUserId so one system_admin cannot mutate another's session
   * by guessing the UUID. Returns true on success, false when the
   * session is not found or not owned by the caller.
   */
  async updateCandidate(
    sessionId: string,
    userId: string,
    fileContents: string,
    validationState: WorkflowStudioValidationState
  ): Promise<boolean> {
    const result = await db
      .update(workflowStudioSessions)
      .set({
        candidateFileContents: fileContents,
        candidateValidationState: validationState,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(workflowStudioSessions.id, sessionId),
          eq(workflowStudioSessions.createdByUserId, userId)
        )
      )
      .returning({ id: workflowStudioSessions.id });
    return result.length > 0;
  },

  /**
   * Validates the structured definition, derives the Workflow file
   * deterministically from it via renderWorkflowFile(), and opens a
   * GitHub PR with the rendered file.
   *
   * THIS METHOD DOES NOT ACCEPT CALLER-SUPPLIED fileContents.
   * The server is the only producer of the file body. This closes the
   * validate-one-thing-commit-another attack: there is no input the
   * caller can tamper with that bypasses validation. Spec invariant 14
   * (the save endpoint always re-validates AND now also always
   * re-renders the file from the validated source).
   *
   * Flow:
   *   1. Verify session ownership (review finding #2)
   *   2. Validate definition via the runtime validator (all 13 rules)
   *   3. Hash the validated definition canonically
   *   4. Render the .Workflow.ts file from the validated definition
   *   5. Open the PR with the rendered file via the GitHub helper
   *   6. Persist the rendered file + PR URL on the session row
   *
   * Returns 422 (`ok: false`) on session-not-found, validation failure,
   * or PR creation failure. Surfaces structured errors so the UI can
   * display them inline.
   */
  async saveAndOpenPr(
    sessionId: string,
    definition: unknown,
    userId: string
  ): Promise<{ ok: boolean; prUrl?: string; errors?: ValidationError[]; reason?: string; renderedFileContents?: string }> {
    // Load and verify the session belongs to the calling user BEFORE
    // doing any validation or PR work. Without this guard, the endpoint
    // would happily create a PR against a stale or non-existent session
    // id, leaving session metadata in an inconsistent state.
    // Review finding #2.
    const session = await this.getSession(sessionId, userId);
    if (!session) {
      return {
        ok: false,
        reason: 'session_not_found',
        errors: [
          {
            rule: 'missing_field',
            message:
              'Session not found or not owned by the calling user. Create or select one of your own sessions before saving.',
          },
        ],
      };
    }

    // Mandatory: caller must supply a structured definition object.
    // Spec invariant 14 — the save endpoint always re-runs the validator
    // and never trusts a chat artefact.
    if (!definition || typeof definition !== 'object') {
      return {
        ok: false,
        errors: [
          {
            rule: 'missing_field',
            message:
              'definition object is required. The Studio is the only producer of the Workflow file body — pass the validated definition only.',
          },
        ],
      };
    }

    // Mandatory validation against the runtime DAG validator. All 13 rules.
    const validation = this.validateCandidate(definition);
    if (!validation.ok) {
      logger.warn('workflow_studio_validation_failed', {
        event: 'workflow_studio.candidate_validated',
        sessionId,
        errorCount: validation.errors.length,
      });
      return { ok: false, errors: validation.errors };
    }

    // Extract the slug from the validated definition.
    const slug = (definition as { slug?: unknown }).slug;
    if (typeof slug !== 'string' || !/^[a-z0-9_-]+$/.test(slug)) {
      return {
        ok: false,
        errors: [
          {
            rule: 'missing_field',
            message: 'definition.slug must be a non-empty kebab-case string',
          },
        ],
      };
    }

    // Render the file deterministically from the validated definition.
    // The hash embedded in the file's magic comment is computed from
    // exactly the same definition object that was just validated, so
    // there is no possible drift between what we validated and what we
    // commit.
    const definitionHash = computeDefinitionHash(definition);
    const renderedFileContents = renderWorkflowFile(
      definition as Record<string, unknown>,
      definitionHash
    );

    // Look up the user for the commit author identity (spec §10.8.6 —
    // commit runs under the human admin's identity, never a service account).
    const [user] = await db
      .select({
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
      })
      .from(users)
      .where(eq(users.id, userId));

    const authorName = user
      ? `${user.firstName} ${user.lastName}`.trim()
      : undefined;

    // Open the PR via the dedicated helper. This throws structured
    // failures we surface back to the UI.
    let prResult: { prUrl: string; branch: string; commitSha: string };
    try {
      prResult = await createWorkflowPr({
        slug,
        fileContents: renderedFileContents,
        authorName,
        authorEmail: user?.email ?? undefined,
      });
    } catch (err) {
      const e = err as { statusCode?: number; message?: string; errorCode?: string };
      logger.warn('workflow_studio_pr_creation_failed', {
        sessionId,
        error: e.message,
        errorCode: e.errorCode,
      });
      // Persist the rendered file on the session even on failure so the
      // user can retry without re-rendering.
      await this.updateCandidate(sessionId, userId, renderedFileContents, 'valid');
      return {
        ok: false,
        reason: e.message ?? 'PR creation failed',
        errors: [{ rule: 'missing_field', message: e.message ?? 'PR creation failed' }],
        renderedFileContents,
      };
    }

    // Final session row update — scope by both sessionId AND createdByUserId
    // (review finding #2). Records the rendered file as the definitive
    // candidate now that the PR is open.
    await db
      .update(workflowStudioSessions)
      .set({
        candidateFileContents: renderedFileContents,
        candidateValidationState: 'valid',
        prUrl: prResult.prUrl,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(workflowStudioSessions.id, sessionId),
          eq(workflowStudioSessions.createdByUserId, userId)
        )
      );

    logger.info('workflow_studio_pr_opened', {
      event: 'workflow_studio.pr_opened',
      sessionId,
      userId,
      prUrl: prResult.prUrl,
      branch: prResult.branch,
      commitSha: prResult.commitSha,
      definitionHash,
    });

    return { ok: true, prUrl: prResult.prUrl, renderedFileContents };
  },
};
