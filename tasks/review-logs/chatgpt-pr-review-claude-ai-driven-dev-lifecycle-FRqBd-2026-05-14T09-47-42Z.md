# ChatGPT PR Review Session — claude-ai-driven-dev-lifecycle-FRqBd — 2026-05-14T09:47:42Z

## Session Info
- Branch: claude/ai-driven-dev-lifecycle-FRqBd
- PR: #304 — https://github.com/michaelhazza/automation-v1/pull/304
- Build slug: development-lifecycle-governance-upgrade
- Spec path: tasks/builds/development-lifecycle-governance-upgrade/spec.md
- Plan path: tasks/builds/development-lifecycle-governance-upgrade/plan.md
- Mode: manual
- Started: 2026-05-14T09:47:42Z

Operator preferences (locked for this session):
- Link the spec; do NOT paste it. Round paste blocks reference the file path.
- Auto-reject (auto-apply prior decision for) duplicate findings on rounds 2+.

REVIEW_GAP carried into Phase 3:
- `dual-reviewer | task-class: Significant | reason: Codex CLI not installed locally | operator-override: no | remediation: accept`
  → this review serves as the substitute second-opinion pass.

---

## Round 1 — 2026-05-14T10:00:00Z

### ChatGPT Feedback (raw)

```
I'll review the uploaded PR material as a code-review pass, prioritising blocking correctness issues first, then should-fix risks and any smaller tightenings.

First pass has a few real contract risks, not just wording. The biggest pattern so far is "new governance files reference follow-up artefacts or checklist changes that are not present in the supplied diff."

Thought for 1m 40s

Verdict: not ready to merge yet. I found 3 blocking issues and 2 should-fix items in the supplied diff.

**Blocking**

F1 — Step 3/3a writes to tasks/builds/<slug>/... before Step 4 creates or ratifies the slug

The new flow says Step 3 produces:
- tasks/builds/<provisional-slug>/intent.md

Then Step 3a appends to:
- tasks/builds/<slug>/progress.md

But Step 4 is still "Build slug derivation + directory creation." That means Step 3 and Step 3a depend on a directory and slug that, by the current step order, do not officially exist yet.

Why it matters: the coordinator can fail or write to the wrong location before the lifecycle directory has been established.

Fix: either move provisional slug derivation and directory creation into Step 3 before writing intent.md, or rename Step 4 to "ratify / rename build slug" and explicitly state that Step 3 owns provisional directory creation.

F2 — Duplication / Strategy Check does not scan intent.md, the new primary artefact

Step 3a scans:
- tasks/builds/*/spec.md or brief.md

But the new Standard+ flow creates intent.md before spec authoring. A concurrent or paused build may have only intent.md, especially because this check runs before spec.md exists.

Why it matters: the duplication gate can miss exactly the new artefacts it introduced, allowing duplicate in-flight builds through.

Fix: update Step 3a to scan: tasks/builds/*/intent.md, spec.md, brief.md, and optionally progress.md / handoff.md for paused or pre-spec builds.

F3 — Strategic fit rules omit Mature and over-penalise mixed lifecycle clusters

The Strategic fit table defines:
- clear = Inception / Growth
- questionable = Declining / Sunset Candidate / Sunset
- not aligned = no cluster / decommissioned

But Mature is a valid lifecycle state and many seeded capabilities are Mature. There is no valid Strategic fit outcome for a Mature capability.

The mixed-state rule also says to use the worst state across the whole cluster. That means one Sunset row in a broad cluster could make the entire cluster questionable or blocked, even when the intent targets a separate active row.

Why it matters: normal work against mature capabilities may become unclassifiable or incorrectly blocked.

Fix: include Mature in the active/clear path, or define it as its own valid Strategic fit value. For mixed lifecycle states, evaluate the closest matching capability rows first, then apply worst-state only among matched rows, not the entire cluster.

**Should-fix**

T1 — Changelog claims files were updated, but they are not in the supplied diff
[full text preserved]

T2 — Asset Register backfill creates task links without adding the tasks
[full text preserved]

**Minor tightening**

docs/capabilities.md says "see §7.4.5" without naming the source file. Elsewhere the PR carefully disambiguates spec-section references. I'd make this explicit:
- tasks/builds/development-lifecycle-governance-upgrade/spec.md §7.4.5

**Overall**

The direction is strong, but I would not merge this round. The core conceptual issue is that the new intent.md lifecycle was inserted before the old slug/directory lifecycle without fully reconciling the ordering. Fix F1 and F2 together, then clean up the lifecycle-state classifier in F3.
```

### Top themes
- architecture (F1, F2, F3a), other (F3b), scope (T1, T2), naming (M1)

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| F1 — Step 3/3a writes before slug ratified | technical | reject | auto (reject) | high | Spec already defines provisional-slug rule at line 127 of spec-coordinator.md: "operator nominates a working slug at intent capture time so `tasks/builds/<slug>/intent.md` has a writable path. Step 4 ratifies (or, on operator decision after the duplication gate, renames) the slug." Verified against live file (`grep -n "provisional" .claude/agents/spec-coordinator.md` → line 127). ChatGPT missed the existing reconciliation. Diff-misread class. |
| F2 — Duplication scan misses intent.md | technical | implement | auto (implement) | high | Real gap. Line 201 scans `tasks/builds/*/spec.md` (or `brief.md`) only. A concurrent Standard+ build that has produced `intent.md` but not yet reached Step 6 spec authoring is invisible to the duplication gate. Verified via `grep -n "In-flight spec comparison"`. |
| F3a — Mature missing from Strategic fit classifier | technical | implement | auto (implement) | high | Real gap. Line 210 defines `clear` = Inception/Growth, `questionable` = Declining/Sunset Candidate/Sunset, `not aligned` = no cluster. Mature is a valid state (used by many seeded capabilities) but has no defined Strategic fit value. Fix: add Mature to the `clear` path — work against mature capabilities is normal. |
| F3b — Worst-state across whole cluster over-penalises | technical | reject | auto (reject) | medium | Existing line 215 already restricts to matched-cluster rows ("evaluate every Asset Register row whose cluster appears in the intent's Affected Capability Area"). The worst-state collapse only applies within those matched rows, not the entire cluster header. ChatGPT's variant is a preference, not a bug. |
| T1 — Changelog claims files updated, not in diff | technical | reject | auto (reject) | medium | False positive due to diff scope. `docs/spec-authoring-checklist.md` and `tasks/review-logs/README.md` ARE in the branch diff (verified via `git diff origin/main...HEAD --stat -- docs/spec-authoring-checklist.md tasks/review-logs/README.md` → +48 / ±2 lines respectively). They were excluded from the code-only diff sent to ChatGPT by the `docs/*spec*.md` glob and `:(exclude)tasks/review-logs` rule. The changelog claims are accurate; ChatGPT could not see those files. |
| T2 — Asset Register links to non-existent tasks/todo.md anchors | technical | reject | auto (reject) | medium | False positive due to diff scope. `tasks/todo.md` is in the branch diff (+768 lines, including capabilities-backfill and owner-resolution anchor sections) but was excluded from the code-only diff by `:(exclude)tasks/todo.md`. The anchors exist. |
| M1 — "see §7.4.5" without source file | technical | implement | auto (implement) | low | Real inconsistency with the disambiguated-reference style used elsewhere in the PR. Two occurrences in `docs/capabilities.md` (cluster-list header line 34, mutation procedure line 47). Easy mechanical fix to qualify with `tasks/builds/development-lifecycle-governance-upgrade/spec.md`. |

### Implemented (auto-applied technical)

- [auto] **F2** — `.claude/agents/spec-coordinator.md` line 201 — Step 3a's "In-flight spec comparison" now scans `tasks/builds/*/intent.md`, `tasks/builds/*/spec.md`, AND `tasks/builds/*/brief.md`. Added explicit rationale noting `intent.md` is the new primary artefact for Standard+ builds post-2026-05-14 governance upgrade.
- [auto] **F3a** — `.claude/agents/spec-coordinator.md` line 210 — Strategic fit `clear` value now includes `Mature` alongside `Inception` and `Growth`. Added explanatory note: "`Mature` is part of the `clear` path — work against mature capabilities is normal and should not require any extra gate."
- [auto] **M1** — `docs/capabilities.md` lines 34 and 47 — both `§7.4.5` references now qualified with `tasks/builds/development-lifecycle-governance-upgrade/spec.md §7.4.5`.

### Verification
- `npm run lint`: 0 errors (pre-existing warnings only — none from this round's edits since changes are markdown)
- `npm run typecheck`: clean

---
