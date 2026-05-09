# Deep Research Prompt — PLG Vertical Wedge for Synthetos

*Copy and paste everything below this line into a fresh Claude / ChatGPT / Gemini deep research session.*

---

## 1. The ask

I am the founder of a software company called Synthetos. I am at a strategic crossroads on go-to-market wedge selection, and I need extensive deep research to make the right call. I want you to spend significant time on this — multiple hours, dozens of sources, real depth — and come back with a single ranked recommendation, not a survey of options.

Specifically: I want you to evaluate **10 candidate vertical SaaS markets** (plus one wildcard you identify) against a **12-criteria scorecard**, and tell me which ONE vertical I should commit to as Synthetos's beachhead wedge. The output is a comparative memo with the scorecard, a ranked recommendation, per-vertical deep-dives, and an honest list of what you couldn't validate.

This is not a market overview exercise. This is a "where do I bet the company" decision and the recommendation has to survive a board conversation.

## 2. Context: who I am and what we've built

Synthetos is a multi-tenant operations platform for AI agents, built over the last 18 months. The core architectural properties that matter for this research are:

- **Three-tier tenant isolation:** System → Org → Subaccount. Every agent run, every data store, every integration credential is isolated at the subaccount level. One customer can manage many isolated sub-entities (clients, locations, patients, matters, participants, portcos) without data crossing between them.
- **Agent runtime with approval gates:** Agents can read, draft, summarise, and act — but external customer-facing actions (sending emails, modifying records, executing transactions) can be approval-gated. Audit log on every action.
- **Out-of-the-box agents and workflows:** Pre-built skills covering customer success / churn detection, AI search visibility (GEO), portfolio intelligence, campaign optimisation, financial transcript analysis. The skill library is extensible.
- **Model-agnostic routing:** Each skill can route to the best LLM (Claude, GPT, Gemini, open-source) per task, with cost and latency optimisation.
- **Integration framework:** Managed connectors with OAuth flows, sync lifecycle (backfill → live), credential rotation, webhook verification.
- **Multi-tenant by design:** Org-level isolation is real engineering, not a feature flag.

The product is built. The architecture is real. What we don't have yet is a focused wedge with paying customers and a repeatable GTM motion.

I personally have prior operational experience in **healthcare, disability care, and pharmacy**. That is not a constraint on the research, but it is relevant: if a vertical scores highly *and* I have network in it, that materially increases its viability.

## 3. What I've already concluded (so you don't re-research it)

I've completed two prior research efforts on candidate wedges. Here is what they found, so you can use this as priors and not waste effort:

**Wedge 1: AI churn detection for B2B SaaS ($5M–$25M ARR).**
- Market: $2.1B–$2.7B (2025), CAGR 22–25%.
- Direct competitors: ChurnZero ($180M+ revenue, shipped 14 agentic AI agents Oct 2025, 80% engineering on AI), Vitally ($25M ARR estimate, "AI Copilot" rebrand 2025), Gainsight (Vista-owned, $200M+ ARR estimate, enterprise-only), Totango+Catalyst (merged Feb 2024, 600 customers, going upmarket), Pylon ($51M raised, 5x YoY growth, ICP overlap — biggest velocity threat).
- Verdict: GO-WITH-CONDITIONS, but the differentiation window is **6–9 months**, not 12–18. Year-5 ARR ceiling at 4–6% capture: $13M–$22M.
- Multi-tenant moat is "weak — all credible CSPs are already multi-tenant."
- AI-native is no longer differentiation; it is table stakes.

**Wedge 2: AI Operations Layer for operator-led holdcos and lower-mid PE.**
- Market: $260M–$420M annual addressable software spend at the recommended ICP.
- Direct competitors: Carta ("agentic ERP for private capital," ~$500M revenue, ListAlpha acquisition March 2026), Maestro (Accordion + S&P-backed, 1,000+ portcos, highest-probability attacker, 4–7 month time-to-ship a holdco SKU), Chronograph ($23M revenue, AI shipped April 2024), Asseta AI ($4.2M seed Nov 2025, multi-entity GL native — wildcard), Allvue ($63M revenue, Nexius platform), eFront (BlackRock-owned), iLEVEL (S&P), Cobalt (FactSet).
- Verdict: GO-WITH-CONDITIONS, but the central differentiator (multi-tenant agent isolation) was acknowledged as **"latent, not felt"** in operator interviews — the moat is theoretical. Year-5 ARR ceiling at 5% capture: $30M–$60M.
- Window: 6–9 months for narrative ownership before Maestro or Asseta extends down.
- Smaller business than the churn wedge, fragile central thesis.

**The pattern across both:**
- Both have 6–9 month windows, not 12–18.
- Both have Year-5 ceilings well below venture scale ($20M–$60M ARR).
- Both have weak structural moats (multi-tenant is table stakes; AI-native is closing fast).
- Both require long sales cycles (60–180 days) and founder-led motion.
- Neither is a "true edge" in the moat sense.

This is why I'm asking the third question: is there a **vertical PLG wedge** that produces a structurally better answer than either of these? That is the research mission.

## 4. The hypothesis I want you to test

> **There exists at least one regulated, fragmented, owner-operator-led vertical where (a) the buyer manages multiple isolated entities (locations, clients, patients, participants, matters), (b) the buyer is willing and accustomed to buy software online via self-serve, (c) the existing software stack is legacy non-AI-native, (d) compliance creates a defensive moat, and (e) AI agents can credibly own the full sales / marketing / support / ops cycle inside a 7-day onboarding — making it a structurally superior wedge for Synthetos than either churn-detection or portfolio-ops.**

Your job is to either (1) identify that vertical with sourced evidence and a clear ranking, or (2) refute the hypothesis (no vertical clears the bar, founder should commit to one of the prior two wedges or consider a different motion entirely).

The shape of wedge I'm looking for has six properties, all of which must be present:

1. **Multi-tenant native fit** — the buyer manages many isolated entities, so my three-tier isolation is structurally required, not a feature.
2. **PLG / self-serve sales motion** — the buyer signs up online, configures with templates, sees value within 7 days, no human sales call required for ACVs under ~$2,000/month.
3. **Agent-automatable end-to-end workflow** — the work itself (sales, marketing, support, intake, scheduling, documentation, billing) can be done by AI agents with approval gates, not just analysed.
4. **Acute regulatory or compliance moat** — compliance (HIPAA, state licensing, NDIS, DEA, etc.) creates a switching cost and a barrier that incumbents from above (HubSpot, Salesforce) cannot easily eat.
5. **Owner-operator buyer with budget** — the decision-maker is one person, has revenue, has felt pain, and will buy without a procurement committee.
6. **No AI-native winner has emerged yet** — incumbents are legacy systems-of-record, not agentic ops layers.

## 5. What's out of scope (do not waste research time here)

- **Hospitality / restaurants / hotels.** Saturated (Toast, Resy, Square, Lightspeed, OpenTable). Skip entirely.
- **Construction / general trades.** ServiceTitan, Jobber entrenched.
- **Pure consumer / DTC ecommerce.** Different motion.
- **B2B SaaS sold to other software companies.** Already covered.
- **PE / LP / fund operations.** Already covered.
- **Pure CRM / sales-tools horizontal.** HubSpot / Salesforce defended.
- **Generic agency platforms (the GoHighLevel territory).** Commodity.
- **K–12 / higher education core (LMS, SIS).** Slow procurement, RFP-driven, wrong shape.
- **Government / public sector.** Wrong stage.
- **Verticals where every customer-facing action requires human sign-off** (e.g., physician prescribing, attorney-client advice). Agents may draft, but if approval is mandatory on every touch, the time-savings collapse — those verticals are draft-only and don't deliver the wedge.

## 6. The 10 verticals you must evaluate

Score every one of these on the 12-criteria scorecard in §7. Do not drop verticals to save time. The whole point is the comparison.

1. **Independent and chain pharmacies** (US + AU + UK). Approximately 19,000 US independents, 5,500 AU, 12,000 UK. Subsegments: independent retail, compounding, specialty (oncology, fertility), online/mail-order, long-term-care pharmacy. Founder has prior operational experience here.
2. **Healthcare service organisations (DSOs, MSOs, specialty rollups).** ~250 DSOs in the US growing fast; PE rolling up at >$100B deployed in 5 years. Multi-location HIPAA mandatory.
3. **Disability care providers** — NDIS in Australia (~25,000 registered providers, undergoing major reform 2024–2026), Medicaid HCBS in the US (~31,000 home and community-based services agencies), direct payments / personal budgets in the UK. Founder has prior operational experience here.
4. **Veterinary practices.** ~30,000 US, ~8,000 UK, ~3,000 AU. PE consolidation accelerating (Mars/VCA, NVA, IVC Evidensia).
5. **Mental health / behavioural health practices.** ~600,000 US licensed professionals; growing telehealth segment; group practices 2–50 clinicians.
6. **Home care / aged care agencies.** ~31,000 US home care agencies; 12,000+ Medicare-certified home health. AU aged care undergoing 2024–2026 reform under new Aged Care Act and Support at Home programme.
7. **Allied health (physio, chiro, OT).** US ~38,000 physical therapy practices, ~70,000 chiropractic, ~17,000 OT. Jane App is the PLG benchmark to study.
8. **Optometry practices.** ~32,000 US; multi-location consolidation; ECP-specific software old (Crystal PM, RevolutionEHR).
9. **Specialty medical (medspas, dermatology, weight-loss / GLP-1 clinics).** Fastest-growing healthcare adjacency; cash-pay simplifies billing; viral consumer demand.
10. **Childcare / early learning centres.** Multi-location operators; state licensing; Procare and Brightwheel are the incumbents to study.

**Plus one wildcard slot:** identify any additional vertical you discover during research that scores 4+ on at least 8 of 12 criteria. Suggested places to look: compounding labs, blood collection centres, fertility clinics, cannabis dispensaries (legal states), independent insurance agencies, mortgage brokers, animal boarding/training/grooming chains, regulated trades with state licensing (electrical contractors, HVAC). If no wildcard clears the bar, say so explicitly.

## 7. The 12-criteria scorecard

Score every shortlisted vertical 1–5 on each criterion. A vertical that does not score 4+ on at least 8 of 12 should not be recommended.

| # | Criterion | What 5/5 looks like | What 1/5 looks like |
|---|---|---|---|
| 1 | **Multi-tenant architectural fit** | Buyer literally manages many isolated sub-entities; isolation is regulatory mandatory | Buyer is a single entity; multi-tenant is irrelevant |
| 2 | **Owner-operator buying motion** | One decision-maker, founder/owner/principal, signs up online | Procurement-led, 6+ month sales cycle, committee buyer |
| 3 | **PLG / self-serve readiness** | Industry already buys SaaS online with credit card; price expected to be public; <30-min sign-up norm | Industry expects sales call, custom pricing, 60-day implementation |
| 4 | **TAM at the ICP** | 20,000+ buying entities globally with median ACV $5k–$30k | <5,000 entities or median ACV <$2k |
| 5 | **Regulatory / compliance moat** | HIPAA / state-level / federal regulator that creates real switching cost and barrier | Light regulation, no certification required |
| 6 | **Agent-automatable workflow density** | 6+ daily workflows agents can credibly own (intake, scheduling, recall, billing, comms, compliance docs) | 1–2 workflows; rest are bespoke human work |
| 7 | **Existing software is legacy non-AI-native** | Incumbents are 10+ years old, on-premise legacy, monolithic, no agents shipped | Incumbents already shipped credible agentic AI |
| 8 | **Acute, felt pain (not latent)** | Owner can articulate the pain in their own words on Reddit / Facebook today | Pain is "abstract" or "would be nice to have" |
| 9 | **Online buyer-reach channels** | Reddit subs, Facebook groups, LinkedIn cohorts, podcasts, conferences are clearly identifiable | Buyer is anonymous or only reachable through associations |
| 10 | **7-day TTV feasibility** | Setup is templatable, integrations standardised, configuration <2 hours | Each customer is bespoke; integration is custom per buyer |
| 11 | **Embedded payments / billing potential** | Industry already pays for transaction-based features (booking, payments, billing) — Synthetos can take a payment cut | No transaction layer; pure subscription |
| 12 | **No AI-native incumbent winner yet** | No competitor with $10M+ ARR has won the AI-native operating system position | Clear AI-native winner already at scale |

## 8. Per-vertical research questions

For each of the 10 verticals (and the wildcard), produce structured answers to all of the following. Cite sources for every quantitative claim.

1. **Buyer count and shape:** Total buying entities globally and in US/UK/AU/EU. Median entity size (locations, employees, revenue). Owner-operator vs. PE-backed split. Independent vs. chain split.
2. **Pain inventory:** Top 5 daily operational pains. Source from Reddit subs, Facebook owner-operator groups, industry conference talk titles, and 1-star reviews of incumbent software on G2 / Capterra / Software Advice. Use real quotes.
3. **Existing software incumbents:** Top 5 by market share. For each: ARR if known, customer count, founding year, AI-product status (May 2026), pricing posture (PLG public / quote-based), G2 rating, top 3 G2 complaints.
4. **Buying motion:** Self-serve credit-card sign-up % vs. sales-call %. Typical sales cycle. Typical implementation time. Typical first-year ACV. Typical net revenue retention.
5. **Compliance posture:** Specific regulators, certifications, audit cycles. Required documentation. HIPAA / SOC 2 / state-specific licensing in play? Recent regulatory changes (2024–2026) creating buyer pain?
6. **Multi-tenant fit:** Is multi-entity isolation regulatory mandatory, regulatory recommended, or optional? Cite the regulation if mandatory.
7. **Agent-automatable workflows:** List 6+ end-to-end workflows agents could own (with approval gates where appropriate). Map each to a Synthetos OOTB skill or a 1–4 month build.
8. **Online reach channels:** Specific Reddit subs, Facebook groups (with member counts), LinkedIn groups, podcasts, conferences, newsletter sponsorships, paid ads platforms.
9. **Embedded payments potential:** Does the vertical already pay transaction fees? What % of GMV typically? What is the take-rate ceiling?
10. **AI-native competitor scan:** Find every AI-native startup targeting the vertical. For each: funding stage, ARR estimate, distribution claim, vertical sub-segment.
11. **Plausible 7-day TTV demo:** What does Day 0 → Day 7 look like for this vertical? Which OOTB Synthetos skills would be live? Which integrations would be required? What is the visible "win" the buyer sees on Day 7?
12. **3-year and 5-year ARR ceiling at 5% capture:** Bottom-up. Show the math.

For the priority verticals (pharmacy, healthcare, disability care), go deeper on:
- **Pharmacy:** PBM compression and DIR fees, prior authorisation workflows, controlled-substance reporting, AU PPA / 7CPA reforms, compounding and specialty subsegments, MTM (medication therapy management) automation potential, NCPA and Pharmacy Guild member channels.
- **Disability care / NDIS:** NDIS Quality and Safeguards Commission audit requirements, 2024–2026 reform package (Getting the NDIS Back on Track), plan reading and interpretation, progress-note compliance, NDIS Worker Screening Check, restrictive practice authorisations, intake screening, AU vs. US Medicaid HCBS comparison.
- **Healthcare service organisations:** Sub-segment "5–25 location operators pre-PE-rollup or just-rolled-up" specifically — too small for athenahealth/Epic, too big for single-practice software. Score this sub-segment separately from full PE-backed DSOs.

## 9. PLG playbook reference cases to study

For each of these, extract: ICP, ACV, time-to-value, key product wedge, current AI-native status, and gaps Synthetos could exploit. The recommendation must explicitly reference these case studies — what to steal, what doesn't apply.

- **Jane App** (allied health booking + EHR; founder-led; ~$50M+ ARR, Canada) — what made the PLG motion work?
- **SimplePractice** (mental health; acquired EngageSmart > Vista; ~$200M ARR estimate) — what is the moat now? Is AI shipped?
- **TherapyNotes** (mental health; bootstrapped; private)
- **WebPT** (physical therapy EHR; PE-owned; PLG-led-then-enterprise)
- **Brightwheel** (childcare ops; YC-launched; large-scale)
- **Procare** (childcare ops; established incumbent)
- **Mindbody** (wellness / fitness; Vista-owned; not AI-native)
- **Provet Cloud / ezyVet** (veterinary; modern stack; international)
- **Toast** (restaurants — referenced for PLG-then-payments playbook only; out of scope as a target)
- **ServiceTitan** (home services trades; IPO'd; "bottom-up to enterprise" arc)

For each: was multi-tenant architecture mandatory or coincidental? Did they capture embedded payments? Did the PLG motion break above $50M ARR? When did they hit AI shipping pressure? Are they vulnerable to an AI-native challenger today?

## 10. Sources you should consult

Aim for 50+ distinct sources. The recommendation must be defensible against citation challenge. Suggested places to look:

**Industry data and associations**
- *Pharmacy:* NCPA (National Community Pharmacists Association), Pharmacy Guild of Australia, GPhC (UK), PSA, CMS / Medicare pharmacy data, NACDS, Drug Topics, Pharmacy Times
- *Healthcare:* ADSO (Association of Dental Support Organizations), AMA, AHA, athenahealth ecosystem reports, ECRI Institute, McKinsey Healthcare reports
- *Disability care / aged care:* NDIS Quality and Safeguards Commission (AU), Department of Health and Aged Care (AU), CMS HCBS data (US), Care Quality Commission (UK), PHI National (US home care research), Aged Care Insite, McKnight's Senior Living
- *Veterinary:* AVMA, RCVS (UK), Australian Veterinary Association, VetPartners, Today's Veterinary Business
- *Mental health:* APA, NCBH, SAMHSA, Behavioral Health Tech reports, Out-Of-Pocket Health
- *Allied health:* APTA, ACA, AOTA, AOA
- *Childcare:* NAEYC, ChildCare Aware of America, Brightwheel research

**Software market intelligence**
- G2, Capterra, Software Advice, Software Suggest, GetApp, TrustRadius — vertical category leaders, customer reviews, pricing where disclosed
- PitchBook, Crunchbase, Tracxn — funding and ARR for AI-native challengers
- getlatka.com — ARR / customer counts where companies report
- Sacra — strategic profiles
- LinkedIn Sales Navigator — owner-operator buyer scan; recent (12-month) "Practice Owner" / "Pharmacy Owner" / "Head of Operations" job postings

**PLG playbook references**
- "Product-Led Growth" (Wes Bush), OpenView PLG benchmarks, Lenny's Newsletter PLG case studies
- Jane App founder interviews, SimplePractice / EngageSmart S-1, Brightwheel (YC) operator content
- Toast S-1, ServiceTitan S-1, Procore S-1 — vertical-PLG-then-enterprise arc

**AI vertical scan**
- a16z's AI healthcare landscape (most recent), Bessemer State of Cloud AI subsections, Sacra AI vertical reports
- AI in Healthcare newsletters, AI in Pharmacy press

**Buyer-voice sources (acute pain — most important category)**
- Reddit: r/pharmacy, r/optometry, r/psychotherapy, r/socialwork, r/Veterinary, r/dentistry, r/physicaltherapy, r/AusFinance (NDIS provider threads), r/specialed
- Facebook owner-operator groups (search for "[vertical] practice owners" — log member counts where possible)
- Industry-specific forums (PharmacyOwners.com, DentalTown, Veterinary Information Network)
- Capterra / Software Advice 1-star and 2-star reviews of incumbent software — these are the best pain quotes available

**Compliance and regulatory**
- HHS / OCR (HIPAA enforcement), CMS, DEA, state pharmacy boards, NDIS Commission, Aged Care Commission (AU), state nursing boards, NMC (UK)
- Recent (2024–2026) regulatory changes, audit cycles, certification requirements

## 11. The deliverable I want back

A single comparative memo with the following sections:

1. **TL;DR** (≤8 bullets, including the recommended vertical and the runner-up)
2. **Recommendation:** ONE vertical to commit to + a one-paragraph rationale + the conditions under which the recommendation should be reconsidered. The recommendation must be a single sentence that could go on a slide: *"Commit to [vertical], sub-segment [sub-segment], ICP [ICP shape], ACV [$X/month], motion [PLG / hybrid], because [one reason]."*
3. **Scorecard** (single table: 10 verticals + wildcard × 12 criteria, with 1–5 scores, total + ranking)
4. **Per-vertical deep-dive** (one section per vertical, answering all 12 universal questions in §8, plus the priority-vertical extra questions where applicable)
5. **Wildcard finding** (the additional vertical you identified, plus the criteria scores and rationale)
6. **PLG playbook synthesis** (what the case studies in §9 teach; what Synthetos must steal vs. what does not apply)
7. **Recommended wedge motion** for the top-ranked vertical (positioning, pricing tiers, pilot structure, channels, sequencing vs. churn / portfolio-ops wedges)
8. **Risks ranked** (competitive, structural, macro)
9. **30 / 60 / 90-day next moves** (numbered, with acceptance criteria for each)
10. **What could not be validated** (mandatory section — list every claim you could not source confidently)
11. **Sources** (markdown links, ≥40 distinct sources)

The output must be **comparative**, not a series of independent vertical reports. The point is to rank.

## 12. Quality bar

**Good looks like:**
- Every quantitative claim has a source link
- Every named incumbent has at least 6 data points (founded, ARR/rev, customers, last raise, AI status, G2 rating, top complaint)
- The scorecard is a single table where every cell has a score and a one-line justification
- The recommendation is for ONE vertical (not three) with explicit conditions for reconsideration
- The 7-day TTV demo is described concretely (Day 0, Day 1, Day 3, Day 7) for the recommended vertical
- The recommendation explicitly compares to the prior two wedges (churn, portfolio-ops) — is this better, why, by how much?
- Real owner-operator pain quotes (sourced from Reddit / G2 / Capterra) appear in the analysis
- The "what could not be validated" section is honest and specific

**Bad looks like:**
- Vague TAM ranges with no methodology
- "Healthcare is huge" without ICP-level math
- Recommending three verticals (the point is to *pick*)
- Missing the AI-native incumbent scan ("we couldn't find anyone" without sourcing the search)
- Marketing-tone copy
- Pretending PLG is easy in regulated verticals — own the friction and explain how it gets handled

## 13. Stop conditions (any single trigger forces a NO-GO recommendation)

Surface a NO-GO and recommend reverting to one of the prior two wedges if any of these hit:

- **No vertical scores 4+ on at least 8 of 12 criteria.** The hypothesis fails — there is no vertical that simultaneously meets the bar.
- **PLG buying behaviour is unverifiable in every regulated vertical evaluated.** If owner-operators in every shortlisted vertical require sales calls or local resellers, the online-PLG hypothesis fails and the wedge motion has to revert to founder-led sales.
- **Every shortlisted vertical has a credible AI-native incumbent at $10M+ ARR by May 2026.** The window is closed.
- **Approval-on-every-touch regulation makes agent autonomy uneconomic in every healthcare-adjacent vertical** evaluated. Synthetos is reduced to "draft and queue" which does not deliver the time-savings the wedge depends on.
- **CAC is structurally above LTV (12-month CAC payback)** at the recommended vertical's ACV. The PLG motion does not pencil.

If any single stop condition triggers, do not write a "GO" recommendation. Surface the blocker and explicitly recommend reverting to the churn or portfolio-ops wedge, with rationale. If two or more trigger, conclude that vertical PLG is not the right shape for Synthetos.

## 14. Final instruction

Use deep research mode. Take your time. Consult 50+ sources. Read actual customer reviews, not just analyst reports. Find real owner-operator pain quotes from Reddit and Facebook groups. Validate every quantitative claim. Be willing to surface a NO-GO if the evidence supports it.

The worst possible outcome is a memo that surveys options without picking one, or a "GO" recommendation that doesn't survive a board conversation. The best possible outcome is a single ranked recommendation backed by sourced evidence that I can act on this week.

Begin your research now.
