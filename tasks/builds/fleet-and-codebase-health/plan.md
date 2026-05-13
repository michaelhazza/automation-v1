# Plan: Fleet & Codebase Health Upgrades

**Slug:** `fleet-and-codebase-health`
**Spec:** `tasks/builds/fleet-and-codebase-health/spec.md` (LOCKED 2026-05-12)
**Class:** Major (cross-cutting)
**Authored:** 2026-05-12
**Builder model:** Sonnet (this plan resolves every architectural choice; no mid-chunk Opus reasoning required)
**Executor pattern:** `superpowers:subagent-driven-development` — one `builder` invocation per chunk; operator commits between chunks

---

## Table of Contents

1. Model-collapse check
2. Branch posture
3. Chunk overview
4. Cross-chunk dependencies
5. Risk → mitigation mapping
6. Chunk 1 — Fix `verify-no-db-in-routes.sh`
7. Chunk 2 — `replit.md` typecheck correction
8. Chunk 3 — Move `prototypes/` + `attached_assets/` to `_archive/`
9. Chunk 4 — `pr-reviewer` severity tiers + "Why:" + disclosure
10. Chunk 5 — `adversarial-reviewer` STRIDE + trust-boundary
11. Chunk 6 — Minimal-change rules → CLAUDE.md §6 + `builder.md`
12. Chunk 7 — New `reality-checker` agent + pipeline wiring
13. Chunk 8 — New `incident-commander` agent + `docs/incident-response.md`
14. Chunk 9 — Reviewer-coverage policy (GRADED) + REVIEW_GAP enforcement
15. Chunk 10 — `docs/testing-transition-plan.md`
16. Chunk 11 — Route violator triage (9 sub-chunks)
17. Chunk 12 — `KNOWLEDGE.md` sweep
18. Chunk 13 — `tasks/todo.md` triage sprint
19. Final acceptance
20. Executor notes

---

## 1. Model-collapse check

Not applicable. This is a hygiene effort across agent definitions, gate scripts, route refactors, archive moves, doc trims and policy edits. There is no ingest → extract → transform → render pipeline to collapse. A frontier model in a single call cannot rewrite gate scripts on disk, run `git mv`, edit multiple `.claude/agents/*.md` files, or refactor 9 route files — and the verification surface (lint, typecheck, build, the gate itself failing then passing) is inherently file-system stateful. Reject collapse: the work *is* the file edits.

## 2. Branch posture

**Default branch split confirmed per spec §8.** Two branches, two PRs.

- **Branch 1 — `fleet-and-process`:** Chunks 2, 4, 5, 6, 7, 8, 9, 10. Mostly agent files + CLAUDE.md edits + `replit.md` typecheck fix + transition-plan doc. Low blast radius. CI green throughout.
- **Branch 2 — `codebase-health`:** Chunks 1, 3, 11, 12, 13. Gate fix + 9 route migrations + archive moves + KNOWLEDGE/todo sweeps. Higher blast radius; intentionally CI-red after Chunk 1 until Chunk 11's 9 sub-chunks complete. Inventory chunks (12, 13) at the end.

Branches are independent and can be worked in either order, but Branch 1 should land first because Chunk 9 (reviewer-coverage policy) references Chunk 7's new `reality-checker` agent — see §4 Cross-chunk dependencies.

### Branch 2 — Chunk 1 → Chunk 11 CI-red window

**Decision: tight-sequence (no env-var gate).**

Branch 2 lands Chunks 1 and 3 in the first commits; then opens Chunk 11 immediately. The branch is CI-red between Chunk 1's commit and the 9th sub-chunk of Chunk 11. Since Branch 2 never merges until all 9 violators are migrated, the red-CI window is intra-branch only — no protected branch is affected.

Rejected alternative: env-var-gated strict matcher (`STRICT=1`). Adds a kill-switch that must be removed in a follow-up commit once Chunk 11 lands — exactly the deferred-debt antipattern the C1 sweep is trying to eliminate. CLAUDE.md §6 (every changed line traces to the user's request) and §11 (docs stay in sync with code) both push against temporary scaffolding. Tight-sequence keeps the gate honest from commit 1.

**Operator-visible consequence:** Branch 2 CI runs go red after the Chunk 1 commit and stay red until the 9th Chunk-11 sub-chunk lands. Each sub-chunk should reduce the violation count by exactly 1 (verifiable by reading the gate's summary line in the CI log). The branch is mergeable when the count hits 0.

**PR hygiene during the red-CI window (Branch 2 only).** While Branch 2 is in the intentional red-CI window:

- Do NOT open the PR.
- Do NOT request review from `pr-reviewer` at branch level, `chatgpt-pr-review`, or any reviewer that consumes CI signal.
- Do NOT apply the `ready-to-merge` label.
- Do NOT push to `main` from this branch under any circumstance.

The PR is opened only after the 9th Chunk-11 sub-chunk lands AND the gate reports exit 0. This prevents noisy review cycles (reviewers chasing a red signal that is intentional) and prevents normalising red CI on the protected branch surface. Branch 1 has no analogous restriction — it stays CI-green throughout.

## 3. Chunk overview

13 chunks, branch-tagged.

| # | Chunk | Branch | WS | Effort | Acceptance shape |
|---|-------|--------|----|--------|------------------|
| 1 | Fix `verify-no-db-in-routes.sh` (gate only) | 2 | B1 | S | **Inverse** — gate FAILS reporting 9 violators |
| 2 | `replit.md` typecheck correction | 1 | B2 | S | Doc edit |
| 3 | Move `prototypes/` + `attached_assets/` → `_archive/` | 2 | C4 | S | `git mv` + ref sweep |
| 4 | `pr-reviewer` severity tiers + "Why:" + "Files NOT read" | 1 | A1 | S | Agent contract edit |
| 5 | `adversarial-reviewer` STRIDE + trust-boundary | 1 | A3 | S | Agent contract edit |
| 6 | Minimal-change rules → CLAUDE.md §6 + `builder.md` | 1 | A4 | S | Doc + agent edit |
| 7 | New `reality-checker` agent + pipeline wiring | 1 | A2 | M | Frontmatter-valid agent + pipeline insert + `validate-setup` green |
| 8 | New `incident-commander` agent + `docs/incident-response.md` | 1 | A5 | M | Frontmatter-valid agent + new doc + `validate-setup` green |
| 9 | Reviewer-coverage policy (GRADED) + REVIEW_GAP enforcement | 1 | D1 | M | CLAUDE.md + 2 coordinators carry the posture; REVIEW_GAP artifact format documented |
| 10 | `docs/testing-transition-plan.md` (T-minus-14 trigger) | 1 | D2 | M | New doc with inventory + sequencing |
| 11 | Route violator triage — 9 sub-chunks | 2 | B1 | M-L | Each sub-chunk: gate violation count -1; T2 invariant holds |
| 12 | `KNOWLEDGE.md` sweep — inventory → approval → apply | 2 | C2 | M | ≤2,500 lines post-sweep |
| 13 | `tasks/todo.md` triage — inventory → approval → apply | 2 | C1 | L | ≤500 lines post-triage |

Chunks 1-10 are pure file edits with no open architectural questions. Chunks 11.1-11.9 each land independently. Chunks 12 and 13 are **two-step with mandatory operator gate** — see §17, §18.

## 4. Cross-chunk dependencies

Forward-only.

| Predecessor | Successor | Reason |
|-------------|-----------|--------|
| Chunk 1 | Chunk 11.* | Gate must be strict before any migration so each sub-chunk can verify violation-count decrement. |
| Chunk 7 (`reality-checker` agent file) | Chunk 9 (policy) | Chunk 9 edits `feature-coordinator` pipeline to call `reality-checker` between pr-reviewer and dual-reviewer. Agent file must exist first or coordinator references a missing file. |
| Chunk 8 (`incident-commander` agent file) | none in this plan | `incident-commander` does not enter any coordinator pipeline; standalone. |
| Chunks 1-11 | Chunk 12 (`KNOWLEDGE.md`) | KNOWLEDGE entries that fall out of WS-A/B work should land in Chunk 12's inventory, not the live file. |
| Chunks 1-11 | Chunk 13 (`tasks/todo.md`) | Same reasoning: this build will surface follow-ups; they belong in the triage inventory. |
| Chunk 9 (REVIEW_GAP) | Chunk 13 (todo triage) | Chunk 13 sweeps SHIP/ARCHIVE/ACCEPT; any REVIEW_GAP entries currently in `tasks/current-focus.md` or `tasks/todo.md` get categorised per Chunk 9's posture. |

No backward dependencies. Each chunk is independently merge-eligible if the predecessor is in place.

## 5. Risk → mitigation mapping

Per spec §10.

| Risk | Lands in chunk(s) | Mitigation |
|------|-------------------|------------|
| Route migrations break runtime | 11.1–11.9 | One sub-chunk per violator; G1 (lint+typecheck+build:server) per sub-chunk; `pr-reviewer` mandatory at branch-level review; the strict gate from Chunk 1 catches any "moved DB access back into the route" regression. |
| KNOWLEDGE.md sweep loses context | 12 | Two-step inventory + operator approval; dated `## 2026-05 quarterly trim` header; full pre-sweep KNOWLEDGE.md remains in git history. |
| todo.md triage misclassifies real item as ARCHIVE | 13 | Two-step inventory + operator approval; archive is in-repo (`tasks/todo-archive/2026-Q2.md`), reversible via `git mv`. |
| Reviewer-policy posture wrong | 9 | Single-section CLAUDE.md edit + 2 coordinator edits; reversible in a single revert. |
| `reality-checker` adds friction without value | 7 | Skipped on Trivial/Standard; manual override per spec §3.A2; revisit after 5 runs. |
| `incident-commander` never used | 8 | Acceptable cost — present-when-needed beats absent-when-needed. |
| Future support-desk context lost (PR #277) | n/a | Pre-plan decision; closing comment + paused-build line + branch retention preserve the trail. |

## 6. Chunk 1 — Fix `verify-no-db-in-routes.sh` (gate-only)

**Branch:** 2 (`codebase-health`)
**Effort:** S
**Predecessors:** none

**Why the gate is currently silent on 9 violators.** `scripts/verify-no-db-in-routes.sh` lines 14-39 hard-code a 22-entry `WHITELIST` array. The grep at line 63 catches every direct-`db` import in `server/routes/`; the matcher itself is correct. Every file in the WHITELIST is bypassed at line 56 via `is_whitelisted "$file" && continue`. That is the only reason the 9 violators are not failing CI. The fix is to delete the WHITELIST array and rely exclusively on per-line `guard-ignore` suppressions in the T1 token format.

**Files to edit:**

- `scripts/verify-no-db-in-routes.sh` — remove the 22-entry `WHITELIST` array (lines 14-39) and the `is_whitelisted` function (lines 41-47) and its call site (line 56). Keep everything else.
- `server/routes/workspaceInboundWebhook.ts` — **only if** its current `guard-ignore` comment does not match the T1 token shape. Read the file first; edit only if non-conforming. The T1 token shape is:
  ```
  // guard-ignore verify-no-db-in-routes: <ADR-id> <one-line rationale>
  ```

**Files to create (conditional):**

- `docs/decisions/<NNNN>-workspace-inbound-webhook-db-exception.md` — **only if** Chunk 1 needs to attach an ADR id to the `workspaceInboundWebhook.ts` guard-ignore comment and no existing ADR covers it. Builder: run `ls docs/decisions/` first to determine the next sequential ADR number; one-paragraph rationale matching the existing webhook-exception reasoning.

**Files to read (no edit):**

- `scripts/lib/guard-utils.sh` — confirm `is_suppressed`, `emit_violation`, `check_baseline` semantics; verify the new T1 token shape parses through `is_suppressed` correctly. If not, the script needs a regex update too — add it inside `scripts/lib/guard-utils.sh` as a reusable helper (e.g. `validate_adr_tagged_guard_ignore`), not as a one-off in this gate.

**What the matcher must do after the edit:**

1. Walk every file in `server/routes/` (already does — line 63).
2. Emit a violation for any `import.*db.*from.*['\"].*\/db` match (already does — line 63).
3. Skip only files where the matching line is suppressed by a T1-shaped `guard-ignore` comment. The accepted token shape uses `<ADR-id>` matching `\d{4}-[a-z0-9-]+` (the existing `docs/decisions/` filename convention).
4. **Reject** any bare `guard-ignore` with no ADR-id or rationale — emit a `policy-violation` at line +0 explaining the bad shape. This is the spec §4.B1 T1 requirement.
5. The file-level `WHITELIST` array is gone. Per-line suppression via `guard-ignore` is the only allowed exception path.

**Module shape:**

- *Public interface:* shell script returning exit code 0/2 (existing contract via `check_baseline`).
- *What stays hidden:* the T1 token regex; the diagnostic message for malformed tokens; helper additions to `scripts/lib/guard-utils.sh` if needed.

**Verification commands** (per `references/test-gate-policy.md`):

```
# 1. Run the script directly — it MUST report 9 violators and exit non-zero (FAIL).
bash scripts/verify-no-db-in-routes.sh
# Expected: non-zero exit, summary line reports 9 violations.
# The 9 violators must be: agentPromptRevisions.ts, mcp.ts, projects.ts,
# agentTriggers.ts, permissionSets.ts, integrationConnections.ts, portal.ts,
# systemEngines.ts, webhookAdapter.ts.

# 2. Confirm workspaceInboundWebhook.ts is NOT in the violator list.

# 3. Hand-craft a temporary scratch route with a bad guard-ignore comment
#    (e.g. `// guard-ignore foo` with no ADR id) to confirm the policy-violation
#    path triggers. Use a uniquely named scratch file such as
#    `server/routes/__scratchVerifyNoDbInRoutes.ts` so accidental staging is
#    obvious. Delete the scratch file before commit; confirm `git status --short`
#    is clean of the scratch path before returning the chunk verdict. Do NOT
#    include the scratch file in the chunk's diff.
```

Builder does NOT run `lint`/`typecheck`/`build` here — only the gate script. The chunk touches no TS code.

**Inverse acceptance (spec §8 F1):**

- `bash scripts/verify-no-db-in-routes.sh` exits non-zero (FAIL).
- The 9 violators above are listed; no others.
- `workspaceInboundWebhook.ts` is NOT listed (its guard-ignore is honored).
- No route file other than `workspaceInboundWebhook.ts` has been edited.
- A green gate at this chunk is a **failure** — the gate was weakened or routes were edited prematurely.

**Docs touched (doc-sync checklist):** `scripts/verify-no-db-in-routes.sh`; optionally one new ADR under `docs/decisions/`; optionally `scripts/lib/guard-utils.sh`. No other doc changes.

**Builder notes:**

- Do NOT touch any of the 9 violator route files. Chunk 11 owns those.
- The grep at line 63 is `import.*db.*from.*['\"].*\/db` — broad enough to catch any path shape. If Chunk 1 surfaces MORE than 9 violators after the WHITELIST removal, STOP and report. The spec asserts exactly 9; a higher count means the spec's audit was incomplete and the plan needs a re-think.
- If `is_suppressed` does not parse the new T1 shape, add the parsing logic to `scripts/lib/guard-utils.sh` rather than special-casing in the route gate. Future gates may need the same ADR-tagged exception pattern.

## 7. Chunk 2 — `replit.md` typecheck correction

**Branch:** 1 (`fleet-and-process`)
**Effort:** S
**Predecessors:** none

**Files to edit:**

- `replit.md` line 22 (and any nearby lines that reiterate "no typecheck"). Replace with a one-line reference to the `typecheck` npm script and a pointer to the dual-tsconfig form noted elsewhere in CLAUDE.md.

**Files to read (no edit):**

- `package.json` — confirm the exact npm script name (`typecheck` or other) before editing.
- `CLAUDE.md` — locate the dual-tsconfig one-liner reference; cite it the same way `replit.md` cites other docs.

**Verification commands:**

```
# Step 1 — read-only sanity (always permitted): confirm package.json contains
#         the script the doc now claims exists.
#   grep '"typecheck"' package.json   (or open package.json directly)

# Step 2 — execute only if the §20 verification budget permits AND the
#         starting commit's typecheck baseline is expected green.
npm run typecheck
```

**Acceptance:**

- `replit.md` line 22 (or wherever the false claim lives) now correctly references the `typecheck` script.
- `package.json` contains the `typecheck` script the doc now references.
- If executed: `npm run typecheck` exits 0. If skipped (baseline not expected green, or chunk run outside the local verification budget): the doc edit lands without the runtime check, since the underlying script existence is verified by the package.json grep alone.

**Docs touched (doc-sync checklist):** `replit.md` only.

**Builder notes:**

- Single-edit chunk. Do not "while-you-are-there" rewrite other parts of `replit.md`. CLAUDE.md §6 — surgical change.
- If `npm run typecheck` is red on the starting commit, STOP — pre-existing baseline issue. Report and ask before editing `replit.md`.

## 8. Chunk 3 — Move `prototypes/` + `attached_assets/` to `_archive/`

**Branch:** 2 (`codebase-health`)
**Effort:** S
**Predecessors:** none (independent of Chunk 1; Branch 2 ordering can interleave)

**Pre-move sanity check (symlinks + generated references).** Before `git mv`, run:

```
find prototypes attached_assets -type l -ls
```

Asset folders occasionally contain symlinks (developer-local conveniences, generated by build tooling, or leftover from import scripts). If any are found, list them in the chunk verdict for operator confirmation BEFORE the move — `git mv` on a symlink moves the link, not the target, which is usually but not always what is wanted.

**File operations:**

```
git mv prototypes _archive/prototypes
git mv attached_assets _archive/attached_assets
```

**Files to create:**

- `_archive/README.md` — one paragraph (≤6 lines): "This directory holds historical assets and prototypes preserved in-repo for git-history continuity. Active work lives at the repo root. Do not add new files here without operator sign-off."

**Files to edit (after the move):**

Builder runs a repo-wide grep to find any in-code or in-doc references to the old paths:

```
rg "prototypes/|attached_assets/" --type=md --type=ts --type=tsx --type=json --type=yaml --type=yml
```

For each hit:

- **Build artifact** (e.g. `tasks/builds/*/mockup-log.md`, `tasks/builds/*/spec.md`): leave the reference alone — historical record. The in-repo move was chosen partly for this reason (spec §11 decision 3): the path now resolves under `_archive/`.
- **Active doc** describing current state (e.g. `README.md`, `CLAUDE.md`, `architecture.md`, `docs/**.md` other than build-archives): update to the new `_archive/...` path.
- **Active TS/JSON config** (e.g. `.gitignore`, `vite.config.ts`, `tsconfig.json`, `eslint.config.js`): update.
- **Content inside the moved dirs** (now under `_archive/`): leave.

**Files to read (no edit):**

- `.gitignore` — check for obsolete root-path entries for `prototypes/` or `attached_assets/`. Update or remove.
- `tsconfig.json` / `tsconfig.*.json` — confirm no `include`/`exclude` glob references the old paths.

**Module shape:** N/A (file moves).

**Verification commands:**

```
# Confirm git tracked the moves (history preserved)
git log --follow --oneline _archive/prototypes/<any-file-from-the-old-dir>
git log --follow --oneline _archive/attached_assets/<any-file-from-the-old-dir>
# Both must show pre-move history.

# Confirm no stale references break build
npm run typecheck
npm run build:client  # only if attached_assets/ or prototypes/ were referenced from client/
npm run build:server  # only if either was referenced from server/

# T7 path-reference sweep (spec §5.C4)
rg "prototypes/|attached_assets/" --type=md --type=ts --type=tsx --type=json --type=yaml --type=yml
# Every remaining hit must either point at `_archive/...`, or live in a
# build-history doc under tasks/builds/* (historical, intentional).
```

**Acceptance (spec §5.C4 T7):**

- `_archive/prototypes/` and `_archive/attached_assets/` exist; old top-level dirs are gone.
- `_archive/README.md` exists.
- `git log --follow` on a sample file from each archived dir shows pre-move history.
- `rg` sweep is clean per the rule above.
- `npm run build:client` and `npm run build:server` pass (only the affected one; skip both if neither client/ nor server/ referenced the old paths).
- `npm run typecheck` passes.

**Docs touched (doc-sync checklist):** `_archive/README.md` (new), any in-code reference files, `.gitignore` if affected.

**Builder notes:**

- Use `git mv` exclusively, never `mv` + `git add`. Spec §5.C4 constraint is explicit on preserving git history.
- Confirm before the moves that no untracked files exist in `prototypes/` or `attached_assets/` — `git mv` won't move untracked files. If any exist, ask the operator (likely safe to `git mv` after `git add`, but verify intent).
- Do NOT delete anything from `_archive/` after the move. Mention any obvious-looking stale items in the chunk return summary; do not act.

## 9. Chunk 4 — `pr-reviewer` severity tiers + "Why:" + disclosure

**Branch:** 1 (`fleet-and-process`)
**Effort:** S
**Predecessors:** none

**Files to edit:**

- `.claude/agents/pr-reviewer.md` — restructure the "Review Output" section (current lines 20-45):
  - Replace the three current tier headings (`Blocking Issues` / `Strong Recommendations` / `Non-Blocking Improvements`) with the spec §3.A1 tier glyphs and naming:
    - `🔴 Blocking — must be fixed before merge`
    - `🟡 Should-fix — non-blocking but expected to be addressed in-PR unless explicitly deferred`
    - `💭 Consider — taste / future-proofing / nice-to-have`
  - Add a contract rule: every finding's output line MUST prefix with `[🔴|🟡|💭] <file:line>` and MUST carry a `Why: <one-line rationale>` immediately after the finding statement.
  - Add an output rule: the persisted log MUST end with a verdict-summary line of the form `Blocking: N / Should-fix: N / Consider: N` IMMEDIATELY before the `**Verdict:**` line.
  - Add a "Files NOT read" section template after the tiers section. Required when the agent skimmed parts of the diff. Each entry: `<path> — <reason>`. Add the spec §3.A1 disclosure-constraint sentence verbatim: *"If files are not read, state whether unread files could invalidate the verdict. If yes, the verdict cannot be `APPROVED`."*
- `tasks/review-logs/README.md` — update the "Verdict header convention" / output-format section to reference the new tier glyphs and the `Blocking: N / Should-fix: N / Consider: N` summary line. The Mission Control dashboard regex referenced in `pr-reviewer.md` line 113 must continue to match — DO NOT change the `**Verdict:** APPROVED|CHANGES_REQUESTED|NEEDS_DISCUSSION` enum.

**Files to read (no edit):**

- `tasks/review-logs/` — sample 2-3 existing `pr-review-log-*.md` files to confirm the dashboard-parsed verdict line shape is preserved verbatim under the new tier system.

**Module shape:**

- *Public interface:* the agent's verdict enum (unchanged) and the parsed log shape consumed by Mission Control.
- *What stays hidden:* the new tier glyphs, the `Why:` discipline, the disclosure constraint — implementation details of the agent's reasoning, not the dashboard contract.

**Verification commands:**

```
bash scripts/validate-setup.sh  # if exists; if not, builder notes it in the return
# Doc-edit only — no lint/typecheck/build needed.
```

**Acceptance:**

- `.claude/agents/pr-reviewer.md` "Review Output" section uses the three tier glyphs + names from spec §3.A1.
- Output template includes `[🔴|🟡|💭] <file:line>` prefix and `Why:` line per finding.
- `Blocking: N / Should-fix: N / Consider: N` summary line is required immediately before `**Verdict:**`.
- "Files NOT read" section template is present with the disclosure-constraint sentence.
- `**Verdict:**` enum (`APPROVED` / `CHANGES_REQUESTED` / `NEEDS_DISCUSSION`) is unchanged — Mission Control parsing preserved.
- `tasks/review-logs/README.md` mentions the new tier glyphs and the summary line.

**Docs touched (doc-sync checklist):** `.claude/agents/pr-reviewer.md`, `tasks/review-logs/README.md`.

**Builder notes:**

- Do NOT change what `pr-reviewer` *does* — only the output shape. Spec §3.A1 non-goals.
- Preserve the read-only tool constraint (`tools: Read, Glob, Grep`) verbatim.
- Preserve `model: opus` — pr-reviewer is the most-cited reviewer; downgrading weakens every Significant/Major review.
- Keep the existing "Specific Things to Check" checklist (lines 48-86) — still load-bearing.

## 10. Chunk 5 — `adversarial-reviewer` STRIDE + trust-boundary

**Branch:** 1 (`fleet-and-process`)
**Effort:** S
**Predecessors:** none

**Files to edit:**

- `.claude/agents/adversarial-reviewer.md` — extend the "Threat model checklist" section (current lines 58-69):
  - Add a new sub-section `### STRIDE sweep` immediately before "Finding labels". Required pass over each of the six STRIDE categories. Each category produces either one or more findings (using the existing `confirmed-hole` / `likely-hole` / `worth-confirming` labels) OR an explicit `no applicable risk in this diff` line. No silent skipping.
    - Spoofing
    - Tampering
    - Repudiation (the underweighted category per spec rationale — call this out in the contract: "no audit-trail" / "no idempotency record" findings live here, not under Tampering)
    - Information disclosure
    - Denial of service
    - Elevation of privilege
  - Add a new sub-section `### Trust-boundary callout` after STRIDE. Lists every boundary the diff crosses (examples: `subaccount -> organisation`, `external webhook -> server`, `LLM provider -> our prompt`, `client -> route`, `user -> system_admin`). For each boundary, state the enforcement mechanism the change relies on (e.g. "RLS policy `<name>`", "HMAC verification in `<file>`", "`requireSystemAdmin` middleware"). If a boundary is crossed without a named enforcement mechanism, that itself is a `likely-hole`.
- The existing six-category checklist (lines 60-67) stays — STRIDE is additive, not a replacement. Page reads: existing six categories → STRIDE → trust-boundary callout → finding labels → output envelope.

**Files to read (no edit):**

- `tasks/review-logs/` — sample 1-2 existing `adversarial-review-log-*.md` files to confirm the verdict-line regex is unaffected.

**Module shape:**

- *Public interface:* the verdict enum (`NO_HOLES_FOUND` / `HOLES_FOUND` / `NEEDS_DISCUSSION`) and the `adversarial-review-log` fenced-block contract — unchanged.
- *What stays hidden:* the STRIDE pass mechanics and trust-boundary enumeration — implementation discipline added to the existing reviewer.

**Verification commands:**

```
bash scripts/validate-setup.sh  # if exists
# Doc-edit only.
```

**Acceptance:**

- `### STRIDE sweep` sub-section present, requiring a pass over all six categories with one finding or an explicit "no applicable risk" per category.
- `### Trust-boundary callout` sub-section present, requiring a named enforcement mechanism per crossed boundary.
- Existing six-category threat-model checklist preserved.
- Verdict enum unchanged.
- Phase-1 advisory / non-blocking posture (lines 42-44) unchanged.

**Docs touched (doc-sync checklist):** `.claude/agents/adversarial-reviewer.md` only.

**Builder notes:**

- Do NOT change the auto-trigger surface (lines 11-34) — spec §3.A3 non-goals.
- Repudiation is the load-bearing addition (spec rationale §3.A3) — the contract must explicitly name "no audit-trail" and "no idempotency record" as Repudiation findings, not Tampering. This is the one place where the new discipline differs from naive STRIDE.

## 11. Chunk 6 — Minimal-change rules → CLAUDE.md §6 + `builder.md`

**Branch:** 1 (`fleet-and-process`)
**Effort:** S
**Predecessors:** none

**Files to edit:**

- `CLAUDE.md` § 6 (`## 6. Surgical Changes`) — promote the three rules from spec §3.A4 to numbered enforced rules. The "Line-by-line justification" rule is already present as a sentence; re-phrase in place rather than duplicating:
  1. **Three-Similar-Lines rule** — resist abstraction until the fourth occurrence. Three near-identical lines is acceptable; do not extract a helper until a fourth lands.
  2. **Line-by-line justification** — every changed line traces directly to the user's request. If it does not, revert it. (Promotion of the existing bullet 1.)
  3. **Surface, don't smuggle** — if `builder` notices an out-of-scope improvement (dead code, smell, doc drift) while implementing a chunk, surface it in the chunk verdict's `notes` field and route to `tasks/todo.md`. Do not silently fix.
- `.claude/agents/builder.md` — add a new sub-section after the existing Step 3 "Rules" block (around line 65):
  - `### Minimal-change checks (apply WHILE writing)` — three checks corresponding to the three CLAUDE.md rules. Each check states the symptom and the action. Example for Three-Similar-Lines: *"If you find yourself extracting a helper from 2 or 3 near-identical lines, STOP. Leave the third occurrence inline. The helper waits for the fourth call site."*
- `.claude/agents/builder.md` § Step 5 verdict template (lines 117-125) — clarify the existing `Notes for caller:` field as the surfacing channel for out-of-scope observations. Example wording: `Notes for caller: [out-of-scope observations — dead code, smells, drift; do NOT fix in this chunk; route to tasks/todo.md]`.

**Files to read (no edit):**

- `tasks/todo.md` — confirm the heading format the operator uses for routed-from-builder items (likely `## From builder — <YYYY-MM-DD>` or similar); cite the format in `builder.md` so future builders write to the right section. If no such convention exists yet, builder defines one in the new sub-section: `## From builder — <YYYY-MM-DD>`.

**Module shape:**

- *Public interface:* unchanged — `builder` still returns `Verdict / Files changed / ...`.
- *What stays hidden:* the new mental checks the builder applies while writing.

**Verification commands:**

```
bash scripts/validate-setup.sh  # if exists
# Doc-edit only.
```

**Acceptance:**

- `CLAUDE.md` §6 carries the three minimal-change rules as enumerated bullets.
- `.claude/agents/builder.md` has a `### Minimal-change checks` sub-section in Step 3.
- `builder.md` § Step 5 verdict template clarifies the `Notes for caller:` field typing.

**Docs touched (doc-sync checklist):** `CLAUDE.md`, `.claude/agents/builder.md`.

**Builder notes:**

- The Line-by-line justification rule is already in CLAUDE.md §6 as a sentence. Per spec, promote it to an enforced numbered rule alongside the new two — do not duplicate or leave the old sentence orphaned. Re-phrase in place.
- Do NOT change `builder`'s tool list or model.

## 12. Chunk 7 — New `reality-checker` agent + pipeline wiring

**Branch:** 1 (`fleet-and-process`)
**Effort:** M
**Predecessors:** none (lands before Chunk 9 — see §4)

**Files to create:**

- `.claude/agents/reality-checker.md` — full agent file matching the frontmatter convention of existing agents. Required structure:
  - Frontmatter: `name: reality-checker`, `description:` (one line per spec §3.A2 role), `tools: Read, Glob, Grep` (read-only by design — spec §3.A2 non-goals), `model: opus` (the role demands judgment about what constitutes "evidence"; downgrading to sonnet weakens the gate).
  - § Context loading — same pattern as `pr-reviewer.md` (read CLAUDE.md, architecture.md, DEVELOPMENT_GUIDELINES.md conditionally).
  - § Input — the implementer's stated success criteria + the implementer's claimed evidence (paths to test logs, screenshot paths, log excerpts). Caller must supply this; without it, the agent returns `NEEDS_WORK` immediately (spec §3.A2 caller obligation).
  - § Verification pass — for each claimed criterion, classify the supplied evidence as one of:
    - `passing test output` (path to log file or pasted excerpt)
    - `log excerpt` (matched against the claimed behaviour)
    - `deterministic check` (file exists, function exported, etc.)
    - `manual-verification screenshot path`
    - `unverified — <reason>` (insufficient evidence)
  - § Output envelope — same fenced-block pattern as `pr-reviewer.md` / `adversarial-reviewer.md`. Block tagged `reality-check-log`. Verdict enum: `READY` (all criteria verified) | `NEEDS_WORK` (one or more unverified) | `NEEDS_DISCUSSION` (criteria themselves are ambiguous).
  - § "Files NOT read" disclosure — same disclosure constraint as `pr-reviewer.md` (Chunk 4).
  - § Non-goals — explicit: does NOT run tests itself; does NOT fix anything; does NOT adjudicate subjective UX.
  - § Caller obligation — verbatim wording from spec §3.A2: *"the invoking coordinator must pass the implementer's claimed verification evidence into reality-checker. If no evidence is supplied, reality-checker returns NEEDS_WORK rather than attempting to run commands."*
  - § Test-gate reference — standard one-liner pointing at `references/test-gate-policy.md`.

**Files to edit:**

- `.claude/agents/feature-coordinator.md` — insert `reality-checker` into the branch-level review pass. Located between §8.3 `pr-reviewer` and §8.5 `dual-reviewer` as new §8.4. Insert sequencing:
  - After pr-reviewer returns `APPROVED` (line 269 region): change `→ proceed to dual-reviewer (§8.5)` to `→ proceed to reality-checker (§8.4)`.
  - New §8.4: invoke `reality-checker` with the implementer's stated success criteria + claimed evidence; persist log to `tasks/review-logs/reality-check-log-{slug}-{timestamp}.md`; verdict semantics: `READY` → proceed to dual-reviewer §8.5; `NEEDS_WORK` → fix-loop back to builder (max 2 rounds); `NEEDS_DISCUSSION` → escalate.
  - Update the TodoWrite expansion line (line 101) — sub-items are now `spec-conformance, adversarial-reviewer, pr-reviewer, reality-checker, fix-loop, dual-reviewer`.
  - Update the handoff template (line 357 region) to include a `**reality-checker verdict:**` line between `**pr-reviewer verdict:**` and `**dual-reviewer verdict:**`.
  - Per spec §3.A2: `reality-checker` runs only on Significant / Major tasks. Add a one-line gate in §8.4: *"Skip with `reality-checker: skipped — task class is Trivial/Standard`. Do not invoke reality-checker for those classes."*
- `CLAUDE.md` — append the `reality-checker` row to the Local Dev Agent Fleet table (after `adversarial-reviewer`). Add a one-line entry to the "Common invocations" code block: `"reality-checker: verify the changes I just made"`. Add the pipeline position to the Review pipeline section: `reality-checker` runs after `pr-reviewer` on Significant/Major; non-applicable on Trivial/Standard.
- `tasks/review-logs/README.md` — add a `reality-check-log-*` filename pattern and verdict-header documentation alongside the existing entries. Document the verdict enum (`READY` / `NEEDS_WORK` / `NEEDS_DISCUSSION`) and the Mission Control regex it must match.
- `.claude/CHANGELOG.md` — append an "Added" entry: `reality-checker agent — post-pr-reviewer evidence-demanding verifier`. Match the existing entry style.

**Files to read (no edit):**

- `setup/portable/.claude/CHANGELOG.md` — confirm the canonical version-marker convention; ensure the new agent does not bump `FRAMEWORK_VERSION` unless the convention requires it. Per CLAUDE.md "Framework version" section, adding an agent is a CHANGELOG entry, not necessarily a version bump.
- `.claude/agents/feature-coordinator.md` lines 95-110 (TodoWrite expansion section) — confirm the exact phrasing of the sub-item line for the edit.
- `.claude/agents/feature-coordinator.md` lines 240-300 (the §8.x branch-level review pass) — confirm the section numbering before inserting §8.4. If §8.4 already exists with a different role, renumber rather than collide.

**Module shape:**

- *Public interface:* a new agent with the `Read, Glob, Grep` tool surface; verdict enum `READY` / `NEEDS_WORK` / `NEEDS_DISCUSSION`; fenced-block log shape persisted by the caller.
- *What stays hidden:* the per-criterion evidence-classification logic; the disclosure rules for unverified criteria.

**Verification commands:**

```
bash scripts/validate-setup.sh
# Must pass.
```

**Acceptance (spec §8 Chunk 7):**

- `.claude/agents/reality-checker.md` exists and passes existing frontmatter/schema validation (`validate-setup` green).
- `CLAUDE.md` fleet table references `.claude/agents/reality-checker.md` by exact filename.
- `.claude/CHANGELOG.md` records the addition.
- `feature-coordinator.md` pipeline includes `reality-checker` as §8.4 between `pr-reviewer` and `dual-reviewer`.
- `tasks/review-logs/README.md` documents the `reality-check-log-*` filename and verdict format.

**Docs touched (doc-sync checklist):** `.claude/agents/reality-checker.md` (new), `.claude/agents/feature-coordinator.md`, `CLAUDE.md`, `tasks/review-logs/README.md`, `.claude/CHANGELOG.md`.

**Builder notes:**

- The role demands judgment about evidence quality; `model: opus` is correct. Resist dropping to sonnet for cost — spec §3.A2 explicitly says the agent is the verifier of last resort against frontier-model overconfidence; the verifier itself can't be a weaker model than the implementer.
- Do NOT have `reality-checker` dispatch other agents. Per CLAUDE.md sub-agents cannot dispatch further sub-agents.
- The caller-obligation clause is load-bearing — without it, future coordinators will let the verifier run the tests, defeating the entire point. Quote the spec wording verbatim.

## 13. Chunk 8 — New `incident-commander` agent + `docs/incident-response.md`

**Branch:** 1 (`fleet-and-process`)
**Effort:** M
**Predecessors:** none

**Files to create:**

- `.claude/agents/incident-commander.md` — coordinator-style agent file (inline playbook, like the three existing coordinators). Required structure:
  - Frontmatter: `name: incident-commander`, `description:` (one line per spec §3.A5 role), `tools: Read, Glob, Grep, Bash, Edit, Write, TodoWrite` (coordinator-shaped tool surface — same as `hotfix.md`), `model: opus` (incident triage requires judgment under pressure).
  - § When to invoke — explicit delineation from `hotfix.md`: `incident-commander` *coordinates* a fire (SEV classification, scribe, timeline, post-mortem); `hotfix` *fixes* the fire. Wording: *"If you need to ship the fix, use `hotfix`. If you need to coordinate the response, write the timeline, and drive the post-mortem, use `incident-commander`. For most incidents, both are involved — the main session adopts `hotfix` for the fix work under `incident-commander`'s direction."*
  - § Step 1 — TodoWrite skeleton with the four spec-§3.A5 steps (classify SEV, assign scribe, instruct main session to adopt hotfix, drive post-mortem).
  - § Step 2 — SEV classification (matrix in `docs/incident-response.md`). Confirm with operator before proceeding.
  - § Step 3 — Scribe role: agent itself is scribe if no other coordinator present. Appends timestamped log entries to `tasks/incidents/<YYYY-MM-DD-slug>/timeline.md`.
  - § Step 4 — Hotfix handoff: per spec §3.A5, incident-commander does NOT dispatch another coordinator (per CLAUDE.md, coordinators cannot dispatch coordinators). The main session adopts `hotfix.md` inline. Wording: *"Print to the operator: 'Switching the main session to the hotfix playbook. Read .claude/agents/hotfix.md and follow its Step 1 onward; I'll continue the timeline alongside.'"*
  - § Step 5 — Post-mortem drive: 48-hour template written into `tasks/incidents/<YYYY-MM-DD-slug>/postmortem.md`. Template fields from spec §3.A5: summary, impact, timeline (cross-reference `timeline.md`), root cause (5-whys), contributing factors, what went well, what didn't, action items (owners + due dates routing to `tasks/todo.md`).
  - § Non-goals — does not run tests, does not write the fix itself, does not communicate externally (operator does; agent drafts the message).
  - § Test-gate reference — standard one-liner pointing at `references/test-gate-policy.md`.
  - § Hard rules — never auto-commits; never amends a commit; never `--no-verify`.

- `docs/incident-response.md` — SEV matrix + on-call expectations + post-mortem template. Structure:
  - § SEV matrix — four levels (SEV-1 critical / SEV-2 high / SEV-3 medium / SEV-4 low) with examples and expected response time.
  - § On-call expectations — pre-launch the operator is the on-call; document the expectation that any SEV-1 interrupts the operator regardless of session state. Once a real on-call rotation exists, this section is updated.
  - § Timeline-log format — `tasks/incidents/<YYYY-MM-DD-slug>/timeline.md` skeleton: ISO 8601 UTC timestamp per entry, actor, observation, action taken.
  - § Post-mortem template — the spec §3.A5 fields, in the order the agent will fill them.
  - § Cross-reference — point at `.claude/agents/incident-commander.md` and `.claude/agents/hotfix.md` for the playbooks.

**Files to edit:**

- `CLAUDE.md` — append the `incident-commander` row to the Local Dev Agent Fleet table (one row, alongside `hotfix`). Add a one-line entry to "Common invocations": `"incident-commander: prod is on fire"` (or similar). Cross-reference `docs/incident-response.md` from the agent-fleet section.
- `.claude/CHANGELOG.md` — append an "Added" entry: `incident-commander agent + docs/incident-response.md — production incident coordinator (distinct from hotfix)`.

**Files to read (no edit):**

- `.claude/agents/hotfix.md` (entire file) — confirm the boundary between hotfix and incident-commander is sharp; no duplication of the post-mortem template or KNOWLEDGE.md gotcha-entry steps. `hotfix.md` already drives a KNOWLEDGE.md gotcha entry (its Step 9); `incident-commander.md` writes the post-mortem under `tasks/incidents/*` instead. Document this split in the new agent file's § When to invoke section.

**Module shape:**

- *Public interface:* the coordinator runs inline in the main session; produces a SEV-classified incident folder under `tasks/incidents/<YYYY-MM-DD-slug>/`.
- *What stays hidden:* the SEV classification logic; the per-step timeline-entry templating; the post-mortem fill-in heuristics.

**Verification commands:**

```
bash scripts/validate-setup.sh
# Must pass.
```

**Acceptance (spec §8 Chunk 8):**

- `.claude/agents/incident-commander.md` exists and passes existing frontmatter/schema validation (`validate-setup` green).
- `docs/incident-response.md` exists with the four required sections (SEV matrix / on-call / timeline format / post-mortem template).
- `CLAUDE.md` fleet table references `.claude/agents/incident-commander.md` by exact filename.
- `.claude/CHANGELOG.md` records the addition.
- The When-to-invoke section makes the hotfix/incident-commander split unambiguous (no overlap of post-mortem writing or KNOWLEDGE.md gotcha entries).

**Docs touched (doc-sync checklist):** `.claude/agents/incident-commander.md` (new), `docs/incident-response.md` (new), `CLAUDE.md`, `.claude/CHANGELOG.md`.

**Builder notes:**

- DECISION RESOLVED: the agent runs **inline** in the main session like the three other coordinators (spec §3.A5 explicit). Reason: the no-dispatched-coordinators rule (CLAUDE.md `Common invocations` block). The fleet-table entry must echo this — copy the wording from the existing coordinator rows.
- DECISION RESOLVED: post-mortem template lives in `docs/incident-response.md`, NOT in `.claude/agents/incident-commander.md`. The agent file references it. This keeps the agent file focused on the playbook; future template changes don't churn the agent file.

## 14. Chunk 9 — Reviewer-coverage policy (GRADED) + REVIEW_GAP enforcement

**Branch:** 1 (`fleet-and-process`)
**Effort:** M
**Predecessors:** Chunk 7 (`reality-checker` agent file must exist before the coordinator references it)

**Files to edit:**

- `CLAUDE.md` § Review pipeline (the existing "Review pipeline (mandatory order)" section) — replace with a GRADED-posture-aware version (spec §11 decision 2):
  - Define three task-class tiers and which reviewers are mandatory at each:
    - **Trivial**: none (implement directly).
    - **Standard**: `pr-reviewer` mandatory; `spec-conformance` mandatory if spec-driven.
    - **Significant / Major**: `pr-reviewer` mandatory; `spec-conformance` mandatory if spec-driven; `reality-checker` mandatory; `adversarial-reviewer` mandatory if diff matches security surface (§5.1.2 from `docs/dev-pipeline-coordinators-spec.md`); `dual-reviewer` and `chatgpt-pr-review` mandatory but skippable with a documented `REVIEW_GAP` entry.
  - Cite GRADED as the chosen posture and link to the spec §6.D1 decision-table entry.
  - Document the `REVIEW_GAP` artifact format (lift from spec §6.D1 T5):
    ```
    REVIEW_GAP: <reviewer-name> | task-class: <Trivial|Standard|Significant|Major> | reason: <one-line> | operator-override: <yes-with-timestamp|no> | remediation: <TODO-link|accept>
    ```
  - Document the trigger taxonomy explicitly. NOT every reviewer skip is a `REVIEW_GAP`:
    - **Policy-not-applicable → NO `REVIEW_GAP`.** The reviewer was correctly not invoked because the policy itself does not require it for this task class or diff shape. Examples: `reality-checker` skipped for Trivial/Standard (policy choice, not unavailability); `adversarial-reviewer` skipped because the diff does not cross the §5.1.2 security-sensitive surface; `spec-conformance` skipped because the task is not spec-driven. Coordinator writes a one-line `<reviewer>: skipped — <policy reason>` note in `progress.md`, but no `REVIEW_GAP` line.
    - **Required-but-unavailable → `REVIEW_GAP` REQUIRED.** Policy says invoke; the reviewer could not run. Examples: `dual-reviewer` skipped because Codex CLI is not installed locally; `chatgpt-pr-review` skipped because the operator declined to run the manual round.
    - **Manually skipped / operator override → `REVIEW_GAP` REQUIRED.** Policy says invoke; operator explicitly skipped. The `operator-override` field is `yes-with-timestamp`.
    - **Ambiguous applicability → `REVIEW_GAP` with `task-class: NEEDS_DISCUSSION`.** Coordinator could not confidently classify; surface to finalisation.
  - State the silent-skip-is-a-violation rule verbatim from spec §6.D1: *"A silent skip with no `REVIEW_GAP` entry is itself a policy violation."* Clarify scope: this rule applies to the second, third, and fourth trigger types above. Policy-not-applicable skips are NOT silent — they carry a one-line policy-reason note — and are NOT violations.
- `.claude/agents/feature-coordinator.md` — enforce the GRADED posture in the branch-level review pass (§8.x). **Important**: Chunk 7 already edited this file before Chunk 9 runs (Chunk 7 inserted §8.4 `reality-checker` and shifted subsequent section numbers; updated the TodoWrite expansion line and handoff template). Read the post-Chunk-7 version of `feature-coordinator.md` before editing — do NOT rely on the line-range hints below as exact line numbers. Use them as locator references; the actual line numbers will have shifted. Apply the trigger taxonomy from `CLAUDE.md § Review pipeline`:
  - **Policy-not-applicable skips** (`reality-checker` on Trivial/Standard; `adversarial-reviewer` when the diff misses the §5.1.2 surface; `spec-conformance` on non-spec-driven tasks): write a one-line `<reviewer>: skipped — <policy reason>` note in `progress.md`. NO `REVIEW_GAP` entry. Example wording for the existing `adversarial-reviewer` no-trigger-match case at line 261-262: `adversarial-reviewer: skipped — diff does not match §5.1.2 security surface (per GRADED policy)`.
  - **Required-but-unavailable skips** (the existing `dual-reviewer` Codex-unavailable case at line 287-294, and any analogous cases for `chatgpt-pr-review`): write a FULL-format `REVIEW_GAP` entry to `progress.md`, replacing the current short note.
  - **Operator-override skips**: write a FULL-format `REVIEW_GAP` entry with `operator-override: yes-<ISO-timestamp>`.
  - For `reality-checker` (inserted as §8.4 in Chunk 7) on Trivial/Standard: write `reality-checker: skipped — task class Trivial/Standard (per GRADED policy)`. Policy-not-applicable, NOT a `REVIEW_GAP`.
  - Update the handoff template (line 355-365 region) to surface the `REVIEW_GAP` lines from `progress.md` as a top-level handoff field, so `finalisation-coordinator` sees them without parsing `progress.md`.
- `.claude/agents/finalisation-coordinator.md` — extend the existing REVIEW_GAP check (line 42) to:
  - Recognise the full `REVIEW_GAP: <reviewer-name> | task-class: ... | reason: ... | operator-override: ... | remediation: ...` format, not just `REVIEW_GAP: Codex CLI unavailable`.
  - When any `REVIEW_GAP` is present and `operator-override` is `no`, prepend a warning to the end-of-phase message (matching the existing dual-reviewer-skipped warning pattern at line 615 region).
  - On finalisation, emit / refresh the `REVIEW_GAP` entry in `tasks/current-focus.md` per spec §6.D1 T5. Use the existing `tasks/current-focus.md` paused-build pattern as the precedent for section heading and entry format.

**Files to read (no edit):**

- `docs/dev-pipeline-coordinators-spec.md` §5.1.2 — confirm the security-surface globs cited from `adversarial-reviewer.md` so `CLAUDE.md` can reference the right section.
- Existing `REVIEW_GAP: Codex CLI unavailable` precedent in `feature-coordinator.md` and `finalisation-coordinator.md` — confirm wording style so new GRADED entries match.
- `tasks/current-focus.md` — confirm the paused-build / artefact-record entry format; the new REVIEW_GAP section mirrors it.

**Module shape:**

- *Public interface this chunk exposes:* the `REVIEW_GAP` line format consumed by `tasks/current-focus.md` and the finalisation end-of-phase message.
- *What stays hidden:* per-coordinator skip-path mechanics; the audit query against past SKIPPED entries.

**Verification commands:**

```
bash scripts/validate-setup.sh
# No build/lint/typecheck — no TS touched.
```

**Acceptance:**

- `CLAUDE.md` § Review pipeline documents GRADED posture explicitly with the three-tier mandatory/skippable matrix and the `REVIEW_GAP` line format.
- `feature-coordinator.md` applies the trigger taxonomy: required-but-unavailable and operator-override skips write a full-format `REVIEW_GAP` entry to `progress.md`; policy-not-applicable skips write a one-line policy-reason note (no `REVIEW_GAP`).
- `finalisation-coordinator.md` parses the full-format `REVIEW_GAP` line; surfaces it in the end-of-phase message; emits the entry to `tasks/current-focus.md`.
- `reality-checker` is mandatory on Significant/Major per the new policy section (relies on Chunk 7).

**Docs touched (doc-sync checklist):** `CLAUDE.md`, `.claude/agents/feature-coordinator.md`, `.claude/agents/finalisation-coordinator.md`. No new files.

**Builder notes:**

- The audit of "categorise SKIPPED reasons across the last 10 merges" (spec §6.D1) is an operator-facing investigation, NOT a builder task. Builder does the documentation + enforcement work; scanning recent review logs to inform doc wording is a read-only sanity check, not a blocking step.
- Do NOT add an automated `REVIEW_GAP` detector. Enforcement is at the coordinator-prompt level (coordinators write the entry); CI is not in scope for this chunk.

## 15. Chunk 10 — `docs/testing-transition-plan.md` (T-minus-14 trigger)

**Branch:** 1 (`fleet-and-process`)
**Effort:** M
**Predecessors:** none

**Files to create:**

- `docs/testing-transition-plan.md` — full transition plan per spec §6.D2. Required sections:
  - § Trigger — verbatim from spec §11 decision 4: *"T-minus-14 calendar days before first live agency client onboarding. Self-correcting trigger: lands when it needs to, regardless of slippage."*
  - § Inventory — which suites must exist before flip-day:
    - **Integration tests for RLS-protected flows** — list the RLS-protected tables and the critical flows that need integration coverage. Builder consults `architecture.md` § RLS / tenant isolation and `server/config/rlsProtectedTables.ts` (if it exists) to enumerate.
    - **Workflow engine smoke tests** — at minimum a happy-path run of the workflow engine for each engine type registered. Builder consults `server/services/workflowEngineService.ts` and the engines registered there to enumerate.
    - **The four obese services' critical paths** — `skillExecutor.ts`, `workflowEngineService.ts`, `skillAnalyzerServicePure.ts`, `agentExecutionService.ts`. For each: list the critical methods that need test coverage post-flip. Builder reads each file to enumerate the methods (read-only — no modification).
  - § Sequencing — which gates flip first, which stay gates-only longest:
    - Flip first (lowest risk): integration tests for RLS-protected flows (pure isolation; no behavioural change).
    - Flip second: workflow engine smoke tests (catches broad runtime regressions).
    - Flip last: the four obese services' critical paths (each requires upstream service splits — out of scope here per spec §1).
  - § Effort estimate — rough S/M/L per suite. Best-effort estimation based on file size and complexity.
  - § Out of scope — explicit: this doc does NOT flip the posture. It is a transition plan. The flip happens when the trigger condition is met (T-minus-14 days).
  - § Cross-references — link to `DEVELOPMENT_GUIDELINES.md` §7 (the current gates-only policy), `references/test-gate-policy.md` (the canonical test-gate rules), and the four obese services' source files.

**Files to edit:**

- `DEVELOPMENT_GUIDELINES.md` § 7 — add a one-line cross-reference to `docs/testing-transition-plan.md`. Do NOT change the current gates-only posture statement.

**Files to read (no edit):**

- `DEVELOPMENT_GUIDELINES.md` § 7 — confirm the current posture statement wording.
- `references/test-gate-policy.md` — confirm the CI-only rule wording.
- `server/config/rlsProtectedTables.ts` (if exists) — enumerate the RLS-protected tables.
- `server/services/skillExecutor.ts`, `server/services/workflowEngineService.ts`, `server/services/skillAnalyzerServicePure.ts`, `server/services/agentExecutionService.ts` — enumerate critical methods. Builder does NOT modify these files; read-only enumeration for the inventory section.

**Module shape:**

- *Public interface:* a new doc consumed by future planners.
- *What stays hidden:* the per-suite effort heuristics (S/M/L); the prioritisation reasoning.

**Verification commands:**

```
# Doc-only chunk. No build needed.
# Spot-check: the new file renders cleanly; no broken cross-references; the
# four obese services are all named.
```

**Acceptance:**

- `docs/testing-transition-plan.md` exists with all six required sections (Trigger / Inventory / Sequencing / Effort / Out of scope / Cross-references).
- The trigger statement is verbatim from spec §11 decision 4.
- The inventory enumerates the RLS-protected tables, the workflow engine smoke surface, and the four obese services' critical paths.
- `DEVELOPMENT_GUIDELINES.md` §7 cross-references the new file.
- The doc does NOT flip the gates-only posture.

**Docs touched (doc-sync checklist):** `docs/testing-transition-plan.md` (new), `DEVELOPMENT_GUIDELINES.md`.

**Builder notes:**

- Do NOT propose specific tests in detail — that's deferred until the trigger condition is met. The inventory is a list of *suites that need to exist*, not test cases.
- Do NOT touch the four obese services. They are explicitly out of scope per spec §1.
- The doc is human-facing per CLAUDE.md §13 — full sentences, no jargon. The agent-facing docs (CLAUDE.md, KNOWLEDGE.md, agents) stay dense; this doc is human-facing.

## 16. Chunk 11 — Route violator triage (9 sub-chunks)

**Branch:** 2 (`codebase-health`)
**Effort:** M-L (9 sub-chunks, each S–M)
**Predecessors:** Chunk 1 (strict gate must be in place)

**Decomposition into 9 sub-chunks.** Each sub-chunk = one violator route. Builder lands one sub-chunk per `builder` invocation, in any order. After each sub-chunk, `bash scripts/verify-no-db-in-routes.sh` must report violation count decremented by exactly 1.

**Per-sub-chunk T2 invariant (spec §4.B1 — non-negotiable):**

After every sub-chunk, the migrated route must satisfy ALL FOUR:

1. Route handler performs auth / input parsing / response shaping only.
2. DB access lives behind a service method.
3. The service method accepts organisation / subaccount scope explicitly, or derives it through the existing scoped-context pattern (`getOrgScopedDb` etc.).
4. The route must not `import db`, schema tables, or Drizzle query helpers (`eq`, `and`, `isNull`, etc.).

The strict gate from Chunk 1 enforces #4 mechanically. Items #1-3 are enforced at branch-level `pr-reviewer`.

**Transaction & org-scope convention (invariant across all 9 sub-chunks).** Service migrations follow the dominant pattern of the existing service being extended. Do NOT introduce new transaction signatures or change scope-handling shape on a whim. Specifically:

- The org/subaccount scope is propagated via `AsyncLocalStorage` (`withOrgTx(ctx, async () => {})` is set by middleware; services call `getOrgScopedDb()` or `getOrgTxContext()` to read it). Services migrated from routes accept an explicit `orgId` parameter at the public method boundary AND honour the AsyncLocalStorage context inside — match how the rest of the target service is written. Do not silently drop the explicit-`orgId` parameter; do not invent a new `withOrgTx`-callback wrapper at the service boundary if the existing service does not use one.
- Database transactions remain `db.transaction(async (tx) => { ... })`. Pass the `tx` handle to helper methods only when (a) the dominant pattern in the target service already does so, or (b) the transaction spans methods owned by multiple services (the cross-service case noted in §16 11.7 portal). Otherwise keep the transaction internal to the single service method that owns the primary mutation.
- `getOrgScopedDb()` is permitted inside services — the spec-compliant migration moves it from route-side to service-side; the route loses the import, the service gains it.
- If a sub-chunk would require introducing a new transaction-handle signature or a new scope-handling pattern that does not already exist in the target service, return `PLAN_GAP` and surface it. Do not invent shape; the plan owns shape decisions.

**No import-cycle regression.** For every sub-chunk: after the route → service migration, confirm no route ↔ service import cycle exists (e.g., the new service must not import from `server/routes/`). If `npm run typecheck` or `npm run build:server` surfaces a cycle, return `PLAN_GAP` rather than adding a workaround (a re-export shim, a lazy `require`, etc.).

**Per-sub-chunk verification commands:**

```
# Gate decrement — this single script is the ONLY scripts/verify-*.sh
# permitted to run locally (per §20 Executor notes). Do NOT generalise
# from this and run other gate scripts; everything else is CI-only.
bash scripts/verify-no-db-in-routes.sh
# Expected: violation count is exactly 1 lower than the previous sub-chunk's
# tail count. If unchanged, the migration is incomplete (route still imports db).

# Standard G1
npx eslint <touched files>
npm run typecheck
npm run build:server
```

**Per-sub-chunk acceptance:**

- The named route file no longer imports `db` or any schema/Drizzle helpers.
- All DB access is behind a service method.
- The service method accepts orgId / subaccountId explicitly.
- T2 invariant satisfied (see above).
- Gate violation count decremented by 1.

**Grouping guard (spec §8 Chunk-11 note):** Do NOT batch sub-chunks if any of them requires a new service file, an auth-model clarification, or an exception ADR. Those land isolated. The decomposition below already isolates the new-service sub-chunks (11.5).

---

### 11.1 — `agentPromptRevisions.ts`

**Target service:** new `server/services/agentPromptRevisionService.ts`. Existing `agentService.ts` is the largest service in the repo (already past 2,000 lines per the spec's "obese services" note) — adding 3 methods to it is the wrong direction. A focused new service is the cleaner shape, and the spec is explicit that splitting the obese services is out of scope.

**Files to create:**

- `server/services/agentPromptRevisionService.ts` — `class AgentPromptRevisionService` (or object export — builder confirms by checking the dominant convention in 2-3 nearby services) with methods:
  - `listForAgent(orgId: string, agentId: string, params: { limit: number; offset: number }): Promise<PromptRevision[]>` — verifies agent ownership via `agentService.getFull(agentId, orgId)` first; queries `agentPromptRevisions` with `eq(organisationId, orgId)` + `eq(agentId, agentId)`; orders by `desc(revisionNumber)`; paginates.
  - `getById(orgId: string, agentId: string, revisionId: string): Promise<PromptRevision>` — three-way scope filter (organisationId, agentId, id); throws `{ statusCode: 404 }` if not found.
  - `rollback(orgId: string, agentId: string, revisionId: string, actorId: string | null): Promise<PromptRevision>` — full transaction block from current `routes/agentPromptRevisions.ts` lines 113-146 (compute hash, fetch max revisionNumber, insert new revision, update agent). Audit log call moves into the service too (current route line 149-161). The `computePromptHash` helper (current line 13-15) moves into the new service as a private function.

**Files to edit:**

- `server/routes/agentPromptRevisions.ts` — strip `db`, schema, and Drizzle imports; replace handler bodies with service calls; preserve `authenticate` + `requireOrgPermission` middleware verbatim. Final route file should be ~70 lines (down from 167).

**Files to read (no edit):**

- `server/services/agentService.ts` — confirm `agentService.getFull(agentId, orgId)` signature and throw shape so the new service uses it consistently for the ownership check.
- `server/services/auditService.ts` — confirm `auditService.log({ ... })` signature; current route line 149-161 must port verbatim into the new service.
- `server/db/schema/` — confirm `agentPromptRevisions` column names.

**Acceptance:** T2 invariant holds; rollback transaction semantics preserved (still atomic); audit log entry still emitted with the same `metadata` shape; gate violation count drops by 1.

---

### 11.2 — `mcp.ts`

**Target service:** existing `server/services/subaccountAgentService.ts`. The single DB call in `routes/mcp.ts` (lines 41-50) is a `subaccountAgents` lookup with a 2-column filter — natural fit for an existing service.

**Files to edit:**

- `server/services/subaccountAgentService.ts` — add method `getAllowedSkillSlugs(agentId: string, subaccountId: string): Promise<string[] | null>`. Returns `null` if no link exists or `allowedSkillSlugs` is null. Throws nothing on a "no link" case — null is the well-formed answer (current route line 51-54 tolerates null).
- `server/routes/mcp.ts` — strip `db`, schema, and Drizzle imports; replace lines 41-58 with a single `subaccountAgentService.getAllowedSkillSlugs(agentId, subaccountId)` call. Preserve the existing `try { ... } catch { /* tolerate UUID parse errors */ }` shape — the service should also tolerate invalid UUID input (return null rather than throw); builder picks the cleaner shape per the existing service-style convention.

**Files to read (no edit):**

- `server/services/subaccountAgentService.ts` (full) — confirm existing method-naming style; `getAllowedSkillSlugs` should match.
- `server/services/agentService.ts` — confirm whether ownership / scope assertion is done by the service or the caller; the new method should match.

**Acceptance:** T2 invariant holds; tool-allowlist behaviour preserved (null tolerated, no throw on lookup failure); gate violation count drops by 1.

---

### 11.3 — `projects.ts`

**Target service:** existing `server/services/projectService.ts`. The route already imports `projectService` and delegates GET/PATCH to it. Remaining direct-db usage is in POST (insert), DELETE (existence check + soft-delete), and the live-status endpoint (cross-table `agentRuns` query).

**Files to edit:**

- `server/services/projectService.ts` — add methods:
  - `create(orgId: string, subaccountId: string, data: CreateProjectInput, createdBy: string | null): Promise<Project>` — replicates current route lines 86-101.
  - `softDelete(orgId: string, subaccountId: string, projectId: string): Promise<{ success: true }>` — replicates current route lines 144-153 (existence check + soft-delete). Existence check uses organisationId+subaccountId+id+deletedAt isNull filter; preserve current 404 semantics.
- `server/services/agentRunService.ts` (if exists; else extend `projectService` instead) — add `countInFlightForSubaccount(orgId: string, subaccountId: string): Promise<number>` for the live-status endpoint. Recommendation: live in `agentRunService` since the count *is* an agent-run query, not a project query. Builder confirms `agentRunService.ts` exists; if it doesn't, the cohesive home becomes `projectService.getInFlightRunCount(orgId, subaccountId)` instead — flag this in the chunk verdict.
- `server/routes/projects.ts` — strip `db`, `projects`, `agentRuns`, schema and Drizzle imports; replace POST + DELETE + live-status handler bodies with service calls.

**Files to read (no edit):**

- `server/routes/projects.ts` lines 156-end — confirm what the `live-status` endpoint actually does. Read the existing route comment (lines 159-165) referencing IEE-delegated runs — the migration must preserve which run statuses are counted (`IN_FLIGHT_RUN_STATUSES` from `shared/runStatus.ts`).
- `server/services/agentRunService.ts` (if present) — confirm naming style for the new method.

**Acceptance:** T2 invariant holds for every handler; live-status preserves the IEE-delegated-runs semantics noted in the existing route comment; gate violation count drops by 1.

---

### 11.4 — `agentTriggers.ts`

**Target service:** existing `server/services/triggerService.ts` already covers list/create/etc. Remaining direct-db usage is a `subaccountAgents` ownership check (line 53-60).

**Files to edit:**

- `server/services/subaccountAgentService.ts` — add method `assertBelongsToSubaccount(subaccountAgentId: string, subaccountId: string): Promise<void>`. Throws `{ statusCode: 404, message: 'subaccountAgent not found' }` if the link doesn't exist.
- `server/routes/agentTriggers.ts` — strip `db`, `subaccountAgents`, Drizzle imports; replace the ownership check (and any other inline DB calls — builder reads the full file to confirm) with `subaccountAgentService.assertBelongsToSubaccount(subaccountAgentId, subaccountId)`.

**Files to read (no edit):**

- `server/routes/agentTriggers.ts` (full) — confirm the ownership check is the only DB-using block. If there are more (UPDATE / DELETE handlers further down with inline DB), each gets a corresponding service method added to `triggerService`. Builder MUST read the entire route file before deciding the migration shape.

**Acceptance:** T2 invariant holds; gate violation count drops by 1.

---

### 11.5 — `permissionSets.ts`

**Target service:** **NEW `server/services/permissionSetService.ts`.** No existing service covers permission-sets CRUD. `permissionSeedService.ts` is for seeding the catalogue, not CRUD on sets. This sub-chunk lands ISOLATED per the grouping guard (new service file).

**Mandatory preflight — route-method inventory (return `PLAN_GAP` if any row is unclear).** Before editing any source file, builder must return or write a route-method inventory table — placed in the chunk's progress artifact or verdict notes per the build workflow in effect. The exact location follows whatever the surrounding executor pattern uses for per-chunk artefacts (`progress.md`, the builder's return verdict, etc.); the requirement is the gate itself, not the file path. One row per handler. Required columns:

| HTTP method + path | Current DB tables touched | Current Drizzle helpers used | Target service method signature | Auth / scope inputs (orgId / subaccountId / actorId / requireSystemAdmin) | `configHistoryService.record` side effects (action + entity-id) | Response shape |

The table must cover every handler in `server/routes/permissionSets.ts`. If any row has unclear ownership (e.g., a handler joins across subaccount-user-assignments AND org-user-roles AND permissions in a way the spec did not anticipate), unclear scope (an endpoint that reads org-level state without an explicit orgId), or unclear `configHistory` semantics (a mutation that may or may not log to history), builder returns `PLAN_GAP` with the ambiguous rows highlighted. The architect resolves the row before the builder writes code.

Rationale: permission-sets is the highest-risk route in Chunk 11 outside portal — it crosses auth, assignments, config history, and likely org-level access semantics. A mechanical inventory gate eliminates the "builder judgment" surface that Sonnet most often gets wrong on routes of this shape.

**Files to create:**

- `server/services/permissionSetService.ts` — methods (builder reads the full route to enumerate exhaustively, but expect):
  - `listPermissionsCatalogue(): Promise<Permission[]>` — `db.select().from(permissions)`. No org scoping (catalogue is global).
  - `listForOrg(orgId: string): Promise<PermissionSet[]>` — list permission sets for an org.
  - `getById(orgId: string, id: string): Promise<PermissionSet>`.
  - `create(orgId: string, data: CreatePermissionSetInput, actorId: string | null): Promise<PermissionSet>` — transaction: insert permission_sets + permission_set_items rows.
  - `update(orgId: string, id: string, data: UpdatePermissionSetInput, actorId: string | null): Promise<PermissionSet>`.
  - `delete(orgId: string, id: string, actorId: string | null): Promise<void>` — soft-delete if column exists; else hard-delete.
  - Methods for the subaccount-assignment-related queries against `subaccountUserAssignments` / `orgUserRoles` / `users` — builder enumerates exhaustively after reading the route end-to-end.
  - Each public mutation method passes through `configHistoryService.record(...)` calls preserved from the current route.

**Files to edit:**

- `server/routes/permissionSets.ts` — full handler-body rewrite. Strip `db` and all schema imports (`permissionSets`, `permissionSetItems`, `orgUserRoles`, `permissions`, `users`, `subaccountUserAssignments`); strip Drizzle helpers. Each handler becomes a single service call + response shaping.

**Files to read (no edit):**

- `server/routes/permissionSets.ts` (full) — this is the most complex of the 9 migrations. Builder reads the entire file before writing the new service; enumerate methods exhaustively, then implement.
- 2-3 nearby services (e.g. `engineService.ts`) — confirm the dominant export convention (class vs object).
- `server/services/configHistoryService.ts` — confirm `configHistoryService.record(...)` signature so the new service's calls are well-typed.

**Acceptance:** T2 invariant holds for the entire route file; all `configHistoryService.record` calls preserved with the same action / entity-id arguments; gate violation count drops by 1; the new service file passes lint+typecheck+build:server.

**Builder notes for 11.5:**

- Largest of the 9 sub-chunks. Plan-gap pre-check is critical: read the full route file first; if any handler does something the spec or this plan didn't anticipate (e.g. cross-table joins, conditional permission logic), STOP and route back to architect for guidance on the method signatures.
- Do NOT split into smaller sub-chunks. Spec §8 says one sub-chunk per violator; the new-service guard already isolates 11.5 from grouping.

---

### 11.6 — `integrationConnections.ts`

**Target service:** existing `server/services/connectionsService.ts` (already imported by the route for `listConnections` / `getConnectionUsage` / `disconnectConnection`) OR `server/services/integrationConnectionService.ts` (also exists). Recommendation: extend `connectionsService.ts` since the route already imports its functions — adding the remaining methods there matches existing locality.

**Files to edit:**

- `server/services/connectionsService.ts` — add whatever methods the remaining inline DB calls need. Builder reads `server/routes/integrationConnections.ts` end-to-end to enumerate; expect methods around create/update/get-by-id. The route's `sanitizeConnection` helper at lines 24-32 is a pure transformation — keep it route-side unless used across multiple handlers; if used in multiple, hoist to a shared helper or absorb into the service's return shape.
- `server/routes/integrationConnections.ts` — strip `db`, `integrationConnections` schema, and Drizzle imports; replace handler bodies with service calls.

**Files to read (no edit):**

- `server/routes/integrationConnections.ts` (full).
- `server/services/connectionsService.ts` vs `server/services/integrationConnectionService.ts` — decide which is the right home. Builder may consolidate if appropriate, but consolidation is a separate decision — for THIS sub-chunk, extend the right existing service only.

**Acceptance:** T2 invariant; gate -1.

---

### 11.7 — `portal.ts`

**Target service:** **multiple existing services + a new helper if needed.** `portal.ts` is the second-most complex migration. DB access fans out across many tables (`subaccounts`, `subaccountAutomationLinks`, `subaccountCategories`, `subaccountUserAssignments`, `permissionSetItems`, `automations`, `executions`, `executionPayloads`, `automationEngines`, `workflowRuns`, `workflowTemplateVersions`, `systemWorkflowTemplateVersions`, `scheduledTasks`). Most have existing services; some do not.

**Decision required before sub-chunk start:** Builder MUST read `server/routes/portal.ts` end-to-end first, then group each query into one of:

1. **Already has a service** — call the existing service. Targets in priority order:
   - `subaccountService` (for `subaccounts` lookups) — confirm exists.
   - `taskService` (already imported) — for `scheduledTasks`-related queries.
   - `WorkflowRunService` (already imported) — for `workflowRuns` lookups.
   - `automationService` — for `automations` / `executions` / `executionPayloads` lookups.
   - `engineService` — for `automationEngines` lookups.
   - `agentActivityService` (already imported).
2. **No existing service for that table** — add a method to the closest cohesive service rather than create a new one.

**Files to edit:**

- `server/routes/portal.ts` — full handler-body rewrite. Strip `db`, `getOrgScopedDb`, all schema imports, all Drizzle helpers. Each handler becomes service calls + response shaping. The `db.transaction(async (tx) => { ... })` block at line 280 needs particular care — the transaction logic moves into whichever service owns the entity being transactionally updated. If the transaction spans entities owned by multiple services, the cleanest shape is to add a coordinating method to the service that owns the *primary* mutation (the one that defines transaction success) and have it call helper methods on the others — those helpers must accept a transaction handle. Builder picks based on what `db.transaction` is actually doing at line 280.

**Files to read (no edit):**

- `server/routes/portal.ts` (full — confirm line count first; large file).
- Each candidate target service to confirm method-naming style.
- `server/lib/orgScopedDb.ts` — confirm `getOrgScopedDb` is allowed in services (per `builder.md` CI-gate pre-flight item 3: `getOrgScopedDb` is allowed anywhere); the spec-compliant migration replaces route-side `getOrgScopedDb` with service-side `getOrgScopedDb`, not with raw `db` (the route loses the import; the service gains it).

**Decomposition consideration (inverted default).** Spec §8 says "one sub-chunk per violator." Portal remains one logical violator for gate-accounting purposes — the route file is the unit that decrements the violation count, and the route stays violating until the final endpoint group is migrated. BUT implementation MAY be split into internal steps by endpoint group within this sub-chunk:

- Each internal step migrates one cohesive endpoint group (e.g., automation-related endpoints; workflow-related endpoints; scheduled-task-related endpoints). The route file remains temporarily violating until the final group lands.
- Internal steps are individually reviewable for `pr-reviewer` purposes — a smaller diff per step is easier to review well.
- The acceptance condition is still **one gate decrement when portal is complete** (the file no longer imports `db`, schema tables, or Drizzle helpers). Internal steps do NOT each decrement the gate.
- The operator commits each internal step separately. The route file CAN remain in a violating state across multiple commits within this sub-chunk; this is the only sub-chunk in Chunk 11 where that is permitted.
- If builder finds the decomposition is not naturally cohesive (e.g., a single transaction at line 280 spans what looked like two groups), collapse those groups into one step. Do not split mid-transaction.
- **Executor-pattern carve-out:** 11.7 portal MAY use multiple `builder` invocations under the single logical sub-chunk. This is the one explicit exception to the §20 "one builder invocation per chunk" rule. Each invocation's return verdict must state whether the portal gate decrement is still pending or now complete (e.g., `portal: 3 of N endpoint groups migrated; gate decrement still pending` vs `portal: final group migrated; gate decrement complete — violator count now M-1`).

This inverts the default from the spec's one-file-one-sub-chunk rule because portal's complexity makes single-shot review unrealistic. The gate accounting is preserved (one decrement when complete), but the review surface per commit is sized to what `pr-reviewer` can actually evaluate.

**Acceptance:** T2 invariant; gate -1; the `db.transaction` at line 280 still atomic (transaction semantics preserved).

---

### 11.8 — `systemEngines.ts`

**Target service:** existing `server/services/engineService.ts`. The route is full CRUD on `automationEngines` filtered to `scope: 'system'`. `engineService.ts` already exists with org-scoped engine methods; this sub-chunk adds `system*`-prefixed methods.

**Files to edit:**

- `server/services/engineService.ts` — add methods:
  - `listSystemEngines(): Promise<Engine[]>` — `where(scope === 'system')` + `isNull(deletedAt)` + `orderBy(desc(createdAt))` + sanitise (no hmacSecret/apiKey).
  - `createSystemEngine(data: CreateSystemEngineInput): Promise<Engine>` — auto-generates hmacSecret via `crypto.randomBytes(32).toString('hex')`; inserts with `scope: 'system'`.
  - `getSystemEngineById(id: string): Promise<Engine>` — throws 404.
  - `updateSystemEngine(id: string, data: UpdateSystemEngineInput): Promise<Engine>`.
  - `deleteSystemEngine(id: string): Promise<void>` — soft-delete (set deletedAt).
  - The `sanitizeEngine` helper at `routes/systemEngines.ts` lines 16-19 moves into `engineService` as a private helper.
- `server/routes/systemEngines.ts` — strip `db`, `automationEngines`, Drizzle imports; replace all handler bodies with service calls. Preserve `requireSystemAdmin` middleware verbatim.

**Files to read (no edit):**

- `server/services/engineService.ts` (full) — confirm method-naming style; the new `system*` methods should be cohesive with the existing org-scoped ones.
- `server/routes/systemEngines.ts` (full).

**Acceptance:** T2 invariant; gate -1.

**Note on T2 item #3 ("explicit scope handling"):** System engines are global — no organisationId. The system-engine methods accept no orgId and filter by `scope: 'system'` instead. Document this in the new service methods' JSDoc so the gate-pass reasoning is auditable.

---

### 11.9 — `webhookAdapter.ts`

**Target service:** existing `server/services/webhookAdapterService.ts` (already imported by the route) + `server/services/agentService.ts` for the ownership check.

**Files to edit:**

- `server/services/agentService.ts` — confirm `agentService.getFull(agentId, orgId)` exists with the ownership-assertion semantics needed (confirmed during plan investigation). If a lighter-weight `agentService.assertOwnership(agentId, orgId)` would be cleaner for routes that only need the guard, builder may add it; otherwise reuse `getFull`. Recommendation: reuse `getFull` since the route doesn't need the agent body further — the 404 throw is the only required semantic.
- `server/routes/webhookAdapter.ts` — strip `db`, `agents` schema, Drizzle imports. Replace each of the three ownership-guard blocks (lines 26-32, 58-64, 122-128 or wherever the third lives — builder reads the full file) with `await agentService.getFull(agentId, req.orgId!)`. The remaining logic in each handler already calls `webhookAdapterService`; no further migration needed.

**Files to read (no edit):**

- `server/routes/webhookAdapter.ts` (full) — confirm exactly three ownership guards; if more inline DB usage exists beyond those three blocks, list each in the sub-chunk plan.
- `server/services/agentService.ts` — confirm `getFull` signature and throw shape.

**Acceptance:** T2 invariant; gate -1; the three identical ownership-guard blocks all migrate to the same `agentService.getFull` call.

## 17. Chunk 12 — `KNOWLEDGE.md` sweep

**Branch:** 2 (`codebase-health`)
**Effort:** M
**Predecessors:** Chunks 1-11 (so any KNOWLEDGE entries surfaced by the build land in the inventory, not the live file)

**Two-step workflow (mandatory per spec §5.C2 inventory-first).**

### 12.A — Inventory (gating sub-step)

**Files to create:**

- `docs/knowledge-sweep-inventory.md` — written by the builder and operator-committed BEFORE any mutation of `KNOWLEDGE.md`. Required structure:
  - § Grouped entries — KNOWLEDGE.md entries grouped by domain (RLS / agent runs / queues / heartbeats / migrations / testing / etc.). Builder reads `KNOWLEDGE.md` end-to-end and assigns each entry a domain tag.
  - § Proposed ADR promotions — entries cited ≥3 times in specs/review-logs/other-knowledge-entries. Per spec §5.C2 T1 ADR-creation cap: **maximum 5 new ADRs proposed**. If more candidates qualify, group lower-priority ones under a `## Defer ADR (under cap)` heading. Each ADR proposal includes a target ADR id (`<NNNN>-<slug>`) and a one-line rationale.
  - § Duplicate / compression candidates — pairs or groups of equivalent entries with a one-line rationale per pair. Per spec §5.C2 non-deletion rule: removed content must either (a) be in a proposed ADR, (b) survive as a canonical compressed entry, or (c) remain recoverable through the inventory itself.
  - § Retained unchanged — entries that stay untouched (the bulk of the file).

**Gating sub-step:** builder writes `docs/knowledge-sweep-inventory.md` to disk and STOPS. Returns a verdict tagged `INVENTORY_READY` instead of `SUCCESS`. Builder does NOT auto-commit (per §20 Executor notes — main session never auto-commits). The OPERATOR reviews the inventory, then commits it, then dispatches 12.B as a separate `builder` invocation. The phrase "committed before mutation" used elsewhere in this plan means "operator-committed before the apply step is dispatched" — not "builder commits inline."

**Operator approval checkpoint:** explicit. The operator must say "approved, apply" (or equivalent) before 12.B starts. No silent progression. The inventory commit precedes the approval message.

### 12.B — Apply

**Files to edit:**

- `KNOWLEDGE.md` — apply the approved inventory:
  - Promote ≤5 patterns to new ADRs under `docs/decisions/<NNNN>-<slug>.md`.
  - Replace each promoted-pattern's KNOWLEDGE entry with a one-line pointer: `Promoted to <ADR id> on 2026-05.`
  - Compress duplicate groups: keep the oldest entry; replace newer equivalents with one-line back-references.
  - Add a dated header at the top of `KNOWLEDGE.md`: `## 2026-05 quarterly trim — see docs/knowledge-sweep-inventory.md for the full inventory and docs/decisions/ for promoted patterns.`
- `docs/decisions/<NNNN>-<slug>.md` — one new ADR per promotion (≤5). Use `docs/decisions/_template.md` as the starting structure. Each ADR carries the date, the originating KNOWLEDGE entry as context, the decision, the rationale, and the trade-offs considered.

**Files to read (no edit):**

- `KNOWLEDGE.md` end-to-end (3,785 lines — large but bounded; do not skim).
- `docs/decisions/` (existing ADRs) — confirm the numbering convention and pick the next sequential numbers.
- `docs/decisions/_template.md` — use as the structural template.

**Verification commands (12.B):**

```
# After applying:
wc -l KNOWLEDGE.md
# Target: ≤2,500 lines per spec §5.C2.

# Confirm new ADR file naming matches convention
ls docs/decisions/ | tail -10
```

**Acceptance:**

- `docs/knowledge-sweep-inventory.md` exists with all four required sections.
- Operator approval recorded (typically a chat acknowledgement; operator commits or asks the builder to commit the apply step).
- `KNOWLEDGE.md` is ≤2,500 lines post-sweep.
- ≤5 new ADRs exist under `docs/decisions/`.
- No KNOWLEDGE entry deleted outright (all are either retained, compressed with back-reference, or promoted with one-line pointer).
- The dated header `## 2026-05 quarterly trim` is present at the top of `KNOWLEDGE.md`.

**Docs touched (doc-sync checklist):** `KNOWLEDGE.md`, `docs/knowledge-sweep-inventory.md` (new), 0–5 ADRs under `docs/decisions/`.

**Builder notes:**

- The ≤5 ADR cap is hard. Do not negotiate it down at apply time. If the inventory has 8 ADR-worthy candidates, the bottom 3 go into the `## Defer ADR (under cap)` section of the inventory and stay as KNOWLEDGE entries this quarter.
- The non-deletion rule means even "trivial" entries can't be removed. Compression is allowed; deletion is not.
- 12.A and 12.B are SEPARATE builder invocations. The operator's "approved, apply" is the dispatcher's signal to call `builder` again for 12.B.

## 18. Chunk 13 — `tasks/todo.md` triage sprint

**Branch:** 2 (`codebase-health`)
**Effort:** L
**Predecessors:** Chunks 1-12 (especially Chunk 9 — REVIEW_GAP entries reclassified per the new GRADED policy)

**Two-step workflow (mandatory per spec §5.C1 inventory-first).**

### 13.A — Inventory (gating sub-step)

**Files to create:**

- `tasks/todo-triage-inventory.md` — written by the builder and operator-committed BEFORE any mutation of `tasks/todo.md`. Required structure: one row per deferred item (281 rows expected per the spec; builder reads `tasks/todo.md` end-to-end to enumerate). Columns:
  - item id / heading
  - domain (routes / services / schema / agents / tests / docs / migrations / etc.)
  - proposed end-state: SHIP | ARCHIVE | ACCEPT
  - one-line rationale
  - destination file (target spec / archive section / ADR id)

**Gating sub-step:** builder writes `tasks/todo-triage-inventory.md` to disk and STOPS. Verdict tag `INVENTORY_READY`. Builder does NOT auto-commit. The OPERATOR reviews, commits the inventory, then dispatches 13.B as a separate `builder` invocation.

**Operator approval checkpoint:** explicit, same as Chunk 12. "Committed before mutation" = operator-committed before the apply step is dispatched.

### 13.B — Apply

**Files to create:**

- `tasks/todo-archive/2026-Q2.md` — archive bucket for ARCHIVE-classified items. Each entry preserves the original wording + a one-line archive rationale + the date.
- (Optional) New spec stubs under `tasks/builds/<slug>/spec.md` for SHIP-classified items that warrant their own spec. Builder does NOT write the spec content — just creates the slug directory with a one-paragraph stub naming the SHIP item. The actual spec authoring is its own task (the spec §5.C1 "Not in scope here" line). Terminology: this plan uses **SHIP** (not "SHIPPED") consistently as the end-state classification — the verbal tense matches the proposed-future framing of ARCHIVE and ACCEPT.
- (Optional) New ADRs / `architecture.md` additions / KNOWLEDGE entries for ACCEPT-classified items. Per Chunk 12's ADR cap precedent, builder caps new ADRs at 5 for ACCEPT items too — if more qualify, defer to a follow-up under `## Defer ADR (under cap)` in the inventory.

**Files to edit:**

- `tasks/todo.md` — remove ARCHIVE-classified items (with back-reference to `tasks/todo-archive/2026-Q2.md`); remove SHIP-classified items (with back-reference to the new spec stub); remove ACCEPT-classified items (with back-reference to the ADR / architecture.md / KNOWLEDGE entry). Items remaining are in-flight only. Target: ≤500 lines (spec §5.C1).
- `architecture.md` — receive any ACCEPT promotions that promote to architectural stances. Each ACCEPT entry into `architecture.md` carries a dated annotation: `(promoted from tasks/todo.md on 2026-05-...)`.
- `KNOWLEDGE.md` — receive any ACCEPT promotions that promote to KNOWLEDGE entries. Dated annotation: same.

**Files to read (no edit):**

- `tasks/todo.md` end-to-end (4,408 lines — the largest read of the build; do not skim; the bulk of 13.A's effort).
- `docs/decisions/` and `architecture.md` to identify candidate destinations for ACCEPT items.

**Verification commands (13.B):**

```
# After applying:
wc -l tasks/todo.md
# Target: ≤500 lines per spec §5.C1.

# Sanity-check archive
test -f tasks/todo-archive/2026-Q2.md && wc -l tasks/todo-archive/2026-Q2.md

# Sanity-check spec stubs for SHIP-classified items
ls tasks/builds/
```

**Acceptance:**

- `tasks/todo-triage-inventory.md` exists with one row per deferred item.
- Operator approval recorded.
- `tasks/todo.md` is ≤500 lines post-triage.
- `tasks/todo-archive/2026-Q2.md` exists.
- Every removed item has a forward-reference to its new home (archive / spec stub / ADR / architecture.md / KNOWLEDGE).
- Spec stubs for SHIP-classified items exist as one-paragraph slugs (full spec authoring deferred).

**Docs touched (doc-sync checklist):** `tasks/todo.md`, `tasks/todo-triage-inventory.md` (new), `tasks/todo-archive/2026-Q2.md` (new), 0–N new ADRs, conditional updates to `architecture.md` and `KNOWLEDGE.md`.

**Builder notes:**

- 281 items is single-session-survivable at ~15 items per minute classification rate (≈3 hours). If the builder hits context-window pressure mid-inventory, save progress to `tasks/todo-triage-inventory.md` and stop; the inventory is append-only by design. Resume in a fresh session.
- The ACCEPT pile is where the most ADR-creation pressure comes from. Same ≤5 cap as Chunk 12; defer overflow.
- Do NOT delete any item without a forward-reference. The operator must always be able to trace where an item went.

## 19. Final acceptance (programme-level)

Per spec §9. After all 13 chunks merge across both branches:

- `bash scripts/verify-no-db-in-routes.sh` exits 0 (GREEN) on the branch tip of Branch 2.
- All 9 violators are migrated; `workspaceInboundWebhook.ts` exemption preserved with the T1 `guard-ignore` token shape.
- For each migrated route, the T2 four-bullet invariant holds (verified by `pr-reviewer` at branch-level review).
- `.claude/agents/reality-checker.md` and `.claude/agents/incident-commander.md` exist; `validate-setup` passes on Branch 1's tip; both agents are referenced in CLAUDE.md's fleet table and Common invocations block.
- `pr-reviewer`, `adversarial-reviewer`, `builder` carry the new contracts.
- `feature-coordinator` pipeline includes `reality-checker` as §8.4.
- CLAUDE.md §6 carries the three minimal-change rules; § Review pipeline carries the GRADED posture and `REVIEW_GAP` format.
- `replit.md` typecheck claim corrected.
- `_archive/` exists with README; `prototypes/` and `attached_assets/` moved with git history; T7 path-reference grep clean.
- `tasks/todo.md` ≤500 lines; `tasks/todo-archive/2026-Q2.md` exists; `KNOWLEDGE.md` ≤2,500 lines; both inventories applied only after operator approval.
- `docs/testing-transition-plan.md` exists with the T-minus-14 trigger embedded.
- CI is green on both branches at PR-open time (spec §9 F4). The plan does NOT assert a specific gate count.

PR #277 is NOT a final-acceptance item — pre-plan decision per spec §11.

## 20. Executor notes

**Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.**

**One exception, narrow:** `bash scripts/verify-no-db-in-routes.sh` is the ONLY `scripts/verify-*.sh` permitted to run locally during this build. It is invoked in three places only, and only for the purposes named:

- **Chunk 1** — inverse-acceptance run (gate MUST fail with 9 violators).
- **Chunk 11.1-11.9** — per-sub-chunk decrement check (gate violation count drops by exactly 1).
- **Final acceptance (§19)** — single confirmation that the gate exits 0 on Branch 2's tip after the 9th migration.

This is NOT a general "you may run gate scripts locally" exception. Every other `scripts/verify-*.sh`, `scripts/gates/*.sh`, `npm run test:*`, `npm test`, and `scripts/run-all-*.sh` remains CI-only. If a builder is tempted to run any other gate to "double-check" something, STOP — that is exactly the pattern this plan forbids.

**Second narrow allowance:** `bash scripts/validate-setup.sh` is permitted for agent frontmatter/schema validation in the chunks that explicitly list it (Chunks 4, 5, 6, 7, 8, 9). It is NOT a `scripts/verify-*.sh` script and is NOT part of the test-gate suite; it validates the `.claude/` agent fleet structure. The broader CI-only prohibition does not cover it. Builders should not refuse to run it out of caution.

**Auto-commit rules.** Per CLAUDE.md user preferences, the main session does NOT auto-commit. Each chunk's builder returns its verdict; the operator commits between chunks. The two-step inventory chunks (12, 13) make this explicit: 12.A writes the inventory to disk and STOPS; the operator reviews and commits the inventory before 12.B is dispatched. 12.B is a separate builder invocation triggered by the operator's approval message. Same workflow applies to 13.A and 13.B.

**Branch ordering for the operator.** Branch 1 should land first because Chunk 9 references Chunk 7's `reality-checker` filename. If the operator chooses to land Branch 2 first, Chunks 1, 3, 11.1-11.9, 12, 13 are all independent of Branch 1's contents — those land cleanly. Chunk 9 is the only cross-branch dependency.

**Caveat on inverted branch order.** If Branch 2 lands first, any `tasks/todo.md` or `KNOWLEDGE.md` follow-ups generated by Branch 1's work (Chunks 4-10 may surface KNOWLEDGE entries or new TODOs as they edit agent contracts and add new agent files) will NOT be included in Branch 2's Chunk 12 and Chunk 13 sweeps. Those follow-ups must be handled in a separate triage pass after Branch 1 merges — either a follow-up task, a delta to the Q2 archive, or a partial re-run of the sweep. Default branch order (Branch 1 first) avoids this entirely; the inverted order is technically permitted but accepts this carry-over cost.

**OPEN items (none expected to block builder).** Every architectural choice (target services per violator, branch state during the CI-red window, ADR creation cap, agent file shape, REVIEW_GAP format, hotfix vs incident-commander split) is resolved in this plan. If the builder hits a `PLAN_GAP` verdict during execution, return to the architect rather than improvising — the plan is intentionally complete.

**Per-chunk verification budget (recap).** Allowed locally per `references/test-gate-policy.md`:

- `npm run lint`
- `npm run typecheck` (or the dual-tsconfig form)
- `npm run build:server` / `npm run build:client` when the chunk touches the build surface
- Targeted `npx vitest run <path-to-test>` for a unit test authored within this chunk

Nothing else runs locally. CI runs the full suite at PR-open time.
