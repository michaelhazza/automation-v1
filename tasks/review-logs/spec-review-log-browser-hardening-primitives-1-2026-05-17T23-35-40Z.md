# Iteration 1 — browser-hardening-primitives spec review

## Codex findings classification

FINDING #1 — humanize default contradiction (off vs null)
  Source: Codex
  Section: §4.3, §5.2, §5.3, §6.2, §20
  Classification: mechanical
  Disposition: auto-apply (canonical: null = off, persisted as JSONB null)

FINDING #2 — humanize per-action/session opt-in not specified
  Source: Codex
  Section: §1, §4.3, §6.2, §15, §19.3
  Classification: mechanical
  Disposition: auto-apply (remove "per-action and session-level opt-in" from §1 since concrete design is workflow-level; clarify session-seed semantics in §15)

FINDING #3 — `--timezone` is not a Chromium launch flag
  Source: Codex
  Section: §4.2, §6.1, §19.2
  Classification: mechanical
  Disposition: auto-apply (remove from launch flags; pin timezoneId, locale, Accept-Language header, --lang, --force-webrtc-ip-handling-policy)

FINDING #4 — DB-wins precedence over sandbox-immutable envelope is ambiguous
  Source: Codex
  Section: §6.4, §8.2, §8.3
  Classification: mechanical
  Disposition: auto-apply (clarify precedence applies pre-dispatch only; retries regenerate envelope; sandbox never reconciles)

FINDING #5 — CI status from harness_run_history without unique key
  Source: Codex
  Section: §6.4, §8.1, §10.1
  Classification: mechanical
  Disposition: auto-apply (CI computes from in-memory result; DB persistence is telemetry-only)

FINDING #6 — Outcome enum vocabulary drift (`partial` not in enum)
  Source: Codex
  Section: §6.3, §10.4, §10.5, §12
  Classification: mechanical
  Disposition: auto-apply (align §10.4 status to use §6.3 outcome enum)

FINDING #7 — Pure test files absent from file inventory
  Source: Codex
  Section: §5.1, §11.1
  Classification: mechanical
  Disposition: auto-apply (add three .test.ts files to §5.1 with phase tags)

FINDING #8 — Proxy settings disclosure component not in §5
  Source: Codex
  Section: §4.2, §15, §20
  Classification: mechanical
  Disposition: auto-apply (add architect-locates placeholder row for proxy settings component)

FINDING #9 — KNOWLEDGE.md doc-sync surface inconsistency
  Source: Codex
  Section: §5.2, §20
  Classification: mechanical
  Disposition: auto-apply (remove KNOWLEDGE.md from §20 surfaces list; it's a session-activity update, not a spec-prescribed file per codebase convention)

FINDING #10 — GeoLite2 concurrent-refresh "identical content" claim is wrong
  Source: Codex
  Section: §8.4, §10.3
  Classification: mechanical
  Disposition: auto-apply (use pg-boss singleton-job semantics; that's an existing primitive)

FINDING #11 — Latency acceptance contradicts no-perf-baselines framing
  Source: Codex
  Section: §10.6, §11.4, §19.3
  Classification: mechanical
  Disposition: auto-apply (mark workflow-level +30% benchmark as manual/non-gating advisory; the gating measurement remains the pure-module per-action p99)

FINDING #12 — Phase 1 "blocks merge" vs rollout "advisory first"
  Source: Codex
  Section: §4.1, §13, §19.1
  Classification: mechanical
  Disposition: auto-apply (clarify Phase 1 acceptance as "blocking-capable, initially advisory; first blocking gate after two consecutive stable nightly runs on the per-PR subset")

## Rubric findings (in addition to Codex)

FINDING #R-1 — `harness_run_history` schema file is new, but listed under §5.2 Modified files
  Source: Rubric-file-inventory-drift
  Section: §5.2
  Classification: mechanical
  Disposition: auto-apply (move row from §5.2 to §5.1)

FINDING #R-2 — humanize pure-module .test.ts placement ambiguous (harness/ subdir vs vitest reach)
  Source: Rubric-load-bearing-claim-without-contract
  Section: §5.1 (new rows from Finding 7), §11.1
  Classification: mechanical
  Disposition: auto-apply (when adding test rows per Finding 7, note that humanizeInputsPure.test.ts lives next to its Pure module in the harness directory and is run via the project vitest config which already covers infra/sandbox-templates per existing template-tests)

FINDING #R-3 — Numeric reconciliation drift after Finding 7 + R-1 land
  Source: Rubric-numeric-count-reconciliation
  Section: §18
  Classification: mechanical
  Disposition: auto-apply (recompute counts after structural fixes; update §18 line "19 new files / 5 modified files" to new totals)

## Mechanical fixes applied

[ACCEPT] §1 humanize Goal — Removed stale "per-action and session-level opt-in" phrasing; replaced with workflow-level opt-in to match concrete design (Finding #2).
[ACCEPT] §1 humanize Goal — Four-bucket policy clarified that "off" = null persisted config (Finding #1 cross-section).
[ACCEPT] §4.2 Phase 2 outputs — `--timezone` removed from launch flags; pinned timezoneId as Playwright context option (Finding #3).
[ACCEPT] §4.3 Phase 3 outputs — Workflow config default changed from `'off'` to `null`; HumanizeProfile narrowed to `'light' | 'balanced' | 'heavy'` (Finding #1).
[ACCEPT] §5.1 — Added three pure-function test files (humanizeInputsPure.test.ts, proxyAlignmentServicePure.test.ts, harnessHistoryWriterPure.test.ts) with phase tags (Finding #7).
[ACCEPT] §5.1 — Moved `server/db/schema/harnessRunHistory.ts` from Modified to New files table (Finding #R-1).
[ACCEPT] §5.2 — Added existing tenant proxy-settings component row (architect-locates) (Finding #8).
[ACCEPT] §5.2 — Reworded harness/index.ts modification to use "non-null" instead of "non-`off`" and pinned newContext options.
[ACCEPT] §5.3 — Migration CHECK constraint rewritten to enforce nullable JSONB with `'light' | 'balanced' | 'heavy'` profile values (Finding #1).
[ACCEPT] §6.2 — HumanizeOptions nullability rewritten: `'off'` removed from non-null shape; explicit "absence = off" framing (Finding #1).
[ACCEPT] §6.4 — DB-precedence clarified as pre-dispatch-layer only; sandbox is immutable transport (Finding #4).
[ACCEPT] §6.4 — Detection harness outcome precedence rewritten: CI status from in-memory result, DB is telemetry-only (Finding #5).
[ACCEPT] §8.1 — runHarness exit-code semantics: from in-memory results, not from DB re-read (Finding #5).
[ACCEPT] §8.3 — humanize execution model uses "non-null" (Finding #1 propagation).
[ACCEPT] §8.4 — GeoLite2 refresh adds pg-boss singleton-key dispatch (Finding #10).
[ACCEPT] §10.1 — harnessHistoryWriter idempotency rewritten: append-only telemetry, non-idempotent intentional, not a CI gate (Finding #5).
[ACCEPT] §10.3 — GeoLite2 concurrent-refresh claim replaced with singleton-key semantics (Finding #10).
[ACCEPT] §10.4 — Terminal event `outcome` payload aligned to §6.3 closed enum, "partial" removed (Finding #6).
[ACCEPT] §15 — Seed semantics rewritten: persisted on workflow row at save time (or pre-dispatch); included in envelope and surfaced on run record (Finding #2).
[ACCEPT] §18 — Numeric reconciliation updated: 23 new files, 10 modified-file rows, 3 profile names (Finding #R-3).
[ACCEPT] §19.1 — Phase 1 acceptance criteria updated: "blocking-capable, initially advisory" framing + DB-best-effort qualifier (Finding #12 + #5).
[ACCEPT] §19.3 — Workflow-level latency acceptance reframed as non-gating advisory per framing; pure-module per-action p99 remains the gating measurement (Finding #11).
[ACCEPT] §20 — KNOWLEDGE.md removed from doc-sync surfaces list per codebase convention (Finding #9).
[ACCEPT] frontmatter Status: draft → reviewing.

## Iteration 1 Summary

- Mechanical findings accepted: 15 (12 Codex + 3 rubric)
- Mechanical findings rejected: 0
- Directional findings: 0
- Ambiguous findings: 0
- Reclassified → directional: 0
- Autonomous decisions (directional/ambiguous): 0
- Spec commit after iteration: pending Step 8b commit

