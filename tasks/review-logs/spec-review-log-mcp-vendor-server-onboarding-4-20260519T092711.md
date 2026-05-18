# Spec Review Log — mcp-vendor-server-onboarding — Iteration 4

**Spec:** `docs/superpowers/specs/2026-05-19-mcp-vendor-server-onboarding-spec.md`
**Timestamp:** 2026-05-19T09:27:11
**Codex output:** `tasks/review-logs/codex-iter4-raw-20260519T092711.txt` (1697 lines)
**Codex findings:** 2 (both medium / P2)
**Rubric findings:** 0 new

Findings continue to shrink: 12 → 9 → 5 → 2. Both findings are about cleanup of the discriminated-union split from iteration 3.

---

## Codex findings

### FINDING #1 — P2 medium — §18.4 / §22.4 / §16.4
- Description: `McpAuditTerminalEntry` still permits `routingDecision: 'native' | 'mcp_shadowed_by_native'`, but terminal events represent actual MCP invocations (§22.4) and native-shadow cases bypass MCP entirely.
- Classification: mechanical.
- Disposition: ACCEPT.
- Fix applied: §18.4 terminal-entry `routingDecision` narrowed to literal `'mcp'`; `shadowedNativeCapabilityId` narrowed to `null`. Auxiliary entry `routingDecision` narrowed to `'mcp_shadowed_by_native' | null`. §16.4 filter simplified to `eventType = 'mcp.capability.shadowed'`. §10.3 routing bullet clarified — no terminal MCP event fires when native shadows MCP.

### FINDING #2 — P2 medium — §9.6 / §18.1 / §23
- Description: `allowedHosts` is described inconsistently — required for all, required for HTTP only, needed for stdio firewall gate.
- Classification: mechanical.
- Disposition: ACCEPT.
- Fix applied: §18.1 row updated — `allowedHosts` required for every Phase B enabled vendor preset regardless of transport; HTTP uses it for SSRF guard, stdio uses it for the infra firewall rule generator. Phase A placeholder presets exempt until promoted to Phase B. §9.6 network-egress bullet updated to match.

---

## Iteration 4 Summary

- Mechanical findings accepted:  2 (all Codex)
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0
- Spec commit after iteration:   <will be filled by Step 8b>
