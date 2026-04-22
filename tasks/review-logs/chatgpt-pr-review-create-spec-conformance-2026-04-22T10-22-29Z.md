# ChatGPT PR Review Session — create-spec-conformance — 2026-04-22T10-22-29Z

## Session Info
- Branch: create-spec-conformance
- PR: #174 — https://github.com/michaelhazza/automation-v1/pull/174
- Started: 2026-04-22T10:22:29Z

---

## Round 1 — 2026-04-22T10:22:29Z

### ChatGPT Feedback (raw)

> Executive summary
>
> This PR is conceptually strong and nearly production-ready, but there are two subtle systemic risks still worth tightening before merge. They won't break immediately, but they will show up under real usage with multi-chunk builds and mixed invocation paths. Everything else is solid and aligns well with your broader agent-fleet architecture.
>
> What's strong (keep as-is)
>
> 1. The core pattern is correct and high leverage — spec-conformance as a pre-review guardrail, deterministic validator, auto-fixes only when safe (mechanical), routes ambiguity cleanly.
> 2. Mixed-mode (auto-fix + route) is the right architecture — mechanical → fix immediately; directional/ambiguous → route. Reusable pattern across the system.
> 3. Integration with feature-coordinator is well thought through — C1b flow sits between build and review, handles retry loops, differentiates architectural vs non-architectural.
>
> What still needs tightening
>
> 1. Chunk scoping still has a blind spot (highest priority). When a chunk is passed, plan→spec mapping is unclear, and the agent falls back to "changed files only", spec-required files not yet created are invisible and the agent can return false CONFORMANT. Change: do NOT allow fallback to changed-file-only validation — if chunk→spec mapping is unclear: STOP, ask for clarification, do NOT proceed. Alternative (better long-term): require plan to explicitly map chunk → spec sections; treat missing mapping as invalid input. Principle: conformance must be complete or blocked, never partial and silent.
>
> 2. Missing standalone usage contract (non-coordinator path). In manual mode, user gets NON_CONFORMANT, items go to `tasks/todo.md`, but no clear rule on what to do next. Fix: add a single explicit rule in CLAUDE.md — process spec-conformance NON_CONFORMANT findings exactly like pr-reviewer: non-architectural → fix immediately, architectural → defer to backlog, re-run if fixes were applied.
>
> 3. Filename contract is now correct, but fragile. `<chunk-slug>` is assumed but not strictly enforced — caller defines it, no validation of format. Risk: eventually get inconsistent casing, spaces vs hyphens, duplicate or mismatched log paths. Fix: define once globally — chunk-slug = kebab-case(chunk name) — and enforce lower-case, no spaces, hyphen-separated.
>
> 4. Minor but important: spec contradiction handling. Currently the agent does not explicitly handle spec self-conflicts. If spec says A=true in one section and A=false in another, agent may pick one implicitly or classify incorrectly. Fix: add rule — if spec contradicts itself → classify as AMBIGUOUS → route.
>
> Strategic feedback (bigger picture)
>
> Three layers of validation now: Spec reviewer → Spec conformance (this PR) → PR reviewer. Full closed loop: Spec → Implementation → Validation → Review. Where this can go next: (1) Spec coverage metrics, (2) Drift detection over time, (3) Automated plan validation.
>
> Final verdict: Merge readiness — Yes, with 1 required fix. Fix chunk scoping fallback before merging. That is the only issue that can silently break the system. Everything else is either already strong or minor hardening.

### Decisions

| Finding | Decision | Severity | Rationale |
|---------|----------|----------|-----------|
| 1. Chunk scoping blind spot — remove changed-file-only fallback, STOP when mapping unclear | reject | high | Already-done. `spec-conformance.md:105` has the explicit STOP-and-ask guard for ambiguous plan-to-spec mapping; `:109` has the fallback STOP-and-ask when no scope rule yields a clear answer. ChatGPT appears to have reviewed the pre-fix (pre-S1) state. Current text satisfies the "complete or blocked, never partial and silent" principle. No further change needed. |
| 2. Standalone NON_CONFORMANT contract — hoist into explicit rule | accept | medium | Contract exists at CLAUDE.md:341 but is buried inside the "self-writes" persistence bullet. ChatGPT's ask is for prominence — a scannable standalone rule in the invocation-guidance section that manual and coordinator paths both read. Added a dedicated paragraph under "Independent review is not optional" that names both invocation paths explicitly. |
| 3. Chunk-slug kebab-case — define once globally | accept | low | Definition was duplicated across `feature-coordinator.md:103`, `:115`, and `spec-conformance.md:270`, each slightly different wording. Added a new subsection in CLAUDE.md ("Review-log filename convention — canonical definition") that owns the definition including deterministic derivation (lowercase → replace non-alphanumerics with single hyphen → trim). Updated both agent files to reference the canonical definition instead of redefining. |
| 4. Spec self-contradiction handling | reject | low | Already-done. `spec-conformance.md:340` has the explicit Rules entry: "If the spec contradicts itself during Step 1 extraction, classify the affected requirement as AMBIGUOUS. Route to `tasks/todo.md` with reason 'spec self-contradiction — requires `spec-reviewer` or `chatgpt-spec-review` pass'. Do not modify the spec. Do not pick one side of the contradiction and verify against it — that would silently lock in whichever version of the spec the developer happened to implement." Wording is sufficient. |
| Strategic: Spec coverage metrics | defer | low | Valid future-work direction but out of scope for this PR per user notes. Deferred to `tasks/todo.md` with ship-gate criterion. |
| Strategic: Drift detection over time | defer | low | Valid but requires durable spec→branch mapping and scheduled re-runs — substantially larger surface than this PR. Deferred to `tasks/todo.md`. |
| Strategic: Automated plan validation | defer | low | Valid — would close the "plans are loosely mapped to specs" gap — but needs its own design. Deferred to `tasks/todo.md`; noted as lighter lift than drift detection since it can reuse the REQ-extraction pass. |

### Implemented

- `CLAUDE.md` § *Independent review is not optional* — added a standalone paragraph "Processing `spec-conformance` NON_CONFORMANT findings — standalone contract" that explicitly covers both `feature-coordinator` and manual invocation paths, mapping NON_CONFORMANT processing to the pr-reviewer finding-processing pattern (non-architectural → fix in-session + re-invoke; architectural → promote to `## PR Review deferred items`; cap at 2 re-invocations).
- `CLAUDE.md` — new subsection *Review-log filename convention — canonical definition* between the "Review logs must be persisted" and "Deferred actions" subsections. Names the filename shape, defines `<slug>`, `<chunk-slug>` (with deterministic kebab-case derivation), and `<timestamp>`. Names the six agents that follow the shape.
- `.claude/agents/spec-conformance.md` — replaced the inline filename-convention paragraph (was at §Final output envelope) with a back-reference to the canonical CLAUDE.md definition; kept the "slug/chunk-slug must match across scratch + log + todo" requirement local since it's agent-specific.
- `.claude/agents/feature-coordinator.md` — replaced two inline `chunk-slug` redefinitions (C1b spec-conformance path, C2 pr-reviewer path) with back-references to the canonical CLAUDE.md definition.
- `tasks/todo.md` — appended a new section "Deferred from chatgpt-pr-review — PR #174 (2026-04-22)" with three strategic follow-ons (coverage metrics, drift detection, automated plan validation), each with a ship-gate criterion.

### Rejected (already-done)

- Finding 1 (chunk scoping blind spot) — the exact guard ChatGPT prescribes is already at `spec-conformance.md:105` and `:109`. Verified re-reading the file. ChatGPT's review appears to have been against an earlier revision of the spec.
- Finding 4 (spec self-contradiction) — already covered at `spec-conformance.md:340` with the exact AMBIGUOUS→route rule ChatGPT recommends.

### Top themes

architecture (standalone contract clarity), naming (filename-convention hoist), scope (strategic deferrals)

---

## Round 2 — 2026-04-22T10:36:00Z

### ChatGPT Feedback (raw)

> Executive summary
>
> Round 1 fixes landed cleanly and you've removed all true blockers. This is now mergeable from a correctness standpoint. Round 2 is about tightening one remaining real-world failure mode and a few precision gaps that will only show up under messy usage, not ideal flows.
>
> What changed since round 1 (quick validation)
>
> You correctly: killed the filename drift problem with a canonical definition, made NON_CONFORMANT handling explicit and consistent, confirmed STOP guards and contradiction handling already exist, avoided over-engineering the system. No blocking issues remain.
>
> Round 2 feedback
>
> 1. Chunk fallback still drops missing files (HIGHEST PRIORITY)
> You have: STOP if scope is unclear, scoped extraction if mapping exists, fallback → "files in changed-code set". That fallback is the problem.
> Scenario: Spec requires migration file (implemented) + service file (not yet created). Plan chunk maps loosely to spec. Mapping doesn't explicitly include service file. Fallback = only check changed files. → service file never evaluated, agent returns CONFORMANT incorrectly. Not theoretical — will happen.
> Core issue: you solved "don't verify full spec silently" but still have "verify partial spec silently". Correct fix: replace fallback logic. If mapping is incomplete or ambiguous, STOP. Never reduce scope to changed files. Or more precise: if plan→spec mapping exists, extract ALL requirements from mapped sections (including files not yet created). If mapping is missing or incomplete, STOP and ask. Never restrict to changed-code-set-only validation.
>
> 2. Spec reference handling (quiet correctness bug)
> If spec says "must follow schema in shared/types/foo.ts", agent may see file not changed and flag it as missing/gap. But intent is: conform to it, not modify it. Fix: if spec references an existing file, validate conformance but do NOT require modification unless explicitly stated. Without this, false positives in shared-schema/contract-heavy systems.
>
> 3. Classification bias (mechanical vs directional)
> Structure still subtly biases toward mechanical classification first. Ordering matters for LLM behaviour. Fix: at the top of classification step, ask first — "Am I 100% certain this is mechanical?" If NO → classify as DIRECTIONAL. If YES → continue mechanical checks. Prevents accidental auto-scaffolding, scope creep, "LLM being helpful" in the wrong way. Reinforces fail-closed philosophy.
>
> 4. Plan → spec mapping contract (clarity gap)
> Feature-coordinator passes chunk name, spec-conformance tries to infer mapping. Mapping contract is implicit. Risk: different sessions interpret chunk differently, map to different spec sections, inconsistent validation. Fix (one sentence): when chunk is provided, use plan.md as source of truth for mapping. If plan does not explicitly map chunk → spec sections, STOP and ask.
>
> 5. Minor but worth fixing
> A. Stale cross-reference — pointing to wrong section in spec-reviewer → just remove or point to CLAUDE.md instead
> B. Re-run clarity — make explicit in summary flow: spec-conformance → pr-reviewer (re-run if fixes) → ...
>
> What you should NOT change
> Do NOT add more automation around plan validation (correctly deferred), schema-diff or coverage systems yet, heuristics for partial matching. Current philosophy is right: deterministic, explicit, fail-closed.
>
> Final verdict: Approve with 1 recommended fix. Can merge as-is, but to hold up under real usage, fix the chunk fallback. Everything else is correctness polish or future-proofing.

### Decisions

| Finding | Decision | Severity | Rationale |
|---------|----------|----------|-----------|
| 1. Chunk fallback drops missing files — replace fallback with STOP, never narrow to changed-code-set only | reject | high | Already-done in round 1. `spec-conformance.md:105` explicitly extracts **all** concrete requirements from mapped sections "including new-file requirements whose files are not yet in the changed-code set", and includes the sentence "Do not silently narrow scope to 'only items corresponding to files in the changed-code set' — that shortcut defeats the agent's primary purpose." `:109` STOPs and asks when no scope rule yields a clear answer — there is no changed-code-set-only fallback path. ChatGPT's prescribed fix is the current text. Cited lines verified line-by-line. |
| 2. Spec reference to existing unchanged file — verify conformance, do not require modification | reject | medium | Already-done. `spec-conformance.md:152` has a dedicated "Referenced existing files" paragraph inside Step 2: *"If a requirement references an existing file or contract … verify only that the implementation conforms to that contract. Do not flag the referenced file itself as a gap unless the spec explicitly says to modify it. The spec's intent in these cases is 'the new code conforms to this existing boundary', not 'the existing boundary needs changes.'"* This is the exact fix ChatGPT prescribes. |
| 3. Classification ordering bias — ask "100% sure it's mechanical?" FIRST | reject | medium | Already-done in round 1 (was fixed prior to the round 1 review session). `spec-conformance.md:175` opens Step 3 with: *"Decision order — fail-closed. Start every classification with one question: 'Am I 100% sure this is mechanical?' If the answer is anything short of 100% — 'probably', 'likely', 'most likely', 'the fix looks obvious' — classify as DIRECTIONAL_GAP and move on. Do not read the MECHANICAL_GAP criteria below until you have passed this check."* The question is now the first instruction in Step 3, above MECHANICAL_GAP criteria. ChatGPT's prescribed fix is verbatim the current text. |
| 4. Plan → spec mapping contract — state plan.md as single source of truth, STOP if not explicit | accept | low | Functionally-equivalent guard already at `spec-conformance.md:105` (read plan.md, STOP on ambiguity). But the source-of-truth framing was implicit — a reader could still try to infer mapping from the chunk name or spec headings when plan.md is silent. Tightened `:105` to explicitly name plan.md as the single source of truth for chunk-to-spec-section mapping, forbid inference from other sources, and broaden the STOP trigger to "missing, silent, or ambiguous." One-sentence edit. |
| 5A. Stale cross-reference to spec-reviewer | reject | low | Already-done. The pre-round-1 "see `spec-reviewer.md` Step A" cite that the pr-reviewer round identified was removed. Remaining mentions of `spec-reviewer` in `spec-conformance.md` (lines 10, 339, 340) are all legitimate cross-references to `spec-reviewer` as the agent to defer to when the spec itself has issues — those are correct and should stay. ChatGPT appears to be reviewing a stale version for this item. |
| 5B. Re-run clarity in summary flow | reject | low | Already-done. `CLAUDE.md:323`: *"For spec-driven work, that means: `spec-conformance` → `pr-reviewer` (re-run after any mechanical fixes `spec-conformance` applied) → (optionally `dual-reviewer`) → PR."* This is the explicit re-run clarity ChatGPT is asking for. |

### Implemented

- `.claude/agents/spec-conformance.md:105` — tightened the caller-provided-chunk scoping paragraph. Added explicit "`tasks/builds/<slug>/plan.md` is the single source of truth for chunk-to-spec-section mapping — do not infer the mapping from the chunk name, spec headings, or any other source." Broadened the STOP trigger wording from "ambiguous or silent" to "missing, silent, or ambiguous" to cover the case where the plan makes no mention of the chunk-to-section mapping at all. One-sentence semantic change, same paragraph.

### Rejected (already-done)

- Finding 1 (chunk fallback) — no changed-code-set-only fallback exists. `:105`, `:109` already enforce STOP-on-ambiguity plus extract-all-including-not-yet-created-files. ChatGPT's round-2 feedback appears to describe a pre-round-1 version of the file.
- Finding 2 (spec reference to existing file) — `:152` has the exact rule ChatGPT prescribes, inside Step 2 "Referenced existing files."
- Finding 3 (classification ordering) — `:175` opens Step 3 with the exact 100%-sure gate ChatGPT prescribes, ahead of MECHANICAL_GAP criteria.
- Finding 5A (stale cross-reference) — already resolved in the pr-reviewer round prior to the chatgpt-pr-review session. Remaining `spec-reviewer` mentions are legitimate cross-references, not stale cites.
- Finding 5B (re-run clarity) — CLAUDE.md:323 already has the explicit re-run-after-fixes parenthetical in the summary flow.

### Top themes

scope (chunk-to-spec mapping source-of-truth tightening), false-positive-rejections (5 of 6 findings already-addressed from round 1 or prior)

---

## Round 3 — 2026-04-22T10:49:00Z

### ChatGPT Feedback (raw)

> Executive summary: You're effectively done. This is now production-grade for its intended use. Round 3 is not about fixes. It's about eliminating edge-case ambiguity and future misuse. There are no blockers left. Only one optional tightening remains that meaningfully improves long-term reliability.
>
> 1. Only meaningful remaining gap: chunk fallback still has a blind spot (edge-case, not structural).
> The reviewer's round 2 S1 finding is still technically valid in one narrow case. Current behaviour has mandatory STOP if scope unclear, plan = source of truth, mapping required for chunk scoping. But you also allow: "if mapping exists but is incomplete, proceed with partial extraction." That's where the edge case lives.
> Exact failure mode: Plan maps chunk → spec section A. Spec section A implicitly requires File X (explicitly mentioned in section A) and File Y (logically required but defined elsewhere in spec, section B). Mapping only includes section A. File Y lives in section B. Agent never sees section B → File Y is never evaluated.
> This is no longer a "fallback bug" — it's a mapping completeness assumption. Your system assumes plan mapping is correct and complete. This is now the weakest link in the system.
> Recommended fix (light, optional, high leverage): Add one rule — if chunk → spec mapping is provided: assume mapping is authoritative BUT if a requirement in mapped sections references entities outside those sections, include those referenced requirements in scope.
> Why this is the right level: does NOT reintroduce full-spec scanning, does NOT require plan validation (already deferred correctly), preserves fail-closed philosophy, covers cross-section dependencies.
> If you choose NOT to fix this, still acceptable — feature-coordinator is the primary caller, plans should be correct, plan validation is in backlog. So: resilience improvement, not a correctness requirement.
>
> 2. Spec-conformance vs plan-validation boundary (clarity only)
> You've implicitly drawn this line: spec-conformance verifies implementation vs spec, future system verifies plan vs spec. Correct, but not explicitly stated. Add one clarifying sentence (optional):
>   "spec-conformance assumes the plan → spec mapping is correct. Validation of plan completeness against the spec is out of scope."
> Why: prevents future agents from trying to "helpfully expand scope" or reintroducing full-spec validation indirectly.
>
> 3. Strong design validation (what you got very right — no action)
> A. Avoided biggest failure mode: no silent full-spec validation, no silent partial validation fallback. Eliminates 90% of risk.
> B. Classification gate now correct: "100% sure mechanical?" first, fail-closed behaviour. Right pattern for mixed-mode agents.
> C. Separated responsibilities cleanly: spec-conformance → correctness vs spec, plan validation → separate concern, reviewer → quality not spec alignment. Keeps system scalable.
> D. Coordinator loop stable: bounded retries, no churn loops, architectural vs non-architectural split. Where most agent systems break — yours doesn't.
>
> 4. Things NOT to change (no action)
> Do not: add heuristics to guess missing spec sections, reintroduce "verify entire spec if unsure", add implicit cross-phase scanning, add plan inference logic. All undo the discipline you've built.
>
> Final verdict: Approve — system complete. No blockers, no correctness issues, only one optional resilience improvement.

### Decisions

| Finding | Decision | Severity | Rationale |
|---------|----------|----------|-----------|
| 1. Cross-section dependency inclusion — follow explicit references from a mapped section into another spec section | accept | medium | Resilience improvement that fits the existing fail-closed posture. Key tightening vs ChatGPT's looser framing: restrict to **explicitly named** cross-references (named section, heading, or §-number in the spec itself) — not implicit mentions ("a column name that happens to be defined elsewhere"). Explicit cross-references are the spec's own structure, not agent inference, so the rule doesn't blur the "plan is source of truth" boundary (item 2). If a named reference is ambiguous, STOP — same posture as ambiguous plan mapping. Added as a new sub-paragraph inside `spec-conformance.md:105`. |
| 2. Spec-conformance vs plan-validation boundary — one clarifying sentence | accept | low | Pure doc-clarity win. Prevents future agents from reintroducing full-spec scanning under the guise of "helpful" scope expansion. Added as a new top-level Rule ("You are not a plan validator") just below the "You are not a code reviewer" rule — parallel structure makes the boundary scannable. Naming `tasks/todo.md`'s future "automated plan validation" backlog item ties it to the round-1 strategic deferral. |
| 3A–D. Design validation (avoided biggest failure modes, classification gate correct, responsibilities separated, coordinator loop stable) | acknowledged — no action | — | Recognition-only items. Recorded here for session continuity; no implementation required. |
| 4. Things NOT to change (heuristics / full-spec fallback / cross-phase scanning / plan inference) | acknowledged — no action | — | Guardrails already observed. No change needed; recorded so the constraint is captured explicitly in the log. |

### Implemented

- `.claude/agents/spec-conformance.md:105` — appended a new sub-paragraph inside the caller-provided-chunk scoping rule: "Follow explicit, named cross-section references." Rule states that when a requirement in a mapped section explicitly points at another section (named section, heading, or §-number), include that referenced requirement in scope. Explicitly forbids following implicit mentions. Ambiguous-but-named references → STOP and ask (same posture as ambiguous plan mapping). Framing emphasizes "follows the spec's own structure; does not infer missing plan mappings" so a future reader does not misread this as a loophole for scope expansion.
- `.claude/agents/spec-conformance.md:339` — new Rule: "You are not a plan validator." States that the agent assumes the plan→spec mapping is correct, names plan-completeness validation as out of scope (tracked in `tasks/todo.md` as future automated plan validation), and forbids "helpful" scope expansion. Placed immediately below "You are not a code reviewer" so the two boundary rules read together.

### Rejected

_None this round._

### Deferred

_None this round._

### Architectural items surfaced

_None — both accepted items are doc-level surgical edits inside a single agent file. Both pass the architectural-signal size filter (≤30 LOC, single file, no contract break)._

### Top themes

architecture (plan-validation boundary), scope (cross-section reference rule)
