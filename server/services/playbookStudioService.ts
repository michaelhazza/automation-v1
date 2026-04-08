/**
 * Playbook Studio Service — backend for the conversational authoring UI.
 *
 * Spec: tasks/playbooks-spec.md §10.8.
 *
 * Provides the four tool implementations the Playbook Author agent calls
 * (plus a fifth — simulate_run — added in spec round 6) and the
 * save-and-open-pr endpoint that lives behind the human-clicked "Save"
 * button. The agent never writes files; everything goes through this
 * service which:
 *
 *   - read_existing_playbook  — read-only file fetch from server/playbooks/
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
import { playbookStudioSessions, users } from '../db/schema/index.js';
import type {
  PlaybookStudioSession,
  PlaybookStudioValidationState,
} from '../db/schema/index.js';
import type {
  PlaybookDefinition,
  ValidationError,
} from '../lib/playbook/types.js';
import { logger } from '../lib/logger.js';
import { validateDefinition as runtimeValidateDefinition } from '../lib/playbook/validator.js';
import { hashValue } from '../lib/playbook/hash.js';
import { createPlaybookPr } from './playbookStudioGithub.js';

const PLAYBOOKS_DIR = resolve(process.cwd(), 'server/playbooks');

// ─── Definition/file consistency (spec invariant 14) ─────────────────────────
//
// The save endpoint validates a structured `definition` object then commits
// `fileContents` to GitHub. To prevent the validate-one-thing-commit-another
// attack, the file MUST embed a magic comment containing the canonical hash
// of the validated definition. The save endpoint extracts the hash from the
// file via the regex below and rejects any mismatch.
//
// The Studio UI computes the same hash via the validate endpoint's response
// and auto-injects/updates this comment in the file before sending the save
// request. The agent's propose_save tool does the same thing.
//
// The hash is also a permanent audit trail in git history: any reviewer can
// see exactly which definition the committed file represents.
const DEFINITION_HASH_COMMENT_RE = /\/\/\s*@playbook-definition-hash:\s*([a-f0-9]{64})\b/;
const DEFINITION_HASH_COMMENT_LINE = (hash: string) => `// @playbook-definition-hash: ${hash}`;

/**
 * Computes the canonical hash of a validated definition. Same algorithm
 * as the engine's hashValue helper — canonical JSON (key-sorted) → SHA256.
 * Exposed for the validate endpoint so the UI can fetch and inject the
 * magic comment.
 */
export function computeDefinitionHash(definition: unknown): string {
  return hashValue(definition);
}

/**
 * Extracts the embedded hash from a candidate file's contents. Returns
 * null if the magic comment is missing.
 */
function extractDefinitionHashFromFile(fileContents: string): string | null {
  const m = fileContents.match(DEFINITION_HASH_COMMENT_RE);
  return m ? m[1] : null;
}

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
// to the canonical runtime validator at server/lib/playbook/validator.ts.
// That validator implements all 13 spec rules including cycle detection,
// orphan detection, and max DAG depth — the previous Studio subset only
// covered ~7 rules and made false claims in its comments. The single
// source of truth is now the runtime validator; see the
// `validateCandidate` method below.

export const playbookStudioService = {
  /**
   * Computes the canonical hash of a validated definition. Re-exports
   * the module-level helper as a method on the service object so route
   * handlers can call it via the service singleton.
   */
  computeDefinitionHash(definition: unknown): string {
    return computeDefinitionHash(definition);
  },

  /** read_existing_playbook tool. Read-only, file system. */
  readExistingPlaybook(slug: string): { found: boolean; contents?: string } {
    const safeSlug = slug.replace(/[^a-z0-9_-]/g, '');
    if (!safeSlug || safeSlug !== slug) {
      throw { statusCode: 400, message: 'invalid slug' };
    }
    const filePath = resolve(PLAYBOOKS_DIR, `${safeSlug}.playbook.ts`);
    if (!filePath.startsWith(PLAYBOOKS_DIR)) {
      throw { statusCode: 400, message: 'path traversal blocked' };
    }
    if (!existsSync(filePath)) {
      return { found: false };
    }
    return { found: true, contents: readFileSync(filePath, 'utf8') };
  },

  /** Lists known playbook slugs (for the agent to pick from). */
  listExistingPlaybooks(): string[] {
    if (!existsSync(PLAYBOOKS_DIR)) return [];
    return readdirSync(PLAYBOOKS_DIR)
      .filter((f) => f.endsWith('.playbook.ts'))
      .map((f) => f.replace('.playbook.ts', ''))
      .sort();
  },

  /**
   * validate_candidate tool. Accepts either a parsed definition object or
   * a JSON string. Delegates to the canonical runtime validator
   * (server/lib/playbook/validator.ts) which implements all 13 spec
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
    // Cast to PlaybookDefinition — validator only inspects structural
    // shape, so a plain JSON object works without real Zod instances.
    return runtimeValidateDefinition(parsed as PlaybookDefinition);
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
   * actual-vs-estimated feedback loop from playbookCostEstimatorService.
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

  async createSession(userId: string): Promise<PlaybookStudioSession> {
    const [created] = await db
      .insert(playbookStudioSessions)
      .values({ createdByUserId: userId })
      .returning();
    logger.info('playbook_studio_session_started', {
      event: 'playbook_studio.session_started',
      sessionId: created.id,
      userId,
    });
    return created;
  },

  async listSessions(userId: string): Promise<PlaybookStudioSession[]> {
    return db
      .select()
      .from(playbookStudioSessions)
      .where(eq(playbookStudioSessions.createdByUserId, userId))
      .orderBy(desc(playbookStudioSessions.updatedAt));
  },

  /**
   * Loads a Studio session, scoped to the user that created it. Returns
   * null when the session doesn't exist OR belongs to a different user.
   * The route layer surfaces both as 404 to avoid leaking session ids.
   */
  async getSession(id: string, userId: string): Promise<PlaybookStudioSession | null> {
    const [row] = await db
      .select()
      .from(playbookStudioSessions)
      .where(
        and(
          eq(playbookStudioSessions.id, id),
          eq(playbookStudioSessions.createdByUserId, userId)
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
    validationState: PlaybookStudioValidationState
  ): Promise<boolean> {
    const result = await db
      .update(playbookStudioSessions)
      .set({
        candidateFileContents: fileContents,
        candidateValidationState: validationState,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(playbookStudioSessions.id, sessionId),
          eq(playbookStudioSessions.createdByUserId, userId)
        )
      )
      .returning({ id: playbookStudioSessions.id });
    return result.length > 0;
  },

  /**
   * Validates the candidate file + definition and opens a real GitHub PR
   * via the playbookStudioGithub helper. Always re-validates first
   * (spec invariant 14): the chat artefact is never trusted.
   *
   * REQUIRES a structured `definition` object alongside `fileContents`.
   * The definition is what gets validated; the fileContents is what gets
   * written to the PR. Both must be present — passing only fileContents
   * is rejected because the validator cannot reliably parse arbitrary
   * TypeScript source.
   *
   * Returns 422 (`ok: false`) on validation failure, missing definition,
   * or when GitHub integration is not configured. The endpoint surfaces
   * these as structured errors so the UI can display them inline.
   */
  async saveAndOpenPr(
    sessionId: string,
    fileContents: string,
    definition: unknown,
    userId: string
  ): Promise<{ ok: boolean; prUrl?: string; errors?: ValidationError[]; reason?: string }> {
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

    // Mandatory: caller must supply a structured definition object that
    // we can validate. Spec invariant 14 — the save endpoint always
    // re-runs the validator and never trusts the chat artefact.
    if (!definition || typeof definition !== 'object') {
      return {
        ok: false,
        errors: [
          {
            rule: 'missing_field',
            message:
              'definition object is required (the validator cannot reliably parse raw TypeScript). The Studio UI sends both fileContents and a structured definition.',
          },
        ],
      };
    }

    // Mandatory validation against the runtime DAG validator. This
    // covers all 13 rules including cycle, orphan, and max DAG depth —
    // the structural subset has been removed in favour of the canonical
    // implementation.
    const validation = this.validateCandidate(definition);
    if (!validation.ok) {
      await this.updateCandidate(sessionId, userId, fileContents, 'invalid');
      logger.warn('playbook_studio_validation_failed', {
        event: 'playbook_studio.candidate_validated',
        sessionId,
        errorCount: validation.errors.length,
      });
      return { ok: false, errors: validation.errors };
    }

    // Extract the slug from the validated definition (not from raw text).
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

    // Definition/file consistency enforcement (spec invariant 14).
    // The validated definition has a deterministic canonical hash. The
    // file MUST embed that hash in a magic comment. If missing or
    // mismatched, refuse to commit — this closes the validate-one-thing-
    // commit-another attack where a caller passes a clean definition
    // alongside malicious fileContents.
    const expectedHash = computeDefinitionHash(definition);
    const fileHash = extractDefinitionHashFromFile(fileContents);
    if (!fileHash) {
      logger.warn('playbook_studio_save_missing_definition_hash', {
        sessionId,
        userId,
      });
      return {
        ok: false,
        errors: [
          {
            rule: 'missing_field',
            message: `fileContents must include the magic comment "${DEFINITION_HASH_COMMENT_LINE(
              expectedHash
            )}" so the server can verify the file matches the validated definition. The Studio UI auto-injects this on save; if you are calling the endpoint directly, add the line near the top of the file.`,
          },
        ],
      };
    }
    if (fileHash !== expectedHash) {
      logger.warn('playbook_studio_save_definition_hash_mismatch', {
        sessionId,
        userId,
        expectedHash,
        fileHash,
      });
      return {
        ok: false,
        errors: [
          {
            rule: 'missing_field',
            message: `definition/file hash mismatch — the file's @playbook-definition-hash (${fileHash}) does not match the validated definition's hash (${expectedHash}). The fileContents you submitted does not represent the same playbook as the definition object. Re-generate the file from the validated definition before retrying.`,
          },
        ],
      };
    }

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
      prResult = await createPlaybookPr({
        slug,
        fileContents,
        authorName,
        authorEmail: user?.email ?? undefined,
      });
    } catch (err) {
      const e = err as { statusCode?: number; message?: string; errorCode?: string };
      logger.warn('playbook_studio_pr_creation_failed', {
        sessionId,
        error: e.message,
        errorCode: e.errorCode,
      });
      await this.updateCandidate(sessionId, userId, fileContents, 'valid');
      return {
        ok: false,
        reason: e.message ?? 'PR creation failed',
        errors: [{ rule: 'missing_field', message: e.message ?? 'PR creation failed' }],
      };
    }

    // Final session row update — scope by both sessionId AND createdByUserId
    // (review finding #2). The earlier ownership check via getSession()
    // already proved the user owns this session, but defence-in-depth says
    // every persistence write should still carry the user scope.
    await db
      .update(playbookStudioSessions)
      .set({
        candidateFileContents: fileContents,
        candidateValidationState: 'valid',
        prUrl: prResult.prUrl,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(playbookStudioSessions.id, sessionId),
          eq(playbookStudioSessions.createdByUserId, userId)
        )
      );

    logger.info('playbook_studio_pr_opened', {
      event: 'playbook_studio.pr_opened',
      sessionId,
      userId,
      prUrl: prResult.prUrl,
      branch: prResult.branch,
      commitSha: prResult.commitSha,
    });

    return { ok: true, prUrl: prResult.prUrl };
  },
};
