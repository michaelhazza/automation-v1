# Handoff — memory-block-edges (v2)

**Phase complete:** SPEC (v2 — supersedes v1 handoff of same date)
**Next phase:** BUILD (run `feature-coordinator` in a new session)
**Spec path:** docs/superpowers/specs/2026-05-19-memory-block-edges-spec.md
**Branch:** claude/build-memory-block-edges-7jIyt
**Build slug:** memory-block-edges
**Task class:** Standard (re-classified from Significant at 2026-05-19 after grill-me scope cuts)
**UI-touching:** no
**Mockup paths:** n/a (backend-only)
**Spec-reviewer iterations used:** 0 / 5 — SKIPPED via REVIEW_GAP (Codex CLI not installed locally)
**ChatGPT spec review log:** n/a — SKIPPED via REVIEW_GAP (operator override; routed to Phase 3 chatgpt-pr-review)

## v2 supersedes v1

The v1 handoff at this path is overwritten. v1 was authored in a remote autonomous session with 3 REVIEW_GAPs (grill-me, spec-reviewer, chatgpt-spec-review). v2 was authored locally with the brief itself emerging from a fresh 13-question grill-me pass on 2026-05-19; spec-reviewer and chatgpt-spec-review remain skipped via REVIEW_GAP for the reasons logged below. The v1 spec at the same docs path has been deleted from the working tree (preserved in git history at commit `544c5142`). See `tasks/builds/memory-block-edges/progress.md § v1 abandonment` for the full transition record.

## REVIEW_GAP entries (carried to Phase 3)

```
REVIEW_GAP: spec-reviewer | task-class: Standard | reason: Codex CLI not installed locally (`which codex` returns not-found) | operator-override: no | remediation: accept — the spec is narrowly scoped (Standard class), the brief itself emerged from a fresh grill, and the spec-conformance + pr-reviewer + chatgpt-pr-review passes in Phase 2/3 will catch directional issues. Alternative: install Codex CLI and re-run spec-reviewer in a future local-dev session before merge.

REVIEW_GAP: chatgpt-spec-review | task-class: Standard | reason: operator override 2026-05-19 (AskUserQuestion selection "Skip — record REVIEW_GAP, route external review to Phase 3 chatgpt-pr-review") | operator-override: yes-2026-05-19T<local-time> | remediation: chatgpt-pr-review at Phase 3 finalisation covers external-LLM review of the final code state. Lower friction than a manual paste-loop on the spec given the narrow surface and the prior grill-me coverage.
```

(Note: the playbook trigger taxonomy treats Standard-class chatgpt-spec-review as "policy-not-applicable" rather than mandatory; however, the v1 handoff recorded a REVIEW_GAP for it, so v2 follows the same posture for continuity. If Phase 3 chatgpt-pr-review covers external review cleanly, neither gap escalates.)

## Open questions for Phase 2

All eight intent-level Open Questions are locked at spec authoring (see `intent.md § Open Questions` and the spec's §17 Open questions). No open questions remain for the architect / builders to resolve.

**Operator decisions awaiting confirmation at the Phase 2 plan gate:**

1. Migration number 0379 — confirm at construction time; renumber if `memory-outcome-feedback`, `mcp-vendor-server-onboarding`, or `iee-worker-retirement` has taken it.
2. Closed-loop RCA writer status — whether the existing RCA-proposer job already emits `cited_memory_block_ids` in a parseable shape, or whether this build only ships the receiving surface (the Zod field + the citation writer). Either way the build is shippable; only the operational reach of the citation table differs.
3. Deprecation route path — grep `deprecateRule(` in `server/routes/` at Phase 1 chunk 6 to confirm the exact route file; spec leaves this TBD.

## Decisions made in Phase 1 (v2)

- **v1 spec abandoned.** Operator decision 2026-05-19 (AskUserQuestion selection "Abandon v1 spec, re-spec from v2"). v1 spec file removed via `git rm` (preserved in git history at commit `544c5142`). v1 intent and handoff overwritten by v2.
- **Task class re-classified Significant → Standard.** v2 narrowed surface (1 column + 1 join table + 2 service mods + 4 audit checks) fails all four Significant-class triggers.
- **Build slug retained — `memory-block-edges`.** Matches v1 directory and brief's nominated slug. No rename. Branch unchanged.
- **Step 3b grill-me skipped.** Operator decision; brief §14 already contains 13-Q grill log + intent.md §8 has 8 locked Open Questions covering all six grill topics.
- **Step 7 spec-reviewer skipped.** Codex CLI not installed locally. REVIEW_GAP recorded.
- **Step 8 chatgpt-spec-review skipped.** Operator override; routed to Phase 3 chatgpt-pr-review.
- **Schema decisions locked:** single nullable column `replaced_by_block_id` with self-supersession CHECK; new `skill_amendment_memory_citations` join table with UNIQUE-constraint idempotency; both indexes shipped; FORCE RLS enabled.
- **Service decisions locked:** `deprecateRule` extended with optional 4th parameter; citation writes piggyback on existing `withOrgTx()` boundaries at accept and retire; pure helper `extractCitedBlockIds()` factored out; behaviour table for reason-vs-replacedBy branching pinned in spec §7.1.
- **RCA payload extension locked:** optional Zod-validated `cited_memory_block_ids: string[]` field added; if RCA writer doesn't yet populate it, build still ships the receiving surface.
- **Audit-script extension locked:** four checks (orphan successor warn, supersession cycle fail, citation-pair sanity fail, RLS isolation fuzz fail) appended to `audit-memory-consolidation.ts`.
- **Observability locked:** two new event names — `memory.block.replaced_by_set`, `memory.amendment_citation_written` — plus one warning subclass `memory.block.replaced_by_ignored_for_reason`.
- **Non-goals locked:** 14 explicit non-goals carried from brief; no LLM inference, no flag, no rollout gate, no UI, no retrieval effect, no backfill.
- **Concurrent-safety with `memory-outcome-feedback`:** confirmed safe per brief §13 — zero shared source files; only `audit-memory-consolidation.ts` appends overlap (low-friction).

## Phase 2 entry checklist

When `feature-coordinator` resumes in a fresh session:

1. Read this handoff first.
2. Read the spec at `docs/superpowers/specs/2026-05-19-memory-block-edges-spec.md`.
3. Read the intent at `tasks/builds/memory-block-edges/intent.md`.
4. Read `tasks/builds/memory-block-edges/progress.md § v2 Phase 1 status` for the REVIEW_GAP history and S0 sync status.
5. Confirm the latest migration number against `migrations/` — if 0379 is already taken by parallel work, renumber.
6. Run S1 branch-sync per `feature-coordinator` Step 2.
7. Invoke `architect` to produce the implementation plan (`tasks/builds/memory-block-edges/plan.md`).
8. Run `chatgpt-plan-review` (manual mode) per `feature-coordinator` Step 4.
9. Present the finalised plan at the plan gate; operator switches to Sonnet before construction.

## Phase 2 acceptance criteria (from the spec)

Single-phase build per spec §13. Acceptance:

- Migration runs forward and backward cleanly against staging DB.
- `npm run lint`, `npm run typecheck` clean (or no new errors beyond the pre-existing `docx`/`mammoth` pair noted in `progress.md § v2 Phase 1 step 2`).
- Targeted Vitest pure-function tests for `extractCitedBlockIds` and the `replacedBy` validation branching all pass.
- New RLS-manifest entry surfaces in `verify-rls-coverage.sh`.
- Audit-script runs the four new checks against a seeded fixture set without crashing.
- Existing retrieval-path output is byte-identical (manually verified by one representative agent run before and after on staging fixtures).
