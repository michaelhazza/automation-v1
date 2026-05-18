# Spec Review Log — mcp-vendor-server-onboarding — Iteration 2

**Spec:** `docs/superpowers/specs/2026-05-19-mcp-vendor-server-onboarding-spec.md`
**Timestamp:** 2026-05-19T09:12:36
**Codex output:** `tasks/review-logs/codex-iter2-raw-20260519T091236.txt` (1606 lines)
**Codex findings:** 9 (1 critical, 6 important, 2 minor)
**Rubric findings:** 0 new (iteration 1 covered the rubric exhaustively)

---

## Codex findings

### FINDING #1 — critical — §9.6 / §8
- Description: `HTTPS_PROXY` env injection is not enforcement — a child process can ignore it.
- Classification: mechanical (load-bearing claim without binding mechanism).
- Disposition: ACCEPT.
- Fix applied: §9.6 network-egress bullet rewritten to state actual enforcement is at the infra firewall / NetworkPolicy layer outside this codebase; in-process controls explicitly named as best-effort proxy-assistance. §8 trust-boundary row updated to match. Added `Egress firewall / NetworkPolicy wiring` to §23 deferred items.

### FINDING #2 — important — §16.1 / §18.1 / §18.6
- Description: `allowedTools` lives both in the preset and on `mcp_server_configs`, no source-of-truth or merge rule.
- Classification: mechanical.
- Disposition: ACCEPT.
- Fix applied: §16.1 adds explicit precedence — runtime allowlist = preset menu ∩ operator selection. §18.6 gets a new precedence row for `Per-tool allowlist`.

### FINDING #3 — important — §18.4 / §22.1 / §22.4
- Description: `McpAuditEntry` lacks `invocationSequence` and `status` even though invariants in §22.1 (composite-key dedupe) and §22.4 (terminal status) rely on both.
- Classification: mechanical.
- Disposition: ACCEPT.
- Fix applied: Added `status: 'success' \| 'failed'` and `invocationSequence: number` to `McpAuditEntry`.

### FINDING #4 — important — §17.1 / §18.2
- Description: `selectMcpCredential` is referenced from both `mcpServerConfigServicePure.ts` and `credentialBrokerServicePure.ts` (introduced by iteration 1 fix).
- Classification: mechanical.
- Disposition: ACCEPT.
- Fix applied: Function consolidated in `mcpServerConfigServicePure.ts`; `credentialBrokerServicePure.ts` row changed to `no change`; broker service `issueCredentialForMcp` row updated to call `selectMcpCredential` from the config-service module.

### FINDING #5 — important — §9.4 / §17.3
- Description: Provenance/checksum enforcement claimed but no concrete CI gate.
- Classification: mechanical.
- Disposition: ACCEPT.
- Fix applied: §9.4 line rewritten — provenance deferred to ADR-level manual review at version-bump time; future CI gate `verify-mcp-provenance.sh` noted in §23 deferred items.

### FINDING #6 — important — §13.1 / §7 / §12.1
- Description: §13.1 has blocker `unknown` rows but §7 phase plan and §12.1 DoD don't explicitly cite §13.1 resolution as a prerequisite.
- Classification: mechanical.
- Disposition: ACCEPT.
- Fix applied: §7 phase plan now lists §13.1 verdict resolution as a per-vendor prerequisite for Phase B enablement; §12.1 happy-path tightened — each vendor needs a fully resolved §13.1 verdict matrix (no `unknown` rows).

### FINDING #7 — important — §18.1 / §11.1
- Description: §18.1 lists `resolveGateLevel` as consumer of `riskTierMapping`, contradicting §11.1's "action registry is the runtime enforcing source".
- Classification: mechanical.
- Disposition: ACCEPT.
- Fix applied: §18.1 `riskTierMapping` row Consumer field updated — static gate + drift detector; explicit "NOT consumed by `resolveGateLevel`" callback to §11.1 / §18.6.

### FINDING #8 — minor — §23 / §7 / §17.1
- Description: §23 says "Phase A enables 5 vendor presets" but iteration 1 moved preset enablement to Phase B.
- Classification: mechanical.
- Disposition: ACCEPT.
- Fix applied: §23 wording changed to "Phase B enables 5 vendor presets... one at a time".

### FINDING #9 — minor — §9.1 / §12.3 / §21
- Description: §9.1 says "Validated end-to-end on Brave Search" but Brave Search is Phase B and e2e tests are out of scope.
- Classification: mechanical.
- Disposition: ACCEPT.
- Fix applied: §9.1 validation sentence rewritten — Phase A uses pure-function tests against the selector; live Brave Search validation happens in Phase B vendor 1 onboarding as manual beta-tenant validation.

---

## Iteration 2 Summary

- Mechanical findings accepted:  9 (all Codex)
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0
  - AUTO-REJECT (framing):    0
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED:             0
- Spec commit after iteration:   <will be filled by Step 8b>
