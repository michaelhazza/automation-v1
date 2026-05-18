# ChatGPT Spec Review Session — mcp-vendor-server-onboarding — 2026-05-18T23-39-57Z

## Session Info
- Spec: docs/superpowers/specs/2026-05-19-mcp-vendor-server-onboarding-spec.md
- Branch: main
- PR: n/a — spec is committed directly to `main` (HEAD 51920983); no PR open for this branch
- Mode: manual
- Started: 2026-05-18T23:39:57Z
- Triage override (operator memo): auto-apply ALL technical findings (incl. critical / architectural / security / governance / risk-surface); escalate ONLY user-facing product-surface decisions (visible copy, workflow, feature policy, operator UX).

---

## Round 1 — 2026-05-19

**ChatGPT verdict:** CHANGES_REQUESTED. 9 findings.

**Triage:** all 9 are technical (architectural / correctness / clarity / consistency / style). Zero touch user-facing product surface, workflow copy, or operator UX. Per the triage rule: auto-apply all 9. Zero escalations.

| # | Finding | Severity | Category | Action | Section(s) touched |
|---|---|---|---|---|---|
| F1 | Dashboard gate contradicts deferred dashboards | high | bug | Apply — replace `observability dashboards` in §7 gate with `observability instrumentation`; explicitly note dashboards are deferred per §23 and NOT a Phase B gate. | §7 |
| F2 | Egress enforcement is both required and deferred | high | architecture | Apply — restructure §9.6 prose to explicitly split "Phase A in-process layer" (this build) from "deferred infra firewall / NetworkPolicy" (§23). Re-affirm the §14 GA gate already blocks write-capable vendors on the infra rule. | §9.6 |
| F3 | Credential cascade contract misses revoked/error cases | medium | bug | Apply — extend §18.2 cascade table from 5 rows to 11 rows, adding explicit handling for `quarantined` (terminal, no cascade), `error`, `disabled`, `credentialRevoked`, `credentialExpired` (cascade through), and `shared-system-key` missing-env-var. Add "Status precedence summary" block. | §18.2, §24 |
| F4 | Terminal audit uniqueness can collide on server-level failures | medium | bug | Apply — clarify that `invocationSequence` is monotonic per `(runId, serverId)`, NOT per `(runId, serverId, toolName)`. Repeated `mcp.server.unavailable` attempts with `toolName: null` are uniquely keyed by ascending sequence. Comment added to `toolName` field in §18.4; explanation in §22.1 dedup contract; post-terminal prohibition restated in §22.4. | §18.4, §22.1, §22.4 |
| F5 | Run failure semantics are inconsistent | medium | bug | Apply — clarified split: "server unavailable" = server omitted from this run's available-tool set; "tool invocation failed" = specific tool fails. MCP layer never marks the parent agent run as failed; orchestrator decides run continuation. Added prose to §9.3; rewrote four §12.2 bullets. | §9.3, §12.2 |
| F6 | Tool-count claim conflicts with unknown compatibility rows | low | consistency | Apply — soften §11.6 from "all five vendors under the cap" to "Brave Search confirmed at 2 tools; GitHub/Notion/Stripe/Slack tool counts confirmed during procurement ADR pass". Cross-link §13.1 verdict matrix. | §11.6 |
| F7 | Status-state implementation may be underspecified | low | implementation | Apply — added explicit reference-site coverage clause to §17.1 row for `mcpServerConfigs.ts` (zod validator in routes, service-layer guards, client-side status mapper). Added new CI gate `verify-mcp-status-coverage.sh` to §17.3. Updated CI gate count in §24 from 2 → 3. | §17.1, §17.3, §24 |
| F8 | "Silent denial" conflicts with auditability | low | clarity | Apply — replaced §11.2 single line "silent denial, with audit event" with explicit triplet: silent to vendor server, typed error to agent loop, audit event to operators. | §11.2 |
| F9 | Line-number anchors are brittle | low | style | Apply — replaced both `(line 611)` in §9.2 and `(line 185)` in §9.3 with function/grep anchors. | §9.2, §9.3 |

**Total fixes applied:** 9 (across 11 spec sections).
**Findings rejected:** 0.
**Findings escalated to operator:** 0.

**Files changed:** `docs/superpowers/specs/2026-05-19-mcp-vendor-server-onboarding-spec.md` (frontmatter + §7 + §9.2 + §9.3 + §9.6 + §11.2 + §11.6 + §12.2 + §17.1 + §17.3 + §18.2 + §18.4 + §22.1 + §22.4 + §24).

Round 1 ready for commit.

---
