# ChatGPT Spec Review Session — lint-typecheck-post-merge-spec — 2026-05-01T02-26-36Z

## Session Info
- Spec: docs/superpowers/specs/2026-05-01-lint-typecheck-post-merge-spec.md
- Branch: lint-typecheck-post-merge-tasks
- PR: none (user declined PR creation)
- Mode: manual
- Started: 2026-05-01T02:26:36Z

---

## Round 1 — 2026-05-01T02:38:00Z

### ChatGPT Feedback (raw)
Executive summary: strong, execution-ready spec. Deterministic, scoped, clear success criteria. Key improvements: tighten Task 2→3 boundary, fail-fast rule for unexpected TS error codes, lint step ordering (no-undef first), ESLint config verification, exhaustiveness guard nuance, CI trigger edge case (converted_to_draft), concurrency guard for CI, verification script existence check, destructuring note for no-unused-vars, Task 4.2 clarity, Task 5.5 option preference, Task 6 CI policy intent. Verdict: CHANGES_REQUESTED (ready to execute with minor adjustments).

### Recommendations and Decisions

| # | Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---|---------|--------|----------------|----------------|----------|-----------|
| F1 | Hard gate before Task 3 — prod typecheck must be 0 | technical | apply | auto (apply) | high | Task 2.4 implies it but doesn't make it a stop condition; real sequencing gap |
| F2 | Fail-fast rule if unexpected TS error codes in Task 3 | technical | apply | auto (apply) | medium | Prevents `!` masking real type mismatches beyond TS18047/48/2722 |
| F3 | 3-`!` threshold per test case | technical | reject | auto (reject) | low | Arbitrary threshold; spec already says "do not add runtime if guards" — sufficient |
| F4 | Reorder lint: execute §4.2 before §4.1 | technical | apply | auto (apply) | medium | 125 no-undef errors pollute auto-fix output; fixing root cause first is cleaner |
| F5 | ESLint config verification command in Task 4.2 | technical | apply | auto (apply) | medium | Config placement is fragile; `--print-config` confirms it actually took effect |
| F6 | Verify `never` guard by temporarily removing a case | technical | reject | auto (reject) | low | Standard TS pattern; spec already says "run typecheck to confirm" — overkill |
| F7 | Add `converted_to_draft` to CI trigger events | technical | reject | auto (reject) | low | Wrong lifecycle direction — fires when PR goes backward, not forward to merge |
| F8 | Add concurrency guard to CI job | technical | defer | defer | low | Valid CI optimization but out of scope for this spec; routes to tasks/todo.md |
| F9 | Script existence check in Verification section | technical | reject | auto (reject) | low | Already covered in Task 1 pre-flight ("should not exit with 'missing script'") |
| F10 | Destructuring note for `no-unused-vars` Task 4.4 | technical | apply | auto (apply) | low | Valid nuance: prefer removing field over `_` prefix for destructuring |
| F11 | Task 4.2 clarify `no-undef` suppression is permanent | technical | apply | auto (apply) | low | Prevents future sessions treating it as temporary cleanup |
| F12 | Task 5.5 prefer Option A (wire in) over Option B | technical | apply | auto (apply) | medium | Silent field removal risks behavioral regression; spec should reflect safer default |
| F13 | Task 6 clarify CI failure = PR blocked (policy intent) | technical | apply | auto (apply) | low | Scope boundary note correct but doesn't state the intent clearly |

### Applied
- [auto] F1: Added hard pre-condition (stop if prod typecheck non-zero) to Task 3
- [auto] F2: Added fail-fast rule for unexpected TS error codes to Task 3
- [auto] F4: Added §4.2-before-§4.1 execution order note to Task 4 intro
- [auto] F5: Added `--print-config` verification step to Task 4.2
- [auto] F10: Added destructuring preference note to Task 4.4
- [auto] F11: Added "intentional and permanent" clause to Task 4.2 root-cause explanation
- [auto] F12: Added Option A preference guidance to Task 5.5
- [auto] F13: Added CI policy intent sentence to Task 6 scope boundary
- [user] F8: deferred — routed to tasks/todo.md § Spec Review deferred items / lint-typecheck-post-merge-spec

Top themes: sequencing enforcement (F1/F4), fail-fast discipline (F2), config verification (F5), silent regression prevention (F12).

