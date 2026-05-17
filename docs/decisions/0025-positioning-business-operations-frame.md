# ADR-0025: Synthetos positioning — business-operations frame with runtime pluralism

**Status:** accepted
**Date:** 2026-05-17
**Domain:** positioning, GTM, capabilities registry
**Supersedes:** _(none — adjusts framing established 2026-04-14 in `docs/capabilities.md` § Positioning, but does not supersede a prior ADR)_
**Superseded by:** _(none)_

## Context

For ~13 months the headline frame in `docs/capabilities.md` has been agency-primary: *"the operations system an agency uses to run its business on top of"* LLM-provider primitives, with the messaging north star *"LLM providers sell capability. Synthetos sells the business."* The agency frame was specific and converting — every structural differentiator (multi-tenant isolation, white-label portal, per-client margin tracking, supervised no-code migration) maps cleanly onto agencies serving many clients, and the messaging closed against horizontal capability providers.

Two pressures surfaced in May 2026 that the agency-only frame did not handle cleanly:

1. **Agent-runtime ecosystem consolidation.** OpenClaw-class runtimes and adjacent agent-runtime projects are becoming infrastructure (hardware vendor product pages featuring them, foundation-model labs integrating with them, payment vendors building agent wallets around them, 365k+ GitHub stars on the leading project). A purely agency-framed pitch left "are we a thin wrapper that becomes obsolete when the runtime grows upward into governance?" unanswered in the headline doc — the architecture already addresses it (runtime-pluralism, MCP server support, AI Subscriptions, model-agnostic routing) but the positioning did not surface it.
2. **TAM compression.** The agency frame pre-filtered cleanly to a defined ICP but excluded every operations-function buyer at non-agency businesses (operations leaders, IT, finance ops, customer ops, internal automation teams) who have the same structural needs — multi-tenant isolation across subsidiaries / business units / brands, approval gates on production systems, audit lineage, operational cost attribution, runtime independence. The product already supports them; the positioning did not.

Strategic review on 2026-05-17 (branch `claude/evaluate-synthetOS-strategy-Dl4oa`, commit `a101be2`) confirmed that the structural moats remain correct and the architecture already supports both buyers. What needed to change was the headline frame and the explicit positioning against runtime ecosystems.

## Decision

We will adopt **"the governed operating system for AI-run business operations"** as the headline tagline in `docs/capabilities.md`.

We will reframe the primary buyer from "agencies serving many clients" to "businesses running multiple subsidiaries, business units, brands, regions, franchise networks, or agency-served client books." **Agencies remain a first-class ICP under that umbrella** — every per-client, white-label, and per-client-margin differentiator is preserved verbatim — but agencies are not the default headline.

We will add **runtime pluralism** as the first structural differentiator and **audit and lineage as a system** as the last. Both make explicit that agent runtimes (agent-runtime projects, execution sandboxes, browser-automation runtimes, code-execution sandboxes, MCP tool servers, agent-protocol systems) and LLM providers are interchangeable supply underneath the governed operations layer. Synthetos does not compete with the runtime layer; Synthetos governs work that runs on top of it.

We will update the messaging north star to **"LLM providers sell capability. Agent runtimes sell execution. Synthetos sells operational control."**

We will extend the Editorial Rules ("no specific LLM / AI provider names in customer-facing sections") to cover agent-runtime project names and execution-sandbox vendor names. Generic category language only: *agent runtimes, execution sandboxes, browser-automation runtimes, agent-protocol systems.*

## Consequences

- **Positive:**
  - Closes the runtime-obsolescence flank explicitly in the headline doc rather than leaving it implicit in the architecture.
  - Widens TAM to operations-function buyers at non-agency businesses without forfeiting the agency ICP.
  - Decouples positioning identity from any one runtime ecosystem, so the historical consolidation pattern (Linux / Red Hat, Kubernetes / platform companies, payment rails / Stripe) plays in our favour rather than against us.
  - Makes runtime pluralism a marketable claim that a single-runtime competitor cannot honestly make.
  - Sharpens the response to "what if [vendor] ships multi-tenant" / "what if [runtime] ships governance" — the moat is the operations system, not any one feature.
- **Negative:**
  - Loses some specificity. "Business operations" is broader than "agencies serving many clients" and easier to sound generic in. Mitigation: every structural differentiator keeps its concrete framing; agency-specific landing pages and discovery-call demos still lead with the per-client and white-label story.
  - Forces re-orientation across sales decks, landing pages, and marketing collateral over the next sprint. The capabilities registry is the source of truth; downstream collateral catches up incrementally.
  - Two historical artifacts quote the superseded tagline as the strategic frame at the time of their respective work: `tasks/research-questioning-design-notes.md` line 55 and `docs/routines-response-dev-spec.md` line 55. Both are preserved as historical audit trail and not retroactively rewritten.
- **Neutral:**
  - No architecture changes. The product already supported both buyers; only the framing and editorial rules moved.
  - All existing objection-handling rows are retained alongside new business-shaped rows. An explicit "we are an agency, this sounds like enterprise-speak" row was added so agency prospects who self-identify under the broader frame still find themselves in the doc.

## Alternatives considered

- **Stay agency-primary, treat business-operations as one of many vertical pages.** Rejected — leaves the runtime-obsolescence flank open in the headline doc, and the agency frame becomes harder to defend as agent-runtime ecosystems normalise across business-operations buyers.
- **Pivot to "OpenClaw for business" or any single-runtime headline.** Rejected explicitly. Tightly couples identity to one runtime ecosystem, makes Synthetos vulnerable to ecosystem captivity, and ignores the consolidation pattern (the runtime layer commoditises faster than the operations layer).
- **Generic "agent platform for business" headline.** Rejected — indistinguishable from horizontal agent platforms whose buyer is an individual or an internal engineering team. The governance frame is the differentiator and must be in the headline.
- **Two parallel frames (agency-headline and business-headline) maintained side by side.** Rejected — splits the messaging and asks every collateral asset to choose. One headline with agencies as a first-class ICP underneath is cleaner and matches the underlying product.
- **Keep "Synthetos sells the business" north star, just broaden "the business".** Rejected as too subtle. The new north star names runtime ecosystems explicitly because the original was silent on them, and silence is the same problem this ADR is solving.

## When to revisit

- When agent-runtime ecosystem consolidation produces a clear winner that ships governance and orchestration features at the runtime layer (multi-tenant isolation, approval gates, audit lineage, operational cost attribution, stakeholder surfaces). If a runtime grows upward into the operations layer, this ADR needs replacing — the response is not "we have that too," it is a new positioning ADR.
- When the operations-function ICP fails to convert at materially higher rates than the agency-only ICP did, after a deliberate GTM cycle. If the broader frame does not earn its TAM expansion, narrow back.
- When a customer cohort emerges that does not map to "multiple business units, brands, regions, franchise networks, or agency-served client books" — i.e. a buyer who needs a different multi-tenant model.

## References

- Diff: `docs/capabilities.md` (commit `a101be2`, branch `claude/evaluate-synthetOS-strategy-Dl4oa`, operator pulled 2026-05-17)
- Updated sections: `docs/capabilities.md` § Core Value Proposition, § Positioning & Competitive Differentiation (frame, one-sentence answer, messaging north star, structural differentiators, objection handling, GTM application, "What Synthetos is NOT trying to be"), § Non-goals
- Superseded historical references retained as audit trail: `tasks/research-questioning-design-notes.md` line 55, `docs/routines-response-dev-spec.md` line 55
- Editorial Rules: `docs/capabilities.md` § Editorial Rules; full version in `CLAUDE.md`
- Originating session: strategic review thread initiated 2026-05-17 evaluating the runtime-obsolescence flank against the current Synthetos architecture
