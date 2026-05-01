# Agency-Readiness Audit Tool — DEFERRED

**Status:** DEFERRED — not in current dev session scope. Captured here so the work isn't lost.
**Original brief:** Feature 4 of the Sub-account Foundation Layer & Audit Tool brief.
**Deferral reason:** Out of scope for the current concurrent build (F1, F2, F3). Cheap and independent — should be picked up after the foundation layer ships.
**Estimated effort when picked up:** 2-3 days for v1 (capability-coverage report only); ~1 week for v2 (with hours-saved / margin-lift projections).

---

## Goal (preserved from original brief)

A free, public-facing assessment tool that produces a personalised AI-readiness report for an agency. Input: agency's services, current tools, client portfolio. Output: report covering (a) which Synthetos workflows they should run, (b) what the orchestrator would route to which agents, (c) projected hours per week saved, (d) projected margin lift per client. Ends with "and here's the platform that does this."

Marketing surface, not a core product feature, but leverages existing engine capabilities and produces a high-conversion top-of-funnel asset.

## Why this is cheap to build (audit findings as of 2026-05-01)

Foundations already shipped:

| Component | File | State |
|-----------|------|-------|
| Capability map service | `server/services/capabilityMapService.ts:180-212` | Production. `listAgentCapabilityMaps` returns active agents + maps. |
| Orchestrator capability routing | `server/services/skillExecutor.ts:1353-1365` + `docs/orchestrator-capability-routing-spec.md` | Production. Forward-only (task → agent); inversion needed for audit use. |
| Public page serving | `server/routes/public/pageServing.ts` | Production. CSP, ETag, tracking, full HTML shell. |
| Public form submission | `server/routes/public/formSubmission.ts` | Production. Rate-limited (5/min/IP, 50/min/page). |
| Pages & Content Builder | `server/db/schema/pages.ts` + `client/src/pages/PageProjectDetailPage.tsx` | Production. Full page editor + publish workflow — the audit landing page can literally be a published page. |
| Cost / margin tracking | `server/services/costAggregateService.ts` | Production. Per-request `costWithMarginCents` captured. Available for projection grounding. |

What's NOT shipped (would need to be built):

- Inverse capability matcher: agency description → covered playbooks (forward-only routing exists today)
- Agency-description parser (could re-use the LLM decomposition pipeline used by orchestrator routing)
- Audit report renderer (HTML / PDF)
- Hours-saved heuristic table (no canonical data; v1 stubs with conservative defaults per integration)
- Lead-capture wiring to CRM
- Public landing route + form

## Sketch architecture (draft, refine when picked up)

1. Public landing page at `/agency-audit` (published via Pages & Content Builder).
2. Structured form: agency size (employees), client count, services offered (multi-select from controlled vocabulary), current tools (multi-select), free-text "what hurts most".
3. POST submission → `agencyAuditService.score(input)`:
   - Parse free-text via LLM decomposition (re-use orchestrator pipeline)
   - Cross-reference against `capabilityMapService.listAgentCapabilityMaps(synthetosOrgId)` (use Synthetos's own org as the reference catalogue of available agents)
   - Score per-capability coverage; identify highest-leverage Workflows for this agency
4. Hours-saved projection v1: lookup table per agent capability. Defaults: "email-outreach saves 3hrs/wk per mailbox", "reporting-agent saves 2hrs/wk per client". Multiply by stated client count.
5. Margin-lift projection v1: hours saved × stated hourly rate × Synthetos margin multiplier (defaults ~1.30× per `costAggregateService`).
6. Output: HTML report (rendered via Pages & Content Builder template) with shareable URL. Email a copy to the lead. Write submission to a new `agency_audit_submissions` table for sales follow-up.

## Build order (when picked up)

1. **Phase 1 — `agencyAuditService` skeleton + capability inversion** (~6h). Read agency input, return JSON: `{ coverage: %, recommendedWorkflows: [], gaps: [] }`.
2. **Phase 2 — Hours-saved + margin-lift heuristics** (~4h). Lookup table + multiplication. Deferred decision: whether to require user-supplied hourly rate or use industry default.
3. **Phase 3 — Audit form + landing page** (~6h). Use Pages & Content Builder. Wire `formSubmissionService` to `agencyAuditService.score`.
4. **Phase 4 — Report renderer + email delivery** (~6h). HTML template; shareable URL; email via existing notification fan-out.
5. **Phase 5 — Submissions table + CRM integration** (~3h). New `agency_audit_submissions` table; ensure GHL/Salesforce export path if connected.

## Migration number (when picked up)

Reserve `0271` (after F3's 0268-0270 land).

## Why deferred from the current session

- The current concurrent build (F1, F2, F3) is foundation work — context inheritance, observability, baseline capture. The audit tool is a marketing surface that benefits from those foundations being in place but doesn't depend on them.
- Picking up this work after F1-F3 ship lets the audit reference the freshly-captured baseline artefacts (e.g. "agency provides Tier 2 ICP-driven outreach — Synthetos has X agent that consumes ICP profiles").
- Cheap to build means it doesn't compete for attention with the more complex feature work; it can be a 1-week side build later.

## Pickup signal

Pick this up when:
- F1 has shipped (artefact set provides reference vocabulary the audit can cite)
- A marketing push needs a top-of-funnel asset
- Or: someone asks "how do we get more agency leads?" — this is the answer.

## Blockers (when picked up)

- Hours-saved heuristic table — needs product decision on conservative defaults vs. user-supplied baseline hours during audit
- Brand / visual design for the audit landing page
- Email delivery infrastructure — confirm existing notification fan-out can send templated reports to anonymous email addresses (not just in-platform users)
