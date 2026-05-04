# ChatGPT PR Review Session — framework-standalone-repo — 2026-05-04T07-05-51Z

## Session Info
- Branch: claude/framework-standalone-repo
- PR: #257 — https://github.com/michaelhazza/automation-v1/pull/257
- Mode: manual
- Started: 2026-05-04T07:05:51Z
- Phase: invoked from `finalisation-coordinator` (Phase 3 of three-coordinator pipeline)
- Spec deviations (from `handoff-phase2.md`):
  1. `sync.js` is JS-with-JSDoc (~1413 lines), not "TypeScript ~300 lines." Plan §1.1: no build step in framework repo.
  2. `lastSubstitutionHash` is an additive optional field on FrameworkState (plan §1.11) for substitution-drift invariant; forward-migrates pre-2.2.0 state.json transparently.
- REVIEW_GAP: `dual-reviewer` skipped in Phase 2 (Codex CLI unavailable). This `chatgpt-pr-review` pass is the primary second-opinion review.

---

## Round 1 — 2026-05-04

**Note:** the operator's first attempt to upload the diff to ChatGPT-web returned a generic production-readiness checklist with no specific findings (ChatGPT explicitly asked to be sent the code). That round was treated as a no-op; the operator re-uploaded with a more direct prompt naming the primary file under review.

### ChatGPT verdict

> Not merge-ready yet. Main shape looks good, but I'd fix these before merge.

Verdict text: 5 findings (F1–F5). Operator pasted the response in-session.

### Findings + triage

| # | Finding | Triage | Action |
|---|---|---|---|
| F1 | Version drift: root `.claude/FRAMEWORK_VERSION` 2.1.0 vs `setup/portable/.claude/FRAMEWORK_VERSION` 2.2.0 | **partial accept** | Drift is intentional design (root reflects what is deployed in this repo; portable reflects what the bundle ships to consuming repos; root catches up at Phase C self-adoption). Fix: documentation, not version bump. Added a "Root vs portable bundle versioning" section to `.claude/CHANGELOG.md` explaining the separation. |
| F2 | `AutomationOS` (no-space variant) leaks past forbidden-string scanner | **accept** | Confirmed: `setup/portable/.claude/agents/audit-runner.md` lines 30 and 83 contain `AutomationOS`, scanner only catches `Automation OS` (with space). Replaced both occurrences with `{{PROJECT_NAME}}` placeholder; added `AutomationOS` to `FORBIDDEN_STRINGS` in `scripts/build-portable-framework.ts`. |
| F3 | Root changelog has no 2.2.0 entry | **partial accept** | Combined with F1 — same intentional separation. Same single fix (clarifying note in root CHANGELOG.md). |
| F4 | Portable tests not wired into root CI/package scripts | **accept** | Confirmed: vitest config includes `**/__tests__/**/*.test.ts` only (portable tests are in `setup/portable/tests/`); CI workflow has no portable test invocation; no `test:portable-framework` script in `package.json`. Added script `"test:portable-framework": "node --import tsx --test setup/portable/tests/*.test.ts"`. Verified: 113/113 tests pass via `npm run test:portable-framework`. CI integration is a follow-up consideration, deferred. |
| F5 | `build-portable-framework.ts` shells out to `zip` on POSIX without preflight | **accept** | Confirmed at line 178. Added `assertZipBinaryAvailable()` preflight before the spawn — clear error with installation hints (`apt-get install -y zip`, `apk add zip`, `brew install zip`) instead of cryptic ENOENT in minimal containers. |

### Verification

- `npm run lint -- scripts/build-portable-framework.ts` — 0 errors (726 pre-existing warnings unchanged).
- `npm run typecheck` — clean (both root and server tsconfigs).
- `npm run test:portable-framework` — 113 tests, 113 pass, 0 fail, duration 13.5s.

### Round 1 verdict

5/5 findings substantive (none rejected as misread). 3 fully accepted (F2, F4, F5), 2 accepted as documentation-only fixes (F1, F3 combined). Zero items deferred to `tasks/todo.md`. ChatGPT's review surfaced real gaps that pr-reviewer and adversarial-reviewer missed — F4 (test discoverability) and F5 (build robustness in minimal containers) are the kind of "is this actually shippable in CI" concerns that are out of scope for diff-only reviewers.

### Files changed in Round 1

- `.claude/CHANGELOG.md` — added "Root vs portable bundle versioning" subsection (F1+F3).
- `setup/portable/.claude/agents/audit-runner.md` — replaced `AutomationOS` × 2 with `{{PROJECT_NAME}}` (F2).
- `scripts/build-portable-framework.ts` — added `AutomationOS` to FORBIDDEN_STRINGS (F2); added `assertZipBinaryAvailable()` preflight on POSIX (F5).
- `package.json` — added `test:portable-framework` script (F4). HITL-approved by operator before edit.

---
