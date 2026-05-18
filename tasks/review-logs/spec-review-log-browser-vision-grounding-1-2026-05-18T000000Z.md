# Spec Review Log — browser-vision-grounding, iteration 1

**Spec:** `docs/superpowers/specs/2026-05-18-browser-vision-grounding-spec.md`
**Codex findings:** 15
**Rubric-only findings:** 0 (rubric pass agreed with Codex's coverage)

---

## Classifications

### FINDING 1 — V1 success criteria require harness loop but loop is stub
- Source: Codex
- Section: §1 Goals (Goal 8) / §3 / §13 / §14
- Classification: mechanical (contradiction between Goal 8 success criteria and §13 stub deferral)
- Disposition: auto-apply
- Fix applied: split Goal 8 into V1-verifiable criteria and follow-up-build (full wiring) criteria

### FINDING 2 — Hybrid orchestration: §8.3 routes unconditionally; §8.9 says DOM-first
- Source: Codex
- Section: §8.3 / §8.9 / §10
- Classification: mechanical (internal contradiction; §8.9 + §16 Q3 already decided DOM-first hybrid)
- Disposition: auto-apply
- Fix applied: §8.3 clarifies that `visionDecisionLoop` owns DOM-first execution in hybrid mode (the harness still routes to it for `'vision'` or `'hybrid'`)

### FINDING 3 — Resolved `modelId` not threaded through task envelope to harness
- Source: Codex
- Section: §8.2 / §8.4 / §8.6
- Classification: mechanical (contract gap; spec already decided server resolves modelId in §8.6)
- Disposition: auto-apply
- Fix applied: add `visionModelId?: string | null` to `SandboxRunTaskInput` and `HarnessInput`

### FINDING 4 — `rlsProtectedTables.ts` listed in both New and Modified; "10 new files" is 9
- Source: Codex
- Section: §7 New files (10) table
- Classification: mechanical (file inventory drift + numeric mismatch)
- Disposition: auto-apply
- Fix applied: remove rlsProtectedTables row from "New files"; relabel header to "New files (9)"; update §14 reconciliation to "9 new files + 8 modified files = 17 file entries"

### FINDING 5 — Skill YAML reader file not in inventory
- Source: Codex
- Section: §7 Modified files / §8.9
- Classification: mechanical (file inventory drift; existing parser is `server/services/skillParserServicePure.ts`)
- Disposition: auto-apply
- Fix applied: add `server/services/skillParserServicePure.ts` to "Modified files" and to chunk list

### FINDING 6 — Harvest invocation site not named
- Source: Codex
- Section: §10 / §7
- Classification: mechanical (file inventory + execution-model clarity)
- Disposition: auto-apply
- Fix applied: state in §10 that `_ieeShared.ts` (already in modified list) gets BOTH dispatch and terminal-harvest hook modifications

### FINDING 7 — `vision_inference_not_configured` timing contradiction (dispatch vs first-call)
- Source: Codex
- Section: §8.8 / §12.5 vs §16
- Classification: mechanical (contradiction; spec decided in §8.8/§12.5 that dispatch fails; §16 has stale "at first vision call" residue)
- Disposition: auto-apply
- Fix applied: update §16 item 11 to align with §8.8/§12.5

### FINDING 8 — §12.2 vs §13 retry-policy contradiction
- Source: Codex
- Section: §12.2 / §13
- Classification: mechanical (contradiction; §13 says no retry on vLLM for non-idempotent actions; §12.2 says retry-at-most-once)
- Disposition: auto-apply
- Fix applied: align §12.2 with §13 V1 posture (no retry on non-idempotent action vLLM calls; smarter retry deferred)

### FINDING 9 — `runCostBreaker` cannot enforce per-run ceilings on vision costs in V1
- Source: Codex
- Section: §1 Goal 6 / §3 / §10
- Classification: mechanical (load-bearing claim without mechanism; framing assumption claim contradicts async-rollup execution model)
- Disposition: auto-apply
- Fix applied: weaken §1 Goal 6 + §3 final assumption to "post-run accounting"; add mid-run breaker enforcement to §13 Deferred Items

### FINDING 10 — Harvest crash window between terminal status write and harvest completion
- Source: Codex
- Section: §12.1 / §12.3
- Classification: mechanical (contract pin — the spec already commits to single-writer; ordering needs to be explicit)
- Disposition: auto-apply
- Fix applied: pin ordering in §12.1 — harvest runs BEFORE terminal status is written; harvest failure prevents terminal write; retry re-attempts while status is still `running`

### FINDING 11 — Network allowlist composition vs browser navigation
- Source: Codex
- Section: §8.7
- Classification: mechanical (contract clarification)
- Disposition: auto-apply
- Fix applied: add a sentence noting the vision allowlist is additive to whatever browser navigation policy lands (IEE-DEF-7 dependency)

### FINDING 12 — Allowlist hard-codes 443/https but config doesn't constrain endpoint to HTTPS
- Source: Codex
- Section: §8.6 / §8.7
- Classification: mechanical (contract pin)
- Disposition: auto-apply
- Fix applied: §8.6 requires HTTPS endpoint URL; §8.7 parses host:port from URL rather than hard-coding 443

### FINDING 13 — `costCents` formula not pinned
- Source: Codex
- Section: §8.4
- Classification: AUTO-DECIDED → auto-apply (mechanical placeholder)
- Disposition: auto-apply with deferred-formula pin
- Fix applied: §8.4 pins formula source location (`server/config/visionInferencePricing.ts`); exact rate constants set at architect-plan time once vendor selected

### FINDING 14 — No explicit Verdict column in chunk table
- Source: Codex
- Section: §6
- Classification: mechanical (missing per-item verdict — rubric category)
- Disposition: auto-apply
- Fix applied: add `Verdict` column to §6 chunk table; all 10 chunks marked `BUILD`

### FINDING 15 — Parser input grammar not pinned
- Source: Codex
- Section: §8.1 / §15
- Classification: AUTO-DECIDED → auto-apply (mechanical reference-link approach)
- Disposition: auto-apply
- Fix applied: §8.1 names the UI-TARS published action grammar as the input contract; parser test file authors the worked input→output pairs

---

## Iteration counts

- Mechanical findings accepted:  15
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions:          2 (Findings 13, 15 — both auto-apply with mechanical placeholder approach)
  - AUTO-REJECT (framing):       0
  - AUTO-REJECT (convention):    0
  - AUTO-ACCEPT (convention):    0
  - AUTO-DECIDED:                2 (auto-applied; also noted in tasks/todo.md for human visibility)

---

## Iteration 1 Summary

- Mechanical findings accepted:  15
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0
  - AUTO-REJECT (framing):    0
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED:             0
- Spec commit after iteration:   (committed as part of iteration 1 — see git log)
