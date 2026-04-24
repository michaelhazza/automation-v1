# PR Review Log — create-spec-conformance branch

**Files reviewed:**
- `C:\Files\Projects\automation-v1\.claude\agents\spec-conformance.md` (new)
- `C:\Files\Projects\automation-v1\CLAUDE.md` (modified)
- `C:\Files\Projects\automation-v1\.claude\agents\feature-coordinator.md` (modified)

**Timestamp:** 2026-04-22T00:00:00Z

**Scope:** Agent-fleet infrastructure review — correctness and coherence of the spec-conformance agent design, consistency across the three files, soundness of auto-detection and classification logic, and pattern-match with existing fleet members (spec-reviewer, pr-reviewer, chatgpt-spec-review).

---

## Blocking Issues

### B1 — Log filename contract contradiction across the three files

Three files specify three (effectively two) different filenames for the same review log, which will break log discovery and pattern mining.

- `C:\Files\Projects\automation-v1\.claude\agents\feature-coordinator.md:103` says the agent writes `tasks/review-logs/spec-conformance-log-<slug>-<chunk-slug>-<timestamp>.md`.
- `C:\Files\Projects\automation-v1\.claude\agents\spec-conformance.md:229` and `:253` say the log is written to `tasks/review-logs/spec-conformance-log-<slug>-<timestamp>.md`.
- `C:\Files\Projects\automation-v1\CLAUDE.md:341` documents the self-write filename as `tasks/review-logs/spec-conformance-log-<slug>-<timestamp>.md`.

The agent is the writer, so the agent's own filename wins by default — meaning feature-coordinator's instruction to record a `<chunk-slug>`-containing path in `progress.md` will be wrong. This is the direct analog of the existing convention used for pr-reviewer where feature-coordinator DOES inject `<chunk-slug>` (`pr-review-log-<slug>-<chunk-slug>-<timestamp>.md`) — but there the coordinator is the writer (it extracts the fenced block and writes the file itself). For spec-conformance the agent self-writes, so the coordinator cannot dictate the filename unless the contract says so.

Pick one and apply it consistently across all three files:

- **Option 1 (preferred — matches pr-reviewer precedent when a chunk is in play):** Update `spec-conformance.md:229`, `:253`, and `CLAUDE.md:341` to `spec-conformance-log-<slug>-<chunk-slug>-<timestamp>.md`, and add a "caller may pass `<chunk-slug>`; omit if not provided" clause in the agent's Final Output section so that manual invocations without a chunk still produce a valid filename.
- **Option 2:** Update `feature-coordinator.md:103` to drop `<chunk-slug>`, matching the agent's self-written filename. Less discoverable across multi-chunk features (all chunks' logs collide on slug), so less preferred.

Also in the scratch filename at `spec-conformance.md:123` (`spec-conformance-scratch-<slug>-<timestamp>.md`) — keep it consistent with whichever option you pick.

### B2 — Auto-detection can silently verify partial work against a full spec, leading to false MECHANICAL_GAP auto-fixes

`C:\Files\Projects\automation-v1\.claude\agents\spec-conformance.md:96-100` (Step C — Scope the check) says:

> "If `tasks/builds/<slug>/progress.md` lists which chunks are marked `done`, restrict to those. **Otherwise, verify the entire changed-code set against the entire spec.**"

Failure mode: a user invokes `spec-conformance: verify the current branch against its spec` mid-way through implementing a multi-chunk spec, with no build slug and no explicit phase/chunk passed. The agent then enumerates every requirement in the spec and classifies not-yet-built items that the spec explicitly names (files, exports, schema columns, error codes) as MECHANICAL_GAPs. Because the MECHANICAL_GAP criteria at `:164-172` are satisfied — "the spec explicitly names the missing item" — the agent will **auto-write scaffolding for items that were supposed to land in later phases**, touching files outside the user's current task boundary.

The classification rules at `:183-189` do list "Cross-phase change" and "Would need to modify a file outside the changed-code set to resolve it" as DIRECTIONAL signals, which offers a partial backstop — but only for files outside the changed-code set. A phase-2 file the developer hasn't created yet will be classified as mechanical ("spec names a new file to create") and auto-scaffolded.

Fix options (any of these closes the hole):

- **Preferred:** Make scoping mandatory. In Step C, if no chunk/phase is named AND no `progress.md` with `done` markers is available, **stop and ask the user for scope** rather than falling through to "verify the entire spec". This matches the existing fleet's "when in doubt, stop" posture (spec-reviewer Step A item 5 at `:53` already does this for the spec-detection path).
- **Alternative:** Add a rule to Step 3 — if the changed-code set does NOT include a file the spec names as new, treat the missing-file gap as DIRECTIONAL, not MECHANICAL. Rationale: the developer has not started that file; unilaterally creating it extends scope.
- **Alternative:** In Step 4a (`:199-219`), add a hard rule: never create a new file unless the changed-code set already contains at least one edit in the same phase/chunk as that file. Requires knowing the phase partition, which is fragile.

The preferred fix is the simplest and aligns with the "conservative by default" posture in the agent's own Rules section (`:325`).

---

## Strong Recommendations

### S1 — Clarify how chunk scoping works when the caller names a chunk but the spec does not use "chunk" as a heading

`feature-coordinator.md:101-102` delegates with: *"Verify the current branch implements chunk '{chunk name}' from the plan at `tasks/builds/{slug}/plan.md`. Scope to this chunk only."*

But `spec-conformance.md:96-100` only describes scope restriction via (a) caller naming a phase/chunk, or (b) reading `progress.md` for chunks marked `done`. The agent is expected to then restrict Step 1's requirement extraction to that chunk — but the extraction rules at `:104-132` don't describe how to partition a spec by chunk name. If the plan uses chunk headings that don't match the spec's section headings (common, since the plan is produced from the spec by architect), the agent has to infer the mapping.

**Suggested test (Given/When/Then) for the main session to think through before shipping:**

- **Given** a spec organised by Phase 1 / Phase 2 / Phase 3 headings, and a plan at `tasks/builds/foo/plan.md` with chunk names like `"Chunk 2 — DB schema"` that architect derived from "Phase 1 §3 Schema"
- **When** feature-coordinator invokes `spec-conformance` with chunk name `"Chunk 2 — DB schema"`
- **Then** the agent must correctly identify that Step 1's requirement extraction should cover only the spec sections that map to `"Chunk 2"` — not the whole spec.

Proposed fix in `spec-conformance.md`: add one sentence to Step C: *"When the caller names a plan chunk, read the plan at `tasks/builds/<slug>/plan.md` to identify which spec sections that chunk maps to, then scope Step 1's extraction to those sections. If the plan does not make the mapping explicit, verify only the spec items that correspond to the files in the changed-code set."*

### S2 — The "AMBIGUOUS → DIRECTIONAL" default should be stated at the Step 3 entry point, not only in the subsection header

The AMBIGUOUS → DIRECTIONAL rule is stated three times in the agent file (`:162`, `:191-193`, `:325`) but only as a defensive reminder, not as part of the classification procedure at the entry point. In practice, an LLM running this prompt under time pressure will scan the MECHANICAL_GAP list first, match some criteria, and classify as mechanical without ever reaching the AMBIGUOUS guidance. Rearrange Step 3 so the very first decision prompt is "Am I 100% sure this is mechanical?" with an explicit fail-closed path: "If not 100% sure, skip straight to DIRECTIONAL_GAP."

The current structure lists MECHANICAL_GAP criteria first, which primes the classifier to pattern-match toward mechanical — the opposite of the conservative posture the agent is aiming for.

### S3 — Missing rule for "spec contradicts itself"

The Rules section at `:317-328` says "You do not modify the spec." Good. But the agent doesn't describe what to do when the spec has internal contradictions discovered during Step 1 extraction — e.g. two sections specifying conflicting contracts for the same route. Silently picking one is wrong (fail-over to the implementation the developer chose), and so is failing the whole run.

Suggested addition to Rules: *"If the spec contradicts itself during Step 1 extraction, classify the affected requirement as AMBIGUOUS (routes to tasks/todo.md) with reason 'spec self-contradiction — requires spec-reviewer / chatgpt-spec-review pass'. Do not modify the spec."*

### S4 — The scoped requirement extraction doesn't track "implicit requirements from referenced files"

Step 1 at `:108-121` lists the categories of concrete requirements to extract. But specs frequently reference external contracts by path (e.g. "follows the shape in `shared/schemas/agentRunResponse.ts`"), and those are concrete requirements by reference. The current rules would cause the agent to read the spec and flag `agentRunResponse.ts` as "missing from the changed-code set" if the developer didn't modify it — even though the spec's intent is "conform to this existing contract", not "modify this file."

Add a clarification to Step 2 at `:133-148`: *"If a requirement references an existing file or contract, verify only that the implementation conforms to that contract — do not flag the referenced file itself as a gap unless the spec explicitly says to modify it."*

### S5 — No handling for "spec not found" when the spec lives outside `docs/` or `tasks/`

Step A at `:41-55` only looks in `docs/**/*.md` and `tasks/**/*.md`. This codebase stores most specs under `docs/superpowers/specs/` or `tasks/builds/<slug>/plan.md`, so it works in practice. But `references/` and `server/docs/` also exist and are used occasionally — a user could reasonably store a spec there. At minimum, document the restriction: *"Specs stored outside `docs/**` and `tasks/**` must be passed explicitly by the caller."*

---

## Non-Blocking Improvements

### N1 — TOC drift

The Contents list at `C:\Files\Projects\automation-v1\.claude\agents\spec-conformance.md:16-25` lists section "6. Final output envelope" but the actual section heading at `:251` is just `## Final output`. Minor — either make the TOC match the heading or rename the heading to `## Final output envelope` to match the pattern used by `pr-reviewer.md`.

### N2 — Dedup rule phrasing inconsistency

`CLAUDE.md:356` says dedup scans by `finding_type` OR "leading ~5 words". `spec-conformance.md:239` says to scan by "same REQ description (or same leading ~5 words)". The mechanic is the same, but the phrasing diverges from the canonical rule in CLAUDE.md. Align the agent file's wording to the canonical rule so future reviewers comparing the files don't suspect drift.

### N3 — "One section per conformance run" could be stated more strongly

`spec-conformance.md:223` says "one section per conformance run, never mix into an existing feature's section." Good. But consider adding an example of the right heading shape when the same spec is verified twice (e.g. after a fix-review loop): the second run should get a new heading with a fresh `(YYYY-MM-DD)` or timestamp suffix so the two runs' deferred items don't collide. The current dedup rule handles this for individual items, but the heading-level behavior is implicit.

### N4 — Step ordering: Step 4 subsections 4a/4b/4c vs Step 5

Step 4 has subsections 4a (mechanical fixes), 4b (directional routing), 4c (log every decision). Step 5 is "re-verify applied fixes". The dependency is only 4a → 5 (re-verify what you fixed). 4b and 4c are independent. The current ordering reads naturally, but a reader skimming may assume Step 5 follows all of 4 — fine as-is, just consider a one-line note at the top of Step 5: *"This step only re-verifies 4a's mechanical fixes; 4b's deferred items don't need re-verification because nothing was changed."*

### N5 — The "CONFORMANT_AFTER_FIXES" verdict should mention the coordinator re-run rule in the agent's own Next-step text

`spec-conformance.md:309` has the CONFORMANT_AFTER_FIXES next-step as: "mechanical gaps closed in-session, re-run `pr-reviewer` on the expanded changed-code set." This is correct and matches `CLAUDE.md:341` and `feature-coordinator.md:107`. Minor: add "because the reviewer needs to see the final fixed state, not the pre-fix state" to match the explanatory phrasing in `CLAUDE.md:317`.

### N6 — `tasks/review-logs/**` exclusion in Step A item 2

Step A item 2 at `:50` excludes `tasks/review-logs/**` from spec detection. Good. But Step B's changed-file-set exclusion at `:85-89` also lists `tasks/review-logs/**` — this correctly prevents the agent from treating its own log output as a code change. The pair is self-consistent. Just noting for the record — no change needed.

### N7 — Consider whether `spec-conformance` should also run after `chatgpt-pr-review` / `dual-reviewer` fix passes

CLAUDE.md's "Before creating any PR" flow at `:321` is: `spec-conformance → pr-reviewer → (optionally dual-reviewer) → PR`. But if `dual-reviewer` or `chatgpt-pr-review` apply mechanical fixes that touch files the spec named, should the spec-conformance agent re-run to verify those fixes didn't drift from the spec? Probably not worth a re-run by default (the fixes are answering pr-reviewer findings, not spec requirements), but worth one sentence in CLAUDE.md saying "spec-conformance runs once per chunk; subsequent review passes do not re-trigger it." Non-blocking — just preempts a future consistency question.

---

## Verdict

**Request changes.** B1 (filename contract contradiction across the three files) and B2 (mid-spec partial-work scoping hole) must be resolved before merge — both are concrete coherence bugs that will bite the first time someone uses the agent without the feature-coordinator wrapper. Strong recommendations S1–S5 sharpen the design; non-blocking items are polish.
