# Handoff — mcp-vendor-server-onboarding

**Phase complete:** SPEC
**Next phase:** BUILD (run `feature-coordinator` in a new session)
**Spec path:** docs/superpowers/specs/2026-05-19-mcp-vendor-server-onboarding-spec.md
**Spec status:** accepted
**Branch:** main
**Build slug:** mcp-vendor-server-onboarding
**UI-touching:** yes (four small additions to existing Connections page — wire notes only, no mockups)
**Mockup paths:** n/a (operator confirmed skip per brief §12)
**Spec-reviewer iterations used:** 4 / 5 (verdict READY_FOR_BUILD; 31 mechanical fixes; 0 directional)
**Spec-reviewer final report:** tasks/review-logs/spec-review-final-mcp-vendor-server-onboarding-20260519T092711.md
**ChatGPT spec review log:** tasks/review-logs/chatgpt-spec-review-mcp-vendor-server-onboarding-2026-05-18T23-39-57Z.md (R1 9 findings applied → R2 1 finding applied → APPROVED; final HEAD `1d2759dd`)

## Decisions made in Phase 1

- **Scope class:** Major. 4–5 engineering weeks across two phases.
- **Phase A (internal release):** seven cross-cutting prerequisites ship together — HTTP transport with security posture, env-var name remapping, subaccount credential cascade, version pinning + supply-chain guard, capability routing contract, subprocess isolation, observability + telemetry. No vendor server enabled in production.
- **Phase B (vendor onboardings):** five vendor MCP servers ship one at a time in this order — Brave Search → GitHub → Notion → Stripe → Slack. Each gated by per-org feature flag, negative-path tests, observability instrumentation, governance mappings, and the §13.1 compatibility-verdict matrix.
- **Mockup skip:** confirmed. Brief §12 says wire notes only; operator confirmed at intent intake.
- **Capability fit:** extends existing `integration-framework` capability (Mature). No new top-level Asset Register row; the existing row's notes column carries the five vendor entries via the `source: 'vendor-mcp'` marker introduced in §18.5.
- **Duplication / Strategy Check:** Duplication=clear, Strategic fit=clear, Recommendation=proceed.
- **Grill-me Q&A:** skipped per CLAUDE.md skip condition — brief covers all six grill topics.
- **No new migrations.** All required schema fields already exist on `mcp_server_configs`. `status` type-union extension is type-only (underlying column is `text`).
- **Sandbox boundary:** process-level for V1; e2b pool migration explicitly deferred per §27 Q1 / §23 deferred item.
- **Egress enforcement:** in-process layer ships in Phase A (spawner-side `cwd`/path-restriction, `HTTPS_PROXY` injection, `allowedHosts` pre-flight); hard firewall / NetworkPolicy rule is the §23 deferred infra item. **Write-capable Phase B vendors (Stripe, GitHub write surface, Notion write surface, Slack) are blocked from enablement until the §23 infra rule lands.** Read-only `shared-read-only-infrastructure` class (Brave Search) may enable with best-effort in-process controls only, with the procurement ADR recording the gap.
- **Spec status flip:** `reviewing` → `accepted` after R2 APPROVED + operator lock signal.

## Open questions for Phase 2

1. **Long-term home for MCP execution.** Process-level path restriction for V1; Phase 2 migration into the e2b sandbox pool deferred. Decision deadline: before Phase B Slack ships.
2. **Concurrency ceiling defaults.** `MAX_MCP_SUBPROCESSES_PER_NODE = 4`, `MAX_MCP_SUBPROCESSES_PER_ORG = 2`. Validate against production node-class during Phase A; revisit if a Phase B vendor hits the ceiling during beta.
3. **`shared-read-only-infrastructure` ADR approval workflow.** Codified in the procurement ADR; finalisation not pre-committed.
4. **`mcp.capability.shadowed` UI surface depth.** §16.4 ships a filtered audit-log view; dedicated dashboard deferred (§23).
5. **Per-tool risk-tier auto-extraction.** Manual per vendor for V1 in the ADR review pass.
6. **HTTP transport across more vendors.** Brave Search is the only Phase B HTTP-transport vendor. If GitHub or Notion ships an HTTP-only server before merge, the spec is amended.
7. **Action-registry file split.** Five vendor files at `server/config/actionRegistry/mcp*.ts`. If the action-registry index exceeds threshold, spec is amended at Phase A start.
8. **Vendor compatibility verdict matrix completion.** §13.1 rows marked `unknown` (license, telemetry callbacks, tool count) for GitHub / Notion / Stripe / Slack — resolved at procurement ADR time during Phase A. `unknown` rows block that vendor's Phase B enablement.

## Phase 2 entry checklist for feature-coordinator

- Spec at `docs/superpowers/specs/2026-05-19-mcp-vendor-server-onboarding-spec.md`, status `accepted`.
- Two-phase plan: Phase A (7 prereqs) before Phase B (5 vendors). Phase A is a single internal release with no vendor enabled. Phase B vendors land one at a time.
- File inventory at §17 (Phase A: §17.1–§17.5; Phase B: §17.6).
- Contracts at §18 (preset shape extension, cascade collision semantics, vendor-error classifier, audit-log discriminated union, capability registry source marker, source-of-truth precedence).
- Execution-safety contracts at §22 (idempotency posture, retry classification, concurrency guards, terminal-event guarantee with the §22.1 monotonic-per-(runId, serverId) sequencing contract, state-machine closure).
- Three new CI gates to wire: `verify-mcp-version-pin.sh`, `verify-mcp-allowlist-coverage.sh`, `verify-mcp-status-coverage.sh`.
- Vendor-procurement ADR to author at `docs/decisions/<next>-mcp-vendor-procurement.md` (Phase A deliverable; codifies `shared-read-only-infrastructure` policy class eligibility, version-pin policy, CVE response, per-vendor compatibility verdict from §13.1).
- `integration-framework` Asset Register row update — Launch source + Last review + Carry notes; vendor entries added under notes column with `source: 'vendor-mcp'` marker.

## Files committed in Phase 1

- `docs/superpowers/specs/2026-05-19-mcp-vendor-server-onboarding-spec.md` — full spec, status `accepted`, final HEAD `1d2759dd`.
- `tasks/builds/mcp-vendor-server-onboarding/intent.md` — 9-section intent capture.
- `tasks/builds/mcp-vendor-server-onboarding/progress.md` — phase progress record.
- `tasks/builds/mcp-vendor-server-onboarding/handoff.md` — this file.
- `tasks/review-logs/spec-review-log-mcp-vendor-server-onboarding-{1..4}-*.md` — spec-reviewer per-iteration logs.
- `tasks/review-logs/spec-review-final-mcp-vendor-server-onboarding-20260519T092711.md` — spec-reviewer final report.
- `tasks/review-logs/chatgpt-spec-review-mcp-vendor-server-onboarding-2026-05-18T23-39-57Z.md` — chatgpt-spec-review session log (R1 + R2).
- `tasks/review-logs/codex-iter{1..4}-raw-*.txt` — spec-reviewer raw Codex output.
