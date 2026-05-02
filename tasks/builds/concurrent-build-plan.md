# Concurrent Build Coordination — F1, F2, F3

**Date:** 2026-05-01
**Specs:**
- F1 — `docs/sub-account-baseline-artefacts-spec.md`
- F2 — `docs/sub-account-optimiser-spec.md`
- F3 — `docs/baseline-capture-spec.md`
- F4 (deferred) — `docs/agency-readiness-audit-deferred.md`

This document is the playbook for running F1, F2, and F3 concurrently in three separate worktrees.

## Sections

- §1 Migration + branch + worktree allocation
- §2 Worktree setup commands
- §3 File-collision matrix
- §4 Merge order
- §5 Per-session kickoff prompts
- §6 Cross-session communication
- §7 Final integration + closeout

---

## §1 Migration + branch + worktree allocation

| Build | Slug | Branch | Worktree path | Migration(s) | Spec | Progress file |
|-------|------|--------|---------------|--------------|------|---------------|
| F1 | `subaccount-artefacts` | `claude/subaccount-artefacts` | `../automation-v1.subaccount-artefacts` | 0266 | `docs/sub-account-baseline-artefacts-spec.md` | `tasks/builds/subaccount-artefacts/progress.md` |
| F2 | `subaccount-optimiser` | `claude/subaccount-optimiser` | `../automation-v1.subaccount-optimiser` | 0267 | `docs/sub-account-optimiser-spec.md` | `tasks/builds/subaccount-optimiser/progress.md` |
| F3 | `baseline-capture` | `claude/baseline-capture` | `../automation-v1.baseline-capture` | 0268, 0269, 0270 | `docs/baseline-capture-spec.md` | `tasks/builds/baseline-capture/progress.md` |
| F4 | (deferred) | — | — | (reserve 0271) | `docs/agency-readiness-audit-deferred.md` | — |

**Migration allocation rule:** each build owns its claimed numbers. If a build needs more migrations than allocated, claim the next free range and update this file before starting.

**Last shipped migration on main:** 0265. Next free is 0266 → claimed by F1.

---

## §2 Worktree setup commands

Run these from the main checkout (`/home/user/automation-v1`) before opening any of the three concurrent sessions.

```bash
# F1
git worktree add -b claude/subaccount-artefacts ../automation-v1.subaccount-artefacts main

# F2
git worktree add -b claude/subaccount-optimiser ../automation-v1.subaccount-optimiser main

# F3
git worktree add -b claude/baseline-capture ../automation-v1.baseline-capture main

# Verify
git worktree list
```

Each worktree is a fully independent checkout — installs, build artefacts, dev servers all live separately. Per-worktree `node_modules`:

```bash
cd ../automation-v1.subaccount-artefacts && npm install
cd ../automation-v1.subaccount-optimiser && npm install
cd ../automation-v1.baseline-capture && npm install
```

To remove a worktree after merge:

```bash
git worktree remove ../automation-v1.subaccount-artefacts
git branch -d claude/subaccount-artefacts  # only after merge
```

---

## §3 File-collision matrix

Files touched by more than one build need explicit coordination. Where two builds touch the same file but at non-overlapping line ranges or with additive-only modifications, conflict risk is low. Where they touch the same function or schema column, merge order matters.

| File | F1 | F2 | F3 | Collision risk | Resolution |
|------|----|----|----|----------------|------------|
| `migrations/*.sql` | 0266 | 0267 | 0268-0270 | None — separate files | Numbers reserved |
| `server/db/schema/memoryBlocks.ts` | adds `tier`, `applies_to_domains` | — | — | None | F1 owns |
| `server/db/schema/subaccounts.ts` | adds `baseline_artefacts_status` | — | — | None | F1 owns |
| `server/db/schema/subaccountRecommendations.ts` | — | new file | — | None | F2 owns |
| `server/db/schema/subaccountBaselines.ts` | — | — | new file | None | F3 owns |
| `server/db/schema/subaccountBaselineMetrics.ts` | — | — | new file | None | F3 owns |
| `server/db/rlsProtectedTables.ts` | — | adds entry | adds entries | Low — additive | Both append; merge auto-resolves with `git merge` |
| `server/db/canonicalDictionary.ts` | — | adds entry | adds entries | Low — additive | Same |
| `server/services/agentExecutionService.ts` | line ~834 region (loader) | — | — | None | F1 owns |
| `server/services/memoryBlockService.ts` | extends `getBlocksForInjection`, adds `getTier1Blocks` | — | — | None | F1 owns |
| `server/services/subaccountOnboardingService.ts` | adds `markArtefactCaptured` | — | adds `pending` baseline row creation | Medium — both add new methods | Additive only; merge order F1 → F3 |
| `server/services/skillExecutor.ts` | — | adds 6 switch cases | — | None | F2 owns |
| `server/services/agentScheduleService.ts` | — | registers optimiser schedule | — | None | F2 owns |
| `server/services/connectorPollingService.ts` | — | — | adds event emit | None | F3 owns |
| `server/services/intelligenceSkillExecutor.ts` | — | — | extends with baseline helper | None | F3 owns |
| `server/routes/subaccounts.ts` | — | — | manual entry endpoint + extends `121-150` hook | Low | F3 only; if F1 also extends `121-150` for baseline-status-row creation, coordinate via merge |
| `server/lib/tracing.ts` | adds 2 event names | — | adds 5 event names | Low — additive | Both append to event registry |
| `shared/schemas/subaccount.ts` | extends with `baseline_artefacts_status` | — | extends with `baseline_metrics_opt_in` | Low | Different keys; additive |
| `client/src/pages/OnboardingWizardPage.tsx` | adds new step | — | — | None | F1 owns |
| `client/src/pages/SubaccountDetailPage.tsx` | — | adds RecommendationsCard | adds BaselineStatusBadge + ManualBaselineForm | Medium | Both add new card components — no shared mutation; merge order doesn't matter |
| `client/src/components/Sidebar.tsx` | — | adds rec-count badge | — | None | F2 owns |

**Highest-risk files:** `server/services/subaccountOnboardingService.ts` (F1 + F3 both extend), `server/routes/subaccounts.ts` (F1 + F3 both extend), `client/src/pages/SubaccountDetailPage.tsx` (F2 + F3 both add components).

In all three high-risk cases, the rule is: **additive only**. Each session adds new methods/components without modifying existing functions or other sessions' work. `git merge` will resolve cleanly when each PR lands sequentially.

---

## §4 Merge order

**Recommended order: F1 → F3 → F2**

Rationale:
1. **F1 first** — smallest schema surface (1 migration), foundational for context inheritance, F3's user-facing artefact context references F1's baseline brand voice.
2. **F3 second** — depends on F1 having extended `subaccountOnboardingService.ts`. Lands next so the `121-150` hook is extended in one direction.
3. **F2 last** — fully independent, but the `escalation.repeat_phrase` recommendation category gracefully degrades without F1's brand voice block. Landing F2 last lets the action hint reference F1 cleanly.

If a build slips, alternative orders:
- **F2 → F1 → F3** is also safe; F2 doesn't touch any file F1 or F3 owns.
- **F1 → F2 → F3** is also safe; same reasoning.
- **F3 → F1** would force F1 to rebase on F3's changes to `subaccountOnboardingService.ts`. Avoid unless F3 lands much faster.

**Never merge two builds simultaneously.** Land one, let CI green, then start the next merge.

---

## §5 Per-session kickoff prompts

Open three Claude Code sessions, one in each worktree. Use these kickoff prompts verbatim.

### F1 — Sub-account artefact set (worktree: `../automation-v1.subaccount-artefacts`)

> Read `docs/sub-account-baseline-artefacts-spec.md` end to end. The spec is finalised. Open `tasks/builds/subaccount-artefacts/progress.md` and start at Phase 0 (Riley documentation sync). Update progress.md after each phase completes; never skip ahead. Spec-conformance + pr-reviewer pipeline applies before any merge. Concurrent peers F2 and F3 are running in `../automation-v1.subaccount-optimiser` and `../automation-v1.baseline-capture` — see `tasks/builds/concurrent-build-plan.md` for the file-collision matrix; stay within the F1 column.

### F2 — Sub-account optimiser (worktree: `../automation-v1.subaccount-optimiser`)

> Read `docs/sub-account-optimiser-spec.md` end to end. The spec is finalised. Open `tasks/builds/subaccount-optimiser/progress.md` and start at Phase 1 (schema + recommendation taxonomy). Update progress.md after each phase completes. Spec-conformance + pr-reviewer pipeline applies before any merge. Concurrent peers F1 and F3 are running in sibling worktrees — see `tasks/builds/concurrent-build-plan.md` for the file-collision matrix; stay within the F2 column. F2 is fully independent of F1 and F3, but `escalation.repeat_phrase` action hint references the brand voice profile from F1 — degrade gracefully if F1 hasn't merged yet.

### F3 — Baseline capture (worktree: `../automation-v1.baseline-capture`)

> Read `docs/baseline-capture-spec.md` end to end. The spec is finalised. Open `tasks/builds/baseline-capture/progress.md` and start at Phase 1 (schema). Update progress.md after each phase completes. Spec-conformance + pr-reviewer pipeline applies before any merge. Important: GHL Module C OAuth is stubbed today — initial coverage is per-sub-account-OAuth'd accounts only; document this in PR description. Concurrent peers F1 and F2 are running in sibling worktrees — see `tasks/builds/concurrent-build-plan.md` for the file-collision matrix; stay within the F3 column. F1 should land before F3 — coordinate via merge order.

---

## §6 Cross-session communication

Sessions running in parallel cannot see each other's chat history or todo lists. They communicate exclusively via:

1. **`tasks/builds/concurrent-build-plan.md`** (this file) — the source of truth for what's claimed and what's risky.
2. **Per-build `progress.md`** — each session updates its own; reads peers' progress.md to know what's landed.
3. **Git** — once a peer's PR merges to main, the other sessions rebase their branch onto main to pick up the changes.

**Rule:** if a session needs to modify something outside its column in §3, it MUST update this plan (add to file-collision matrix) before making the change. This file is the single source of truth.

**Migration number conflicts:** if a session needs more migrations than allocated, claim the next free range (currently 0271 onward) and update §1 immediately, BEFORE writing the migration file.

---

## §7 Final integration + closeout

After all three PRs merge to main:

1. Run full local sanity: `npm run lint && npm run typecheck`. CI runs the full test gates.
2. Verify each build's "Done definition" against main:
   - F1: tier-1 blocks present in agent system prompts; six artefacts capturable
   - F2: optimiser scheduled per sub-account; recommendations surface in UI
   - F3: baseline auto-captures on readiness; manual entry works; Reporting Agent narrates delta
3. Update `tasks/current-focus.md` to reflect the new state — set to `none` if no follow-up sprint is queued.
4. Append a single `KNOWLEDGE.md` entry capturing any cross-build lessons (e.g. "additive-only modification pattern works for parallel builds touching same files").
5. Remove worktrees: `git worktree remove ../automation-v1.subaccount-artefacts` (and the other two).
6. Archive `tasks/builds/concurrent-build-plan.md` by appending a "Closeout" section noting all three landed and removing it from `current-focus.md` if referenced.

After closeout, F4 (`docs/agency-readiness-audit-deferred.md`) becomes the next candidate to pick up — see its file for the pickup signal.
