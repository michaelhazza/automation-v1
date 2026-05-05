# Spec Review — Iteration 3

**Spec:** `docs/superpowers/specs/2026-04-29-pre-prod-boundary-and-brief-api-spec.md`
**Iteration:** 3 of 5
**Timestamp:** 2026-04-29T02-53-41Z
**Branch HEAD at start:** `a39a6226` (iter2 commit)
**Spec-context commit:** `03cf81883b6c420567c30cfc509760020d325949`

---

## Findings (Codex output)

Codex returned 16 findings.

### i3-F1 — Cleanup-job pg-boss vs setInterval undecided (third re-flag)
- Section: §5; §6.2.4; §11
- Classification: rejected-mechanical (intentional architect-deferral per the user's invocation note)
- Disposition: REJECT (third re-flag of iter1 F7 / iter2 F3)
- Reason: as before, this is one of the architect-call items the user listed as intentional deferrals.

### i3-F2 — Sliding-window weighted vs fixed-window undecided
- Section: §6.2.3
- Classification: rejected-mechanical (intentional architect-deferral per the user's invocation note)
- Disposition: REJECT
- Reason: per the user's invocation note, "sliding-window weighted vs fixed" is one of the architect-call items intentionally deferred. The spec already names "weighted" as the default recommendation; the architect agent will record the final verdict during plan breakdown.

### i3-F3 — `resetAt` formula not defined precisely
- Section: §7.1
- Classification: mechanical (load-bearing claim without backing mechanism)
- Disposition: ACCEPT
- Fix: §7.1 `RateLimitCheckResult.resetAt` JSDoc now carries the exact formula — `new Date((window_start_seconds + windowSec) * 1000)` where `window_start_seconds = Math.floor(Date.now() / 1000 / windowSec) * windowSec`. The `Retry-After` derivation is also pinned: `Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000))` — `Math.ceil` rounds up so the caller never re-fires inside the same window; `Math.max(1, …)` clamps a non-positive header.

### i3-F4 — `remaining` field calculation not defined
- Section: §7.1
- Classification: mechanical (contract gap)
- Disposition: ACCEPT
- Fix: §7.1 `RateLimitCheckResult.remaining` JSDoc now reads "Computed as `Math.max(0, Math.floor(limit - effectiveCount))`. Always clamped at 0 (so a denied call returns `0`, not a negative number)."

### i3-F5 — SQL CTE pseudo-parameters
- Section: §6.2.3
- Classification: mechanical (pseudocode ambiguity)
- Disposition: ACCEPT
- Fix: rewrote the CTE with positional bind parameters `$1` (key), `$2` (current_window_start), `$3` (previous_window_start), and added a leading comment naming each.

### i3-F6 — Login limiter pre-validation key uses email (third re-flag of iter1 F13)
- Section: §6.2.5; §8
- Classification: directional re-flag (already AUTO-DECIDED in iter1)
- Disposition: REJECT-as-duplicate
- Reason: the entry remains in `tasks/todo.md` § Deferred from spec-reviewer review for the human/architect to resolve.

### i3-F7 — `package.json` reference doesn't match the repo layout
- Section: §5; §6.2.5
- Classification: mechanical (file-inventory drift — the repo has root `package.json` only, not `server/package.json`, and root `package.json` does not list `express-rate-limit` directly)
- Disposition: ACCEPT
- Fix: §5 inventory row rewritten — root `package.json` + `package-lock.json` are listed, with the note that the import resolves via a transitive dependency, so no `dependencies` change is required; only the `package-lock.json` regenerates on next `npm install`. §6.2.5 deletion list updated to describe the import removal accurately ("at `server/routes/auth.ts:2`; the package itself is reached via a transitive dependency in root `package-lock.json`").

### i3-F8 — `BriefCreationEnvelope` producer list omits Path B
- Section: §6.4.2; §7.4
- Classification: mechanical (inventory drift — Phase 4 covers all `brief_created` arms but the §7.4 Producer line only mentioned Path A and Path C)
- Disposition: ACCEPT
- Fix: §7.4 Producer line rewritten to enumerate Path A (`pendingRemainder`), Path B (decisive command), and Path C (plain submission).

### i3-F9 — `BriefCreationEnvelope` example uses wrong `FastPathDecision` shape
- Section: §7.4
- Classification: mechanical (terminology drift — the example used `{ kind, confidence, reason }` but `shared/types/briefFastPath.ts:16` defines `FastPathDecision` as `{ route, scope, confidence, tier, secondLookTriggered, keywords?, reasoning? }`)
- Disposition: ACCEPT
- Fix: example JSON `fastPathDecision` rewritten to match the real type — `{ "route": "needs_orchestrator", "scope": "subaccount", "confidence": 0.74, "tier": 1, "secondLookTriggered": false, "keywords": ["follow-up", "schedule"], "reasoning": "multi-step coordination" }`.

### i3-F10 — `/api/session/message` rate-limit key shape and limit undecided
- Section: §6.6.1
- Classification: rejected-mechanical (intentional architect-deferral per the user's invocation note — "key shape per-user vs per-user+org" is on the deferral list; the limit value (30/min) is also a soft default)
- Disposition: REJECT
- Reason: the user's invocation note explicitly lists "key shape per-user vs per-user+org" as an intentional architect-call. The default recommendation is in the spec; the architect agent records the final verdict during plan breakdown.

### i3-F11 — Webhook fallback cardinality undecided (warn-once-per-process vs warn-once-per-secret-rotation)
- Section: §5; §6.3.2; §7.3
- Classification: rejected-mechanical (intentional architect-deferral per the user's invocation note)
- Disposition: REJECT
- Reason: "warn-once-per-process vs warn-once-per-secret" is on the user's deferral list. The default (warn-once-per-process) is in the spec; the architect records the final verdict.

### i3-F12 — Reseed `NODE_ENV` vs `DATABASE_URL` host-pattern check undecided
- Section: §6.7.1; §14
- Classification: mechanical (architect-call hedge for a verdict the spec already commits to)
- Disposition: ACCEPT
- Reasoning: NOT on the user's explicit deferral list. The spec already says "Default recommendation: `NODE_ENV` only" — so the verdict is already there. The hedge is just clutter.
- Fix: §6.7.1 closing paragraph rewritten — "The verdict is `NODE_ENV` only. A host-pattern check on `DATABASE_URL` would need to maintain a list of 'known production hosts' — the single-source guard is cleaner and the operator-error mode 'I forgot to set NODE_ENV=development' is the realistic failure."

### i3-F13 — Tempfile cleanup async vs synchronous wording
- Section: §6.1; §9
- Classification: mechanical (terminology drift — `res.on('close')` listener fires synchronously, but the `fs.unlink` call inside is async fire-and-forget; saying the operation is "synchronous on `res.on('close')`" was misleading)
- Disposition: ACCEPT
- Fix: §9 row rewritten — "`res.on('close')` listener fires synchronously; the listener calls `fs.unlink` (async, fire-and-forget — errors logged at debug, not awaited)."

### i3-F14 — Tempfile cleanup doesn't iterate over all `req.files`
- Section: §6.1; §5
- Classification: mechanical (load-bearing implementation detail not pinned — `upload.any()` produces an array of files, not a single one)
- Disposition: ACCEPT
- Fix: §6.1 cleanup-hook code block now shows the explicit iteration over `(req.files as Express.Multer.File[]) ?? []` with per-file `fs.unlink`. `ENOENT` treated as success (file already cleaned by the consuming route).

### i3-F15 — T5 claim about "Phase 5 service guard isn't shadowed" misleading
- Section: §6.6.2 T5 row; §12
- Classification: mechanical (test plan vs verification surface drift — T5 is route-level, doesn't exercise the service guard)
- Disposition: ACCEPT
- Fix: T5 description rewritten — "T5 covers the route-level path; the Phase 5 service-level guard (`shouldSearchEntityHint`) is verified separately by the pure-unit test in §12."

### i3-F16 — Modal `fastPathDecision` "Architect to confirm" still hedged despite default
- Section: §6.4.3
- Classification: mechanical (architect-call hedge for a verdict the spec already commits to)
- Disposition: ACCEPT
- Reasoning: NOT on the user's explicit deferral list. The default recommendation ("don't act on it in the modal; the import is type-only") is already the verdict.
- Fix: §6.4.3 first bullet rewritten — "the modal does NOT act on it — the modal navigates straight to the brief detail page, where the brief page consumes `fastPathDecision`. The import in `Layout.tsx` is type-only."

### i3-F17 — Mojibake throughout the spec (Codex hallucination)
- Section: claimed "throughout"
- Classification: rejected (Codex false positive — the spec file is valid UTF-8; `file` reports "Unicode text, UTF-8 text"; the em-dashes hex-decode as `e2 80 94`. The mojibake Codex saw is a terminal-codec artifact in its own preview output, not in the file)
- Disposition: REJECT
- Reason: the spec on disk is fine. Codex is misreading its own terminal preview where the Codex CLI emitted UTF-8 through a non-UTF-8 stream.

---

## Rubric findings

No new rubric findings beyond Codex's set. Codex caught the cleanup-iteration / `req.files` shape bug (i3-F14), the SQL pseudo-param bug (i3-F5), the wrong `FastPathDecision` example (i3-F9), and the missing `resetAt` formula (i3-F3) — all four would have surfaced as rubric findings if Codex had missed them.

---

## Iteration 3 Summary

- Mechanical findings accepted:  11 (i3-F3, i3-F4, i3-F5, i3-F7, i3-F8, i3-F9, i3-F12, i3-F13, i3-F14, i3-F15, i3-F16) = **11 mechanical fixes applied**
- Mechanical findings rejected:   6 (i3-F1, i3-F2, i3-F10, i3-F11 architect-deferrals; i3-F6 already AUTO-DECIDED in iter1; i3-F17 Codex hallucination)
- Directional findings:           0 NEW
- Ambiguous findings:             0
- Reclassified → directional:     0
- Autonomous decisions (directional/ambiguous): 0
- Spec commit after iteration:   pending — committed at end of Step 8b

**Stopping heuristic check:** N=3, mechanical_accepted=11, mechanical_rejected=6, directional=0 NEW. Iteration 3 produced ZERO new directional findings. Iteration 2 also produced zero new directional findings. **Two consecutive mechanical-only rounds → STOP**. The loop exits; no iteration 4 will run.
