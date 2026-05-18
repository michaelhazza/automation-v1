# ChatGPT Spec Review Session — browser-vision-grounding — 2026-05-18T11-11-14Z

## Session Info
- Spec: `docs/superpowers/specs/2026-05-18-browser-vision-grounding-spec.md`
- Branch: `main` (spec committed directly to main; no PR — review proceeds against the working tree spec file)
- PR: n/a (committed to main; no feature branch)
- Mode: manual
- Started: 2026-05-18T11:11:14Z

Note: This spec was already reviewed by `spec-reviewer` (2 iterations, READY_FOR_BUILD, 17 mechanical fixes applied) and committed to `main` at sha `28021e92`. Since there is no feature branch / PR, per-round commits will land directly on `main` — same auto-commit-and-push override as documented in the agent contract. The auto-commits stage ONLY the spec file and this session log; unrelated working-tree changes (`tasks/current-focus.md`, `tasks/builds/browser-vision-grounding/intent.md`, `progress.md`, and the codex-spec-review output files) are NOT staged.

---

## Round 1 — 2026-05-18 (operator pasted ChatGPT response)

**Overall ChatGPT verdict:** CHANGES_REQUESTED
**Findings:** 10 total | 10 technical (auto-apply) | 0 user-facing

### Triage log

| # | Finding | Severity | Category | Triage | Decision |
|---|---------|----------|----------|--------|----------|
| F1 | Migration 0373 number may conflict | high | bug | technical | Added note in §6 C5 and §7 migration rows: number is illustrative; architect MUST verify migration head at plan time. |
| F2 | DOM log regression criterion untestable in V1 | high | improvement | technical | Moved DOM regression criterion from V1 bucket to follow-up bucket in §1 Goal 8; explanation: static_gates_primary posture has no mechanism to capture or diff runtime run logs. |
| F3 | Parser grammar depends on mutable external README | medium | improvement | technical | Added inline action grammar examples (one per action type) to §8.1; noted architect must pin exact UI-TARS commit hash at plan time. |
| F4 | Pricing file underspecified for implementation | medium | bug | technical | Added placeholder behaviour contract to §8.4: placeholder rate for `ui-tars-7b`, throw on unknown modelId, `Math.round` rounding, sub-cent floor is 0. |
| F5 | Token exposure boundary needs stronger contract | medium | architecture | technical | Added `visionEndpointToken` redaction contract to §8.3 (covering input.json, failure payloads, sandbox stdout/stderr, logs); cross-referenced in §8.6. |
| F6 | Network policy override may erase existing allowlist | medium | bug | technical | Changed §8.7 from "overrides" to "merges": implementation now spreads existing allowlist entries and appends the vision entry; updated code block accordingly. |
| F7 | Hybrid failure semantics ambiguous between §8.8 and §12.5 | medium | clarity | technical | Clarified §8.8 and §12.5: both `vision` and `hybrid` modes fail the entire run on `vision_inference_unavailable` in V1; multi-step recovery explicitly deferred to follow-up build. |
| F8 | Harvest ordering needs exact hook/transaction boundary | medium | architecture | technical | Named `ieeFinalise()` in `_ieeShared.ts` as the insertion point in §12.1 and §7 modified files table; noted transaction-boundary requirement and fallback documentation obligation. |
| F9 | `current_setting` single-arg form can throw when GUC unset | low | improvement | technical | Updated §8.5 and §9 to use `current_setting('app.organisation_id', true)::uuid` (two-argument safe form, fails closed). |
| F10 | §16 title contradicts its content | low | style | technical | Renamed §16 heading and ToC entry to "Resolved decisions and plan constraints"; added clarifying note that items are plan-time constraints. |

### Round 1 outcome

All 10 findings were technical. All 10 applied automatically. Spec updated at `docs/superpowers/specs/2026-05-18-browser-vision-grounding-spec.md`.

**Status after Round 1 fixes:** awaiting operator decision — run another ChatGPT round, or close session.
