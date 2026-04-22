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
