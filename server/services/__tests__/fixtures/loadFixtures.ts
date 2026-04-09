/**
 * loadFixtures — minimal fixture set used by the Sprint 1 smoke test and
 * (in later sprints) by the three carved-out integration tests:
 *
 *   - rls.context-propagation.test.ts (Sprint 2, P1.1)
 *   - agentRun.crash-resume-parity.test.ts (Sprint 3, P2.1)
 *   - playbookBulk.parent-child-idempotency.test.ts (Sprint 4, P3.1)
 *
 * Per docs/improvements-roadmap-spec.md → Testing strategy → Fixture
 * specification.
 *
 * Contents (deliberately minimal — every fixture has a clear purpose):
 *
 *   1 organisation              (fixture-org-001)
 *   2 subaccounts               (fixture-sub-001, fixture-sub-002)
 *                               — second one exists so cross-tenant tests
 *                                 are possible
 *   1 agent per subaccount      (linked twice via subaccount agent links)
 *                               — same agent definition, two links, so
 *                                 shared memory block tests in P4.2 have
 *                                 two agents to attach to
 *   1 task on fixture-sub-001
 *   3 review_code outputs       (APPROVE, BLOCKED, malformed) for
 *                               parseVerdict regex testing in P2.2
 *
 * The fixtures are PURE TypeScript objects, not database rows. They have
 * no db / env dependencies — the tests that consume them either:
 *   (a) use them directly as input to pure functions, or
 *   (b) seed them into a real database during integration test setup.
 *
 * Rules:
 *   - No imports from server/db (pure types are fine via type-only imports).
 *   - Stable UUIDs (hardcoded) so the same fixture data deserialises the
 *     same way across test runs.
 *   - The shape mirrors the real schema closely enough that integration
 *     tests can pass these objects directly to seed helpers — but the
 *     fixture objects themselves are NOT $inferInsert types, they are
 *     loose objects keyed by name for ergonomics.
 */

// Stable UUIDs (v4-shaped) — never regenerated.
export const FIXTURE_ORG_ID = '00000000-0000-4000-a000-000000000001';
export const FIXTURE_SUBACCOUNT_1_ID = '00000000-0000-4000-a000-000000000010';
export const FIXTURE_SUBACCOUNT_2_ID = '00000000-0000-4000-a000-000000000011';
export const FIXTURE_AGENT_ID = '00000000-0000-4000-a000-000000000020';
export const FIXTURE_LINK_1_ID = '00000000-0000-4000-a000-000000000030';
export const FIXTURE_LINK_2_ID = '00000000-0000-4000-a000-000000000031';
export const FIXTURE_TASK_ID = '00000000-0000-4000-a000-000000000040';
export const FIXTURE_USER_ID = '00000000-0000-4000-a000-000000000050';

export interface Fixtures {
  org: {
    id: string;
    name: string;
  };
  subaccounts: Array<{
    id: string;
    organisationId: string;
    name: string;
  }>;
  agent: {
    id: string;
    organisationId: string;
    name: string;
    masterPrompt: string;
    additionalPrompt: string | null;
    modelId: string;
    temperature: number;
    maxTokens: number;
  };
  links: Array<{
    id: string;
    agentId: string;
    subaccountId: string;
    skillSlugs: string[] | null;
  }>;
  task: {
    id: string;
    organisationId: string;
    subaccountId: string;
    title: string;
    description: string;
    status: 'todo' | 'in_progress' | 'done';
  };
  user: {
    id: string;
    organisationId: string;
  };
  reviewCodeOutputs: {
    approve: string;
    blocked: string;
    malformed: string;
  };
}

/**
 * Returns a fresh Fixtures object on every call. Tests that mutate fixtures
 * (e.g. updating a task status) get isolated state by calling this once per
 * test setup.
 */
export function loadFixtures(): Fixtures {
  return {
    org: {
      id: FIXTURE_ORG_ID,
      name: 'Fixture Org',
    },
    subaccounts: [
      {
        id: FIXTURE_SUBACCOUNT_1_ID,
        organisationId: FIXTURE_ORG_ID,
        name: 'Fixture Subaccount 1',
      },
      {
        id: FIXTURE_SUBACCOUNT_2_ID,
        organisationId: FIXTURE_ORG_ID,
        name: 'Fixture Subaccount 2',
      },
    ],
    agent: {
      id: FIXTURE_AGENT_ID,
      organisationId: FIXTURE_ORG_ID,
      name: 'Fixture Agent',
      masterPrompt: 'You are a fixture agent used by tests. You always read the workspace before acting.',
      additionalPrompt: null,
      modelId: 'claude-haiku-4-5-20251001',
      temperature: 0.7,
      maxTokens: 4096,
    },
    links: [
      {
        id: FIXTURE_LINK_1_ID,
        agentId: FIXTURE_AGENT_ID,
        subaccountId: FIXTURE_SUBACCOUNT_1_ID,
        // ACTION_REGISTRY entries only — system skills (.md files like
        // read_workspace) live elsewhere and are not exercised by the
        // smoke test's registry-coverage assertion.
        skillSlugs: ['create_task', 'read_inbox'],
      },
      {
        id: FIXTURE_LINK_2_ID,
        agentId: FIXTURE_AGENT_ID,
        subaccountId: FIXTURE_SUBACCOUNT_2_ID,
        skillSlugs: null, // inherits agent default
      },
    ],
    task: {
      id: FIXTURE_TASK_ID,
      organisationId: FIXTURE_ORG_ID,
      subaccountId: FIXTURE_SUBACCOUNT_1_ID,
      title: 'Fixture Task',
      description: 'A task that exists for tests to read.',
      status: 'todo',
    },
    user: {
      id: FIXTURE_USER_ID,
      organisationId: FIXTURE_ORG_ID,
    },
    reviewCodeOutputs: REVIEW_CODE_OUTPUTS,
  };
}

// ---------------------------------------------------------------------------
// review_code methodology output samples — used by P2.2's parseVerdict tests
// (Sprint 3) and by any future smoke test that exercises the reflection loop.
//
// Format mirrors the real review_code skill output documented in
// server/skills/review_code.md → Output Format. parseVerdict reads the last
// ~200 chars looking for `Verdict[\s\S]*?(APPROVE|BLOCKED)`.
// ---------------------------------------------------------------------------

const REVIEW_CODE_OUTPUTS = {
  approve: `# Code Self-Review
**Task:** fixture-task-001
**Date:** 2026-04-08
**Files reviewed:** server/services/exampleService.ts

## Blocking Issues
No blocking issues found.

## Strong Recommendations
- Consider adding a JSDoc comment to the new exported function.

## Non-Blocking Notes
- Variable name 'x' could be more descriptive.

## Architecture Plan Compliance
**Deviations from plan:** none.

## Verdict
APPROVE — no blocking issues, ready for human review.`,

  blocked: `# Code Self-Review
**Task:** fixture-task-001
**Date:** 2026-04-08
**Files reviewed:** server/services/exampleService.ts

## Blocking Issues
- File: server/services/exampleService.ts
  Issue: Missing organisationId filter on the listExamples query (Multi-Tenant Isolation)
  Fix: Add .where(eq(examples.organisationId, orgId)) to the query.
- File: server/services/exampleService.ts
  Issue: Async route handler is not wrapped in asyncHandler (Convention Violation)
  Fix: Wrap with asyncHandler() per server/lib/asyncHandler.ts.

## Verdict
BLOCKED — 2 blocking issues listed above, fixing before resubmitting.`,

  malformed: `# Code Self-Review
This output is intentionally malformed and has no Verdict line at all.
parseVerdict() should handle this gracefully and return null.

## Notes
The methodology was not followed correctly.`,
};
