# Handoff — mcp-vendor-server-onboarding (PAUSED)

**Phase status:** PHASE_1_PAUSED
**Phase complete:** SPEC AUTHORING + spec-reviewer (Steps 1–7)
**Paused at:** Step 8 (chatgpt-spec-review MANUAL mode) — not yet started
**Next step on resume:** Step 8 — chatgpt-spec-review against the spec
**Spec path:** docs/superpowers/specs/2026-05-19-mcp-vendor-server-onboarding-spec.md
**Branch:** main
**Build slug:** mcp-vendor-server-onboarding
**UI-touching:** yes (4 small additions to existing Connections page — wire notes only, no mockups)
**Mockup paths:** n/a (operator confirmed skip per brief §12)
**Spec-reviewer iterations used:** 4 / 5
**Spec-reviewer verdict:** READY_FOR_BUILD
**Spec-reviewer final report:** tasks/review-logs/spec-review-final-mcp-vendor-server-onboarding-20260519T092711.md
**ChatGPT spec review log:** n/a — not yet run

## How resume works

1. Operator types `spec-coordinator: <anything>` in a new Claude Code session.
2. Step 0 PLANNING-lock invariant reads this file, detects `phase_status: PHASE_1_PAUSED`.
3. Coordinator skips Steps 1–7 and jumps to Step 8 (chatgpt-spec-review MANUAL mode).
4. After Step 8 returns, Steps 9 (handoff finalisation) → 10 (current-focus.md → BUILDING) → 11 (end-of-phase prompt) run normally.

## Decisions made in Phase 1 (so far)

- **Scope class:** Major. 4–5 engineering weeks; cross-cutting; new patterns (HTTP transport, subprocess isolation, capability-routing contract, env-mapping, subaccount cascade).
- **Mockup skip:** confirmed. Brief §12 says wire notes only; operator confirmed at intent intake.
- **Capability fit:** extends existing `integration-framework` capability (Cluster: Integrations, Lifecycle: Mature). No new top-level Asset Register row; the existing row's notes column carries the five vendor entries.
- **Duplication / Strategy Check:** Duplication=clear, Strategic fit=clear, Recommendation=proceed.
- **Grill-me Q&A:** skipped per CLAUDE.md skip condition — brief covers all six grill topics (scope, dependencies, failure modes, operator surfaces, capability cluster fit, substantive open questions captured in intent.md).
- **Spec phases:** two phases. Phase A = seven cross-cutting prereqs (internal release). Phase B = five vendor onboardings (Brave Search → GitHub → Notion → Stripe → Slack), one at a time on top of Phase A.
- **No new migrations.** All required fields already exist on `mcp_server_configs`. RLS posture unchanged.
- **Sandbox boundary:** process-level for V1; e2b pool migration explicitly deferred per §27 open question.

## Open questions for Phase 2 (when resumed)

1. Long-term home for MCP execution (process-level vs e2b pool). Decision deadline: before Phase B Slack vendor.
2. Concurrency ceiling defaults (`MAX_MCP_SUBPROCESSES_PER_NODE = 4`, `MAX_MCP_SUBPROCESSES_PER_ORG = 2`) — validate against production node-class during Phase A.
3. `shared-read-only-infrastructure` ADR approval workflow — finalised in the procurement ADR.
4. `mcp_capability_shadowed` UI surface depth — current filtered audit-log view sufficient; dedicated dashboard deferred.
5. Per-tool risk-tier auto-extraction — keep manual per vendor for V1.
6. HTTP transport across more vendors — only Brave Search uses HTTP today.
7. Action-registry file split — judged at Phase A start.

## Files committed in Phase 1 (so far)

- `docs/superpowers/specs/2026-05-19-mcp-vendor-server-onboarding-spec.md` — 913+ lines; pushed to main via spec-reviewer auto-commit contract (HEAD `51920983`).
- `tasks/builds/mcp-vendor-server-onboarding/intent.md` — 9-section intent capture.
- `tasks/builds/mcp-vendor-server-onboarding/progress.md` — phase progress + pause record.
- `tasks/builds/mcp-vendor-server-onboarding/handoff.md` — this file.
- Spec-reviewer review logs under `tasks/review-logs/spec-review-{log,final}-mcp-vendor-server-onboarding-*.md` and `codex-iter{1..4}-raw-*.txt`.

## What is NOT in this handoff yet

- ChatGPT spec review log (Step 8 has not yet run).
- BUILDING transition (current-focus.md still shows `status: PLANNING`).
- Plan file (`tasks/builds/mcp-vendor-server-onboarding/plan.md`) — produced by feature-coordinator in Phase 2, not Phase 1.

When the chatgpt-spec-review loop completes, this file is rewritten by Step 9 to remove the PAUSED state and add the standard Phase 2 handoff fields.
