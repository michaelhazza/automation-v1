# Spec Review Log — mcp-vendor-server-onboarding — Iteration 1

**Spec:** `docs/superpowers/specs/2026-05-19-mcp-vendor-server-onboarding-spec.md`
**Timestamp:** 2026-05-19T08:47:01
**Codex output:** `tasks/review-logs/codex-iter1-raw-20260519T084701.txt` (2268 lines)
**Codex findings:** 12 (4 critical, 7 important, 1 minor)
**Rubric findings:** 4 (3 actionable, 1 dropped on re-classification)

---

## Codex findings

### FINDING #1 — critical — §17.1 / §22.7
- Description: `mcpServerConfigs.ts` listed "no change" but §22.7 extends `status` with `quarantined`; current `$type` union only allows `active | disabled | error`.
- Classification: mechanical (real contradiction).
- Disposition: ACCEPT.
- Fix applied: §17.1 row changed to `modify` with `$type` union extension; §17.7 explicit-NOT-touched list updated; §24 numeric-count reconciliation row updated.

### FINDING #2 — critical — §7 / §17.1 / §17.6
- Description: Phase A "replaces 5 placeholder presets with real vendor entries", Phase B says vendors onboarded one at a time.
- Classification: mechanical.
- Disposition: ACCEPT.
- Fix applied: §17.1 row pinned to interface extension only; vendor preset replacement moved to Phase B (§17.6 unchanged, already correct).

### FINDING #3 — critical — §8 / §9.6 / §23
- Description: §8 says subprocess trust is "equivalent to e2b" while §9.6 / §23 / §27 explicitly defer e2b.
- Classification: mechanical.
- Disposition: ACCEPT.
- Fix applied: §8 trust-boundary row rewritten ("process-level only; e2b NOT used"); §9.6 sandbox-relationship bullet rewritten; §6 framing assumption clarified.

### FINDING #4 — critical — §9.6 / §17
- Description: Load-bearing security controls (process-level allowlist, path restriction) named without concrete mechanism.
- Classification: mechanical (rubric: load-bearing claim without enforcement mechanism).
- Disposition: ACCEPT.
- Fix applied: §9.6 filesystem and network-egress bullets now name the Node primitives (`child_process.spawn` + `cwd` + `fs.mkdtemp`, `HTTPS_PROXY` env-var injection toward per-org egress proxy); new file `server/lib/mcpSubprocessSpawner.ts` added to §17.1 inventory; `mcpClientManager.ts` row updated to route stdio spawns through the spawner.

### FINDING #5 — important — §9.5 / §18.6
- Description: Tool schema source-of-truth omits the existing `discoveredToolsJson` cache column.
- Classification: mechanical.
- Disposition: ACCEPT.
- Fix applied: §9.5 now states the existing `discoveredToolsJson` + `discoveredToolsHash` columns are written through and act as the persisted snapshot; §18.6 row expanded to include all three sources with explicit precedence.

### FINDING #6 — important — §11.1 / §18.1 / §18.6
- Description: `riskTierMapping` described inconsistently — preset declares, default, action-registry-subordinate.
- Classification: mechanical.
- Disposition: ACCEPT.
- Fix applied: §11.1 last sentence rewritten — action-registry is the single enforcing source; `riskTierMapping` is the static-gate expectation; precedence pinned.

### FINDING #7 — important — §11.2 / §17.3 / §18.4
- Description: `verify-mcp-allowlist-coverage.sh` only checks non-empty `allowedTools`, not action-registry coverage.
- Classification: mechanical.
- Disposition: ACCEPT.
- Fix applied: §17.3 gate row extended — gate must verify every `allowedTools` entry resolves to an action-registry entry AND Risk Tier matches; §26 risk row updated to reflect the new gate semantics.

### FINDING #8 — important — §10 / §13
- Description: Five vendors declared eligible without per-vendor verdicts against §13 criteria.
- Classification: mechanical.
- Disposition: ACCEPT.
- Fix applied: Added new §13.1 "Phase B vendor compatibility verdicts" matrix; `unknown` rows treated as blockers until ADR resolves; TOC entry added.

### FINDING #9 — important — §18.4 / §9.7 / §10.3 / §16.4
- Description: Audit-event naming drift (underscore vs dot forms); §16.4 filter references non-existent `source` field.
- Classification: mechanical.
- Disposition: ACCEPT.
- Fix applied: Standardised on the dotted taxonomy (matches §18.4 typed declaration). Updated occurrences at lines 109 (now `mcp.capability.shadowed`), 216 (`mcp.server.unavailable`), 245 (`mcp.schema.drift`), 328 (`mcp.capability.shadowed`), 349 (`mcp.tool.unregistered`), 401 (`mcp.schema.drift`), 404 (`mcp.tool.disallowed`), 625 (`mcp.server.unavailable`), 687 (`mcp.risk.tier.drift`), 836 (`mcp.capability.shadowed`), 897 (`mcp.tool.unregistered`), 910 (`mcp.capability.shadowed`). §16.4 filter rewritten to use `eventType IN (...) AND routingDecision = ...`; pre-filtered URL example updated. `mcp.risk.tier.drift` added to §18.4 union (was missing — referenced only in §18.6); §24 audit-event count updated 7 → 8.

### FINDING #10 — important — §17.1
- Description: Vendor-error classifier responsibility duplicated between `mcpClientManagerPure.ts` and `mcpVendorErrorClassifier.ts`.
- Classification: mechanical.
- Disposition: ACCEPT.
- Fix applied: §17.1 row for `mcpClientManagerPure.ts` revised — classifier responsibility removed; `mcpVendorErrorClassifier.ts` is the single source, consumed by the pure module.

### FINDING #11 — important — §22.3 / §17
- Description: Per-node and per-org semaphores declared as invariants without named implementation location.
- Classification: mechanical.
- Disposition: ACCEPT.
- Fix applied: §22.3 ceilings now pinned to `mcpSubprocessSpawner` (file added in finding #4). Same fix; covered by #4's inventory addition.

### FINDING #12 — minor — §9.4 / §13
- Description: §9.4 "npm registry only" but `MCP_ALLOWED_COMMANDS` still includes uvx/python3/docker.
- Classification: mechanical.
- Disposition: ACCEPT.
- Fix applied: §9.4 clarified — Phase B presets MUST use `command` in `{npx, node}`; `verify-mcp-version-pin.sh` (§17.3) row updated to enforce; runtime list unchanged for future extensibility.

---

## Rubric findings

### FINDING R1 — important — §9.5 / §18.4 / §18.6
- Description: §9.5 says "snapshot persisted per-invocation"; §18.4 stores `policyEnvelopeJsonHash` only; §18.6 says "run-start snapshot only".
- Classification: mechanical (source-of-truth contradiction).
- Disposition: ACCEPT.
- Fix applied: §9.5 PolicyEnvelopeResolver-integration paragraph rewritten — hash-only per invocation; full snapshot lives once at `agent_runs.policyEnvelopeJson`.

### FINDING R2 — important — §18.2 / §18.4 / §10.1
- Description: `credentialCascadeResult` includes `'shared-system-key'` in §18.4 but §18.2 cascade function returns subaccount/org/null only.
- Classification: mechanical.
- Disposition: ACCEPT.
- Fix applied: §18.2 table extended with the `shared-read-only-infrastructure` short-circuit row and a `credentialCascadeResult` column; §9.3 cascade-semantics table extended with the same; §17.1 `credentialBrokerServicePure.ts` row pinned to a concrete function signature including `policyClass`; §24 cascade-cases count updated 5/4 → 6/5.

### FINDING R3 — minor — §17.1
- Description: "Extends existing pure module if present; new module otherwise" — ambiguous. The file exists.
- Classification: mechanical.
- Disposition: ACCEPT.
- Fix applied: §17.1 row simplified to "Extend the existing pure module with `selectMcpCredential(...)`".

### FINDING R4 — (dropped)
- Description: §7 feature-flag mention vs §14 behaviour-mode framing.
- Classification: not a finding on re-read; spec already self-justifies in §14.
- Disposition: DROP (not raised).

---

## Iteration 1 Summary

- Mechanical findings accepted:  15 (12 Codex + 3 rubric)
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0
  - AUTO-REJECT (framing):    0
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED:             0
- Spec commit after iteration:   a2bb6248 (post-rebase on top of 6d4ef570)
