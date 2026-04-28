# PR review — dev-mission-control (Phase 1+2+3)

**Reviewed at:** 2026-04-28T13:05:00Z
**Verdict:** APPROVED

## 1. Reviewed files

- `scripts/chatgpt-review.ts`
- `scripts/chatgpt-reviewPure.ts`
- `scripts/__tests__/chatgpt-reviewPure.test.ts`
- `tools/mission-control/server/index.ts`
- `tools/mission-control/server/lib/config.ts`
- `tools/mission-control/server/lib/github.ts`
- `tools/mission-control/server/lib/inFlight.ts`
- `tools/mission-control/server/lib/logParsers.ts`
- `tools/mission-control/server/__tests__/logParsers.test.ts`
- `tools/mission-control/client/src/App.tsx`
- `tools/mission-control/client/src/components/InFlightCard.tsx`
- `tools/mission-control/client/src/lib/api.ts`
- `tools/mission-control/client/src/main.tsx`
- `tools/mission-control/{package.json, tsconfig.json, vite.config.ts, tailwind.config.js, postcss.config.js, .env.example, README.md}`
- `.claude/agents/chatgpt-pr-review.md`
- `.claude/agents/chatgpt-spec-review.md`
- `tasks/current-focus.md`
- `tasks/review-logs/README.md`

## 2. Architecture invariant verification

| Invariant | Result | Evidence |
|---|---|---|
| A1 — CLI uses raw fetch, no `server/services/providers/` import | PASS | `scripts/chatgpt-review.ts:141` calls `fetch(OPENAI_ENDPOINT, ...)` directly; only imports are `node:fs`, `node:child_process`, and local pure helpers |
| A2 — Dashboard server is read-only | PASS | `server/index.ts` registers only `app.get(...)` for `/api/health`, `/api/in-flight`, `/api/builds`, `/api/current-focus`, `/api/review-logs`; no body parsers, no POST/PUT/PATCH/DELETE |
| A3 — `tools/mission-control/` is portable | PASS | No imports from `shared/` or `server/` (root-level) anywhere under `tools/mission-control/`; own `package.json`, own `tsconfig.json`, own `vite.config.ts`; paths driven by `MISSION_CONTROL_REPO_ROOT` |
| A4 — CLI stdout-only, agent owns logs | PASS | `scripts/chatgpt-review.ts` uses `process.stdout.write` for the JSON result and `process.stderr.write` for diagnostics; no `fs.write*` calls; agent definitions retain the full session-log / triage / KNOWLEDGE.md flow |

## 3. Blocking Issues

None.

This is dev-tooling code (no RLS, no schema, no app routes/services). The Automation OS conventions in `pr-reviewer.md` (asyncHandler, resolveSubaccount, organisationId scoping, soft-delete filters, three-tier agent model, etc.) do not apply to `tools/mission-control/` or `scripts/chatgpt-review*.ts`. The relevant invariants the spec pins (A1–A4 above) hold cleanly.

## 4. Strong Recommendations

### S1 — CLI hangs when invoked with no piped stdin and no `--file`

`scripts/chatgpt-review.ts:106-116` (`readStdin`) attaches `'data'`/`'end'` listeners and resolves on `'end'`. When the process is started in a TTY with no piped input, `'end'` never fires until Ctrl-D, so the CLI silently hangs. The downstream agents always pipe a diff or pass `--file`, so this is a footgun for direct shell users rather than the agent flow.

**Fix:** add `if (process.stdin.isTTY) { return ''; }` at the top of `readStdin`. The existing `if (!input.trim())` branch in `main()` then prints the usage error and exits 2 cleanly.

### S2 — `phase` resolution skips the middle step from spec § C4

Spec § C4 pins the resolution order as **machine block status → derived from latest review verdict → `BUILDING` default**. `inFlight.ts:141` collapses this to two steps. So a build with a `latest_review` verdict `APPROVED` (which would map to `MERGE_READY`) that is NOT the active focus build always shows `BUILDING`.

**Fix:** add the verdict→phase derivation step in `inFlight.ts` between the active-focus check and the default — APPROVED/READY_FOR_BUILD → MERGE_READY; CHANGES_REQUESTED/NEEDS_REVISION/NEEDS_DISCUSSION → REVIEWING.

### S3 — `deriveCiStatus` silently maps `action_required` and `stale` to `'unknown'`

`tools/mission-control/server/lib/github.ts:145-157`. The function explicitly handles `failure | timed_out | cancelled` (→ `failing`) and `success | neutral | skipped` (→ `passing`), then falls through to `'unknown'`. GitHub's `conclusion` enum also includes `action_required` and `stale`. Both are real states for branches with required reviewers / outdated runs and would silently render as a grey dot.

**Fix:** treat `action_required` as `failing` (it is a CI gate the operator must address), and `stale` as `pending` (the run is no longer authoritative — re-run pending).

### S4 — Failed GitHub fetches cache `null` for 60s

`fetchPRForBranch` and `fetchCiStatusForBranch` cache `null`/`'unknown'` on every failure path for 60s. A transient 502 from GitHub therefore sticks for 60 seconds, even though the next poll is only 30s away.

**Fix:** keep success-path caching at 60s, but on error cache for a much shorter window (5–10s) so the next poll retries.

## 5. Non-Blocking Improvements

- **N1** — Unused `parseReviewLogFilename` import at `inFlight.ts:14`; only `pickLatestLogForSlug` is called.
- **N2** — Spec-inventory drift: spec lists `chatgpt-review.test.ts` but actual filename is `chatgpt-reviewPure.test.ts`. (Already in `tasks/todo.md` from spec-conformance.) The reviewer's claim that `tsconfig.server.json` is missing is incorrect — the file exists at the spec-named path.
- **N3** — `parseProgressMd` checkbox case-handling is asymmetric: `[x]` regex uses `gi`, `[ ]` regex uses `g`. Markdown convention is lowercase; drop the `i`.
- **N4** — `pickLatestLogForSlug` mutates the meta object in place. If a future caller caches `parseReviewLogFilename` results and then runs `pickLatestLogForSlug`, the cache gets clobbered. Cheap fix: spread into a new object before mutating.
- **N5** — Sequential `await` over builds in `composeInFlight`. Fine for n=3-5; defer until it's actually slow.
- **N6** — Slug prefix-match in `pickLatestLogForSlug` is permissive. Real-world risk is low. Defer until it bites.
- **N7** — Verdict pill colour table covers all current spec-reviewer verdicts. No action needed.
- **N8** — `process.stdin.setEncoding('utf-8')` vs canonical `'utf8'`. Trivial.

## 6. Test coverage

The 23-test pure-helper suite for the CLI and the 19-test pure-parser suite for the dashboard cover every branching case in `chatgpt-reviewPure.ts` and `logParsers.ts`. Boundary code (OpenAI fetch, GitHub fetch, Express routes, React UI) is not unit-tested per spec § 9 testing posture (`runtime_tests: pure_function_only`) — that matches the project's posture for dev-tooling.

## 7. In-session actions taken (post-review fixups)

The main session triaged the four Strong Recommendations and applied the cheap ones in-branch:

- **S1** — applied. Added `process.stdin.isTTY` guard at top of `readStdin`; existing "no input" branch surfaces a clean error message.
- **S2** — applied. Added the missing middle resolution step in `inFlight.ts`: verdict-to-phase mapping (APPROVED/READY_FOR_BUILD/CONFORMANT/CONFORMANT_AFTER_FIXES/PASS/PASS_WITH_DEFERRED → MERGE_READY; CHANGES_REQUESTED/NEEDS_REVISION/NEEDS_DISCUSSION → REVIEWING) when the build is not the active focus.
- **S3** — applied. `deriveCiStatus` now maps `action_required` → `failing`, `stale` → `pending`, with rationale comment.
- **S4** — applied. Error-path cache TTL reduced to 5s; success path retains 60s.
- **N1** — applied. Dropped unused `parseReviewLogFilename` import from `inFlight.ts`.
- **N2** — `tsconfig.server.json` exists at the spec-named path; the reviewer's check missed it. The test-filename drift is already in `tasks/todo.md` from spec-conformance, so no double-routing.
- **N3** — applied. Dropped the `i` flag from the `[x]` regex; markdown convention is lowercase.
- **N4** — applied. `pickLatestLogForSlug` now spreads into a new object before mutating.
- **N5, N6, N7, N8** — deferred or no-action per the review's own guidance.

All 23 + 19 unit tests still pass after the fixups.
