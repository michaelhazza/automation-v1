# Portfolio Operations OS — Executable Research Brief

**Date:** 2026-05-08
**Type:** Executable research prompt (hand to a fresh Claude session)
**Companion brief:** `tasks/churn-platform-competitor-research.md`

---

## Sections

1. Mission
2. Background context
3. Strategic hypothesis to test
4. Research questions (must answer with evidence)
5. Out of scope
6. Sources to consult
7. Deliverables
8. Quality bar
9. Assumptions to challenge explicitly
10. Output format expectations
11. Stop conditions

---

## 1. Mission

Validate (or refute) the hypothesis that Synthetos has a defensible second wedge selling an **AI Operations Layer for Holdcos and Lower-Mid-Market PE Operators** — and produce the evidence base needed to make a go / no-go decision in the next 30 days.

Output a memo that lets the founder decide:
- Is the wedge real?
- Who exactly pays?
- How big is it?
- What's the 90-day move?

## 2. Background context

### What Synthetos is
Multi-tenant operations platform for AI agents. Three-tier isolation (System → Org → Subaccount). Out-of-the-box agents and workflows. Approval gates on agent actions. Model-agnostic routing. Full positioning in `docs/capabilities.md`.

### Why this wedge is being considered
- Synthetos's multi-tenant subaccount model is structurally a fit for any buyer managing multiple operating entities (PE portcos, holdco subsidiaries, family-office operating businesses).
- A separate research brief at `tasks/churn-platform-competitor-research.md` covers the first wedge (CS / churn detection for B2B SaaS). This brief covers a candidate **second** wedge.
- Initial scan suggests the upper market is closed (Carta, Maestro, Chronograph, iLEVEL all entrenched) but a seam exists at the lower end — operator-led holdcos, sub-$500M-AUM PE, search funds, modern serial acquirers.

### Initial assumptions (challenge these)
1. The "Portfolio Operations OS" framing loses to Carta on brand and capital. Reframing to "AI Operations Layer for Holdcos" is the only defensible angle.
2. Operator-led holdcos (Tiny, Constellation-style, AI-native rollups, search funds) are an underserved cohort with growing budget.
3. Sub-$500M-AUM PE firms have 3–15 portcos, no centralised operating tooling, and budget but no incumbent.
4. ACV $50k–$200k is realistic per buying entity; sales cycle 3–6 months.

## 3. Strategic hypothesis to test

> **Holdcos and lower-mid-market PE operators are a defensible second wedge for Synthetos because (a) they require multi-tenant agent isolation that no incumbent ships natively, (b) Carta's enterprise framing leaves the operator-led segment uncontested, and (c) the agentic-AI category is being formed right now, leaving a 12–18 month window to claim narrative ownership.**

A successful brief either confirms this with sourced evidence and a clear ICP, or refutes it with specific reasons (and proposes the next-best alternative).

## 4. Research questions

### 4.1 Market sizing

1. How many holdcos / serial acquirers / operator-led rollups exist globally? Cite Search Fund Coalition, ETA conferences, HoldCo Builders, Stanford ETA primer. Distinguish single-asset vs. multi-asset operators.
2. How many sub-$500M-AUM PE firms have active operating teams (vs. pure investment teams)? PEI 300, PitchBook, Preqin.
3. What is the typical software spend per holdco / per PE firm at this size? Find at least 5 published or quoted ACVs.
4. What is the realistic 3-year and 5-year ARR ceiling at 5% capture of the target ICP?

### 4.2 Competitive landscape

For each named competitor, produce: founding year, ARR or revenue, customer count, recent funding, AI-product status, ICP positioning, top 3 strengths, top 3 weaknesses.

- **Carta** (focus: agentic ERP positioning, ListAlpha acquisition, FoF launch — March 2026)
- **Maestro** (Accordion lineage, S&P Global backing, 1,000+ portcos)
- **Chronograph** (175k portcos, $20T AUM, 2024 AI launch)
- **Cobalt (FactSet)**, **Allvue**, **eFront**, **iLEVEL** — confirm whether any has launched operator-facing agentic features
- **Visible.vc**, **Standard Metrics**, **Vestberry**, **Edda** — VC-side
- **Addepar**, **SS&C Black Diamond**, **Asseta AI** — family-office-side
- **Infinity Constellation** ($17M, AI-native holdco) — is this a competitor or a customer?
- Stealth AI-native PE-ops entrants — find at least 3 not in the above list

### 4.3 Buyer reality

1. Who is the actual economic buyer in a holdco vs. a PE firm? CFO? COO? Operating partner? Founder/managing partner?
2. What is the buying committee for an $80k–$150k ACV in this segment?
3. What does a real day-in-the-life of an operating partner at a $200M-AUM PE firm look like? Find 3+ first-person sources (LinkedIn posts, podcasts, interviews).
4. What software do they currently use, and where do they hate it? Find specific gripes from G2, Reddit (r/privateequity), HoldCo Builders forum, ETA Slack groups.

### 4.4 Where Synthetos can win (or can't)

1. Map Synthetos's architectural advantages (multi-tenant, approval gates, agentic, model-agnostic) against named incumbent gaps. Specifically — is multi-tenant a *real* requirement or a feature buyers don't yet care about?
2. What is the time-to-value Synthetos can credibly promise (Day 7 / Day 30 / Day 90)? What would the OOTB demo look like?
3. What competitor would be most threatening if they decided to attack the same segment? How fast could Carta ship a holdco-specific module?

### 4.5 Risks

1. Top 5 competitive risks ranked by probability and severity
2. Top 3 structural risks (buy-vs-build, switching costs, regulatory)
3. Top 3 macro risks (AI regulation, PE-spend tightening, DPM/LP pressure on portco IT spend)

### 4.6 Decision support

1. Recommended ICP definition (concrete: "$X–$Y AUM, N portcos, has operating partner, located in US/EU")
2. Recommended pricing tiers (3 tiers, public pricing if possible)
3. Recommended pilot structure (free vs. paid, length, success metric)
4. Recommended initial sales motion (founder-led, AE hire timing, channel)
5. Sequencing recommendation: parallel with churn or sequenced after?

## 5. Out of scope

- Mega-fund PE ($1B+ AUM) — defended by S&P iLEVEL / Chronograph / Allvue
- Pure LP-reporting use cases — Carta + Visible.vc adequate
- Pure fund accounting — Allvue / eFront defended
- Public-market portfolio management — different category
- Wealth management for individual UHNW clients — different buyer
- Tax / compliance software — not Synthetos's wedge

## 6. Sources to consult

### Companies & products
Carta (carta.com/blog/erp/, release notes), Maestro (go-maestro.com), Chronograph (chronograph.pe), Cobalt, Allvue, eFront, iLEVEL, Visible.vc, Standard Metrics, Vestberry, Addepar, Asseta AI, Asset Vantage, Infinity Constellation

### Publications
McKinsey Global Private Markets Report, Bain Global PE Report, PEI 300, PitchBook PE/VC reports, Preqin, S&P Global Market Intelligence, FTI Consulting, Deloitte, EY, BDO, PwC

### Communities & operator sources
HoldCo Builders (podcast + community), Search Fund Coalition, Stanford ETA Primer, r/privateequity, r/searchfunds, Visible's portfolio-monitoring blog, Tiny annual letters, Constellation Software annual reports

### Specific people / signals to find
- Operating partners at $100M–$500M AUM PE firms (LinkedIn search)
- Andrew Wilkinson (Tiny) public commentary on portco tooling
- Search fund acquirers active on HoldCo Builders
- Recent (2025–2026) job postings for "Head of Portfolio Operations" / "Operating Partner" — what tooling do they require?

## 7. Deliverables

A single memo, ~10–15 pages, in `tasks/portfolio-ops-research-output.md`, with these sections:

1. **TL;DR** (≤6 bullets)
2. **Verdict:** GO / NO-GO / GO-WITH-CONDITIONS — with one-paragraph rationale
3. **Market sizing** (top-down + bottom-up + capture path)
4. **Competitive landscape** (named competitors with structured profile per §4.2)
5. **ICP definition** (concrete, exclusionary)
6. **Pain-point matrix** (incumbents × pain points)
7. **Where Synthetos can / can't win**
8. **Recommended wedge motion** (positioning, pricing, pilot, sequencing)
9. **Risks ranked**
10. **90-day next moves** (numbered, with owners and acceptance criteria)
11. **Sources** (markdown links, ≥20 distinct sources)

## 8. Quality bar

**Good looks like:**
- Every quantitative claim has a source link
- Every named competitor has at least 5 data points (founded, ARR/rev, customers, last raise, AI status)
- The ICP is narrow enough that a salesperson could build a target list from it the same day
- The 90-day plan has acceptance criteria — each item is either done or not done
- The memo openly states what couldn't be validated and what the executing session is uncertain about

**Bad looks like:**
- Vague TAM ranges with no methodology
- "Carta is dominant" without specific evidence of where they win and lose
- Generic positioning ("we'll win on AI") without naming the structural advantage
- Missing the holdco / search-fund / operator-led-rollup cohort entirely

## 9. Assumptions to challenge explicitly

1. **Is multi-tenant actually a requirement, or a feature operators don't care about?** Easy to assume yes; validate with at least 3 operator interviews or sourced quotes.
2. **Is the operator-led holdco cohort large enough to support a venture business, or is it a niche?** Bottom-up count required.
3. **Is Carta's "agentic ERP" positioning actually shipping value, or is it marketing?** Read release notes, recent G2 reviews, customer feedback. The answer materially changes the urgency.
4. **Could Synthetos's churn-detection wedge expand into Portfolio Ops naturally**, or are these structurally different motions? Test the "land on churn, expand to portfolio" thesis.
5. **What is the buy-vs-build risk specifically in PE/holdcos?** PE firms have engineering teams. Validate with operator-partner sourced views.

## 10. Output format expectations

- Markdown
- All claims sourced (footnote-style or inline links)
- Concrete numbers preferred over ranges where possible
- Tables for competitor comparisons and pain-point matrices
- Executive summary readable in 90 seconds
- Full memo readable in 20 minutes
- No marketing tone. No hedging. State what is true, what is uncertain, and what would change the answer.

## 11. Stop conditions

Stop and report if any of these conditions are hit:

- The TAM at the proposed ICP is verifiably under $200M annual spend
- Carta or Maestro has shipped or announced a holdco-specific module in 2025–2026
- 3+ stealth-mode AI-native PE-ops competitors are post-Series A
- The buy-vs-build evidence shows >50% of target buyers will build internally
- An operator-interview signal indicates multi-tenant is not a felt pain

In any of these cases, do not write a "GO" recommendation. Surface the blocker and recommend a pivot or a no-go.
