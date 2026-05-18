# Spec Review Log — mcp-vendor-server-onboarding — Iteration 3

**Spec:** `docs/superpowers/specs/2026-05-19-mcp-vendor-server-onboarding-spec.md`
**Timestamp:** 2026-05-19T09:19:37
**Codex output:** `tasks/review-logs/codex-iter3-raw-20260519T091937.txt` (1714 lines)
**Codex findings:** 5 (1 high, 4 medium)
**Rubric findings:** 0 new

All five findings are mechanical — most are second-order issues introduced by iteration 2's edits, which validates running iteration 3.

---

## Codex findings

### FINDING #1 — high — §8 / §9.6 / §23
- Description: Egress firewall defer-and-record-gap lets write-tier vendors enable without hard enforcement.
- Classification: mechanical.
- Disposition: ACCEPT.
- Fix applied: §23 deferred-item updated — per-vendor enablement gate: vendors with any write/financial/destructive Risk Tier action are BLOCKED until the infra egress rule for their `allowedHosts` is in place. Only the `shared-read-only-infrastructure` policy class (Brave Search) may enable with best-effort in-process controls only. §14 GA criteria updated to match.

### FINDING #2 — medium — §9.5 / §22.3
- Description: §9.5 says `partial` capability registry mark; §22.3 says registry has no runtime mutation.
- Classification: mechanical.
- Disposition: ACCEPT.
- Fix applied: §9.5 startup-validation bullet clarified — `partial` is a boot-time-only outcome during registration; runtime schema drift surfaces as `mcp.schema.drift` audit events, not registry mutations.

### FINDING #3 — medium — §18.2 / §17.1
- Description: §18.2 prose signature omits `policyClass` even though the first cascade branch depends on it.
- Classification: mechanical.
- Disposition: ACCEPT.
- Fix applied: §18.2 prose updated to include `policyClass` in the signature; one sentence added clarifying `policyClass` is read from the preset and passed explicitly to keep the helper pure.

### FINDING #4 — medium — §17.1 / §18.2
- Description: `issueCredentialForMcp` described as delegating to `issueCredential`, but `shared-system-key` has no tenant config row.
- Classification: mechanical.
- Disposition: ACCEPT.
- Fix applied: §17.1 broker-service row rewritten with three explicit runtime branches: shared-system-key reads from a system env var named by the preset; subaccount/org delegates to existing `issueCredential`; null throws typed `MCP_SERVER_UNAVAILABLE` and emits the audit event.

### FINDING #5 — medium — §18.4 / §22.4
- Description: My iteration-2 fix made `status` and `invocationSequence` mandatory on every audit entry, but auxiliary observability events (`mcp.schema.drift`, `mcp.capability.shadowed`, `mcp.risk.tier.drift`) don't have terminal-event semantics.
- Classification: mechanical (introduced by my iter-2 fix).
- Disposition: ACCEPT.
- Fix applied: §18.4 rewritten as a discriminated union — `McpAuditTerminalEntry` (5 event types per §22.4) carries `status` + `invocationSequence`; `McpAuditAuxiliaryEntry` (3 event types) does NOT. §24 audit-event count statement updated to reflect the 5 + 3 split.

---

## Iteration 3 Summary

- Mechanical findings accepted:  5 (all Codex)
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
