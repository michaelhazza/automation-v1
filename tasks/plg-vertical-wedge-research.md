# PLG Vertical SaaS Wedge — Executable Research Brief

**Date:** 2026-05-08
**Type:** Executable research prompt (hand to a fresh Claude / ChatGPT / Gemini session)
**Companion briefs:** `tasks/churn-platform-competitor-research.md`, `tasks/portfolio-ops-competitor-research.md`

---

## Sections

1. Mission
2. Background context
3. Strategic hypothesis to test
4. Evaluation framework (PLG-vertical scorecard)
5. Per-vertical research questions
6. Out of scope
7. Sources to consult
8. Deliverables
9. Quality bar
10. Assumptions to challenge explicitly
11. Output format expectations
12. Stop conditions

---

## 1. Mission

Identify the **single best vertical SaaS wedge** for Synthetos that simultaneously satisfies six conditions:

1. **Multi-tenant native fit** — the buyer manages many isolated entities (locations, clients, patients, matters, participants) so Synthetos's three-tier isolation is a structural requirement, not a feature
2. **PLG / self-serve sales motion** — the buyer signs up online, configures with templates, sees value within 7 days, no human sales call required for ACVs under ~$2k/month
3. **Agent-automatable end-to-end workflow** — the work itself (sales, marketing, support, intake, scheduling, documentation, billing) can be done by AI agents with approval gates, not just analysed
4. **Acute regulatory or compliance moat** — compliance (HIPAA, state licensing, NDIS, DEA, etc.) creates a switching cost and a barrier that incumbents from above (HubSpot, Salesforce) cannot easily eat
5. **Owner-operator buyer with budget** — the decision-maker is one person, has revenue, has felt pain, and will buy without a procurement committee
6. **No AI-native winner has emerged yet** — incumbents are legacy systems-of-record, not agentic ops layers

The output is a **comparative vertical-by-vertical scorecard** that lets the founder pick *one* vertical and commit. Not a deep dive on a single vertical. Not a list of "interesting markets." A ranked decision.

User has prior operational experience in **healthcare, disability care, and pharmacy** — these are priority verticals to evaluate but the scorecard should be unbiased.

**Hospitality is explicitly out of scope** — the operator believes it is saturated.

## 2. Background context

### What Synthetos is
Multi-tenant operations platform for AI agents. Three-tier isolation (System → Org → Subaccount). Out-of-the-box agents, OOTB workflows, model-agnostic routing, approval gates, integration framework. Full positioning in `docs/capabilities.md`.

### What this brief is reacting to
Two prior research efforts (`tasks/churn-platform-competitor-research.md` for B2B SaaS churn detection; `tasks/portfolio-ops-competitor-research.md` for AI Operations for Holdcos / lower-mid PE) returned honest "GO-WITH-CONDITIONS" verdicts — but the founder's read is that *neither produces a true structural edge*. Both wedges have:

- 6–9 month differentiation windows (not 12–18) because incumbents shipped agentic features in Q4 2024 – Q1 2026
- Long sales cycles (60–180 days)
- Multi-tenant moat acknowledged as "latent, not felt" in operator interviews
- Year-5 ARR ceilings of $20–60M — wedge-scale, not category-scale outcomes

The founder wants a different shape of wedge:
- **Online sales motion**: configure-and-go, AI agents handle inbound and onboarding, no AE required
- **Vertical depth**: a regulated industry where compliance becomes the moat
- **Multi-tenant architecture as core fit** — not a "feature buyers don't shop for"
- **7-day TTV is real**, because the vertical is templatable and the integrations are standardised
- **Agents do the work**, not just orchestrate it — sales, marketing, support, ops all agent-driven

This is the **Jane App / SimplePractice / ServiceTitan playbook crossed with agentic AI**: own a vertical, sell PLG, embed deeply enough that switching costs become structural.

### Initial assumptions (challenge these)
1. The shape of the right wedge is "vertical SaaS for owner-operators in regulated industries with compliance moats."
2. PLG vertical SaaS is winnable at $300–$2,000/month per location/practice/agency with 12–24 month CAC payback.
3. Healthcare-adjacent verticals (allied health, mental health, home care, vet, NDIS, pharmacy) have the right combination of regulation + multi-entity structure + owner-operator buyer.
4. Existing PLG vertical winners (Jane App, SimplePractice, WebPT, Mindbody) are *not* yet AI-native and have not yet shipped agentic operations layers.
5. Synthetos's OOTB agent runtime + skill system + integration framework can be re-pointed at a vertical's specific workflows in 2–4 months of focused engineering.

## 3. Strategic hypothesis to test

> **There exists at least one regulated, fragmented, owner-operator-led vertical where (a) the buyer manages multiple isolated entities (locations, clients, patients, participants, matters), (b) the buyer is willing and accustomed to buy software online via self-serve, (c) the existing software stack is legacy non-AI-native, (d) compliance creates a defensive moat, and (e) AI agents can credibly own the full sales / marketing / support / ops cycle inside a 7-day onboarding — making it a structurally superior wedge for Synthetos than either churn-detection or portfolio-ops.**

A successful brief either identifies that vertical with sourced evidence and a clear ranking, or refutes the hypothesis (no vertical clears the bar, founder should commit to one of the prior two wedges).

## 4. Evaluation framework (PLG-vertical scorecard)

### 4.1 Scoring criteria

Score every shortlisted vertical 1–5 on each of these 12 criteria. A vertical that does not score 4+ on at least 8 of 12 should not be recommended.

| # | Criterion | What 5/5 looks like | What 1/5 looks like |
|---|---|---|---|
| 1 | **Multi-tenant architectural fit** | Buyer literally manages many isolated sub-entities; isolation is regulatory mandatory | Buyer is a single entity; multi-tenant is irrelevant |
| 2 | **Owner-operator buying motion** | One decision-maker, founder/owner/principal, signs up online | Procurement-led, 6+ month sales cycle, committee buyer |
| 3 | **PLG / self-serve readiness** | Industry already buys SaaS online with credit card; price expected to be public; <30-min sign-up norm | Industry expects sales call, custom pricing, 60-day implementation |
| 4 | **TAM at the ICP** | 20,000+ buying entities globally with median ACV $5k–$30k | <5,000 entities or median ACV <$2k |
| 5 | **Regulatory / compliance moat** | HIPAA / state-level / federal regulator that creates real switching cost and barrier | Light regulation, no certification required |
| 6 | **Agent-automatable workflow density** | 6+ daily workflows agents can credibly own (intake, scheduling, recall, billing, comms, compliance docs) | 1–2 workflows; rest are bespoke human work |
| 7 | **Existing software is legacy non-AI-native** | Incumbents are 10+ years old, on-premise legacy, monolithic, no agents shipped | Incumbents already shipped credible agentic AI |
| 8 | **Acute, felt pain (not latent)** | Owner can articulate the pain in their own words on Reddit/Facebook today | Pain is "abstract" or "would be nice to have" |
| 9 | **Online buyer-reach channels** | Reddit subs, Facebook groups, LinkedIn cohorts, podcasts, conferences are clearly identifiable | Buyer is anonymous or only reachable through associations |
| 10 | **7-day TTV feasibility** | Setup is templatable, integrations standardised, configuration <2 hours | Each customer is bespoke; integration is custom per buyer |
| 11 | **Embedded payments / billing potential** | Industry already pays for transaction-based features (booking, payments, billing) — Synthetos can take a payment cut | No transaction layer; pure subscription |
| 12 | **No AI-native incumbent winner yet** | No competitor with $10M+ ARR has won the AI-native operating system position | Clear AI-native winner already at scale |

### 4.2 Vertical shortlist (must score every one)

The research output must score **all 10 of these** on the 12 criteria above, plus produce a ranked recommendation. Do not drop verticals to save time. The scorecard is the deliverable.

| # | Vertical | Why on the list |
|---|---|---|
| 1 | **Independent and chain pharmacies** (US + AU) | Founder operational experience; 19,000+ US independents; PBM compression creating acute pain; legacy software (PrimeRx, Liberty); compounding/specialty subsegments |
| 2 | **Healthcare service organisations / DSOs / MSOs** | Multi-location HIPAA mandatory; PE rolling up aggressively; existing software (Dentrix, Epic) old |
| 3 | **Disability care providers (NDIS in AU, Medicaid HCBS in US, direct payments in UK)** | Founder operational experience; ~25k NDIS providers in AU undergoing reform 2024–2026; ~31k US home care agencies; massive multi-tenant fit |
| 4 | **Veterinary practices** | 30k US, 8k UK; PE consolidation; client communication and recall pain; modern PLG players (Provet Cloud) but not AI-native |
| 5 | **Mental health / behavioural health practices** | 600k+ US therapists; SimplePractice / TheraNest are PLG winners but not yet agentic; HIPAA moat |
| 6 | **Home care / aged care agencies** | 31k+ US agencies; multi-client multi-caregiver multi-tenant fit; ageing population tailwind; legacy software (ClearCare, AlayaCare) |
| 7 | **Allied health (physio, chiro, occupational therapy)** | 38k US physio; Jane App is the PLG benchmark to study; AI-native opportunity adjacent |
| 8 | **Optometry practices** | 32k US; multi-location consolidation; ECP-specific software old (Crystal PM, RevolutionEHR) |
| 9 | **Specialty medical (medspas, dermatology, weight loss / GLP-1 clinics)** | Fastest-growing healthcare adjacency; cash-pay simplifies billing; viral consumer demand; existing tech weak |
| 10 | **Childcare / early learning centres** | Multi-location operators; state licensing compliance; Procare / Brightwheel are the incumbents to study |

The research output should also flag any **wildcard vertical** (one slot, §5.9) that emerges from the research and could displace one of the above on the scorecard.

### 4.3 Reference points (PLG vertical SaaS that already won)

For each, the executing session must extract: ICP, ACV, time-to-value, key product wedge, current AI-native status, gaps Synthetos could exploit. These are the case studies the recommendation must explicitly reference.

- **Jane App** (allied health booking + EHR; founder-led; ~$50M+ ARR, Canada) — what made the PLG motion work?
- **SimplePractice** (mental health practice management; acquired by EngageSmart, then Vista; ~$200M ARR estimate) — what is the moat now? Is AI shipped?
- **TherapyNotes** (mental health; bootstrapped; private)
- **WebPT** (physical therapy EHR; private equity-owned; PLG-led-then-enterprise)
- **Procare / Brightwheel** (childcare ops; Brightwheel is YC-launched, large-scale)
- **Mindbody** (wellness / fitness; Vista-owned; not AI-native)
- **Provet Cloud / ezyVet** (veterinary; modern stack; international)
- **Toast** (restaurants — referenced for PLG-then-payments playbook only; restaurants out of scope)
- **ServiceTitan** (home services trades; IPO'd; the "bottom-up to enterprise" arc to study)

For each: was their multi-tenant architecture mandatory or coincidental? Did they capture embedded payments? Did the PLG motion break above $50M ARR? When did they hit AI shipping pressure?

## 5. Per-vertical research questions

### 5.1 Universal questions (answer for every vertical)

For each of the 10 verticals in §4.2, produce structured answers to all of the following. Cite sources for every quantitative claim.

1. **Buyer count and shape:** Total buying entities globally and in US/UK/AU/EU. Median entity size (locations, employees, revenue). Owner-operator vs. PE-backed split. Independent vs. chain split.
2. **Pain inventory:** What are the top 5 daily operational pains? Source from Reddit subs, Facebook owner-operator groups, industry conference talk titles, and 1-star software reviews on Capterra/G2/Software Advice.
3. **Existing software incumbents:** Top 5 by market share. For each: ARR if known, customer count, founding year, AI-product status (May 2026), pricing posture (PLG public / quote-based), G2 rating, top 3 G2 complaints.
4. **Buying motion:** Self-serve credit-card sign-up % vs. sales-call %. Typical sales cycle. Typical implementation time. Typical first-year ACV. Typical net revenue retention.
5. **Compliance posture:** Specific regulators, certifications, audit cycles. What documentation is required to operate? Is HIPAA / SOC 2 / state-specific licensing in play? What recent regulatory changes (2024–2026) are creating buyer pain?
6. **Multi-tenant fit:** Is multi-entity isolation regulatory mandatory, regulatory recommended, or optional? Cite the regulation if mandatory.
7. **Agent-automatable workflows:** List 6+ end-to-end workflows agents could own (with approval gates where appropriate). Map each to a Synthetos OOTB skill or a 1–4 month build.
8. **Online reach channels:** Specific Reddit subs, Facebook groups (with member counts), LinkedIn groups, podcasts, conferences, newsletter sponsorships, paid ads platforms.
9. **Embedded payments potential:** Does the vertical already pay transaction fees? What % of GMV typically? What is the take-rate ceiling?
10. **AI-native competitor scan:** Find every AI-native startup targeting the vertical. For each: funding stage, ARR estimate, distribution claim, vertical sub-segment.
11. **Plausible 7-day TTV demo:** What does Day 0 → Day 7 look like for this vertical? Which OOTB Synthetos skills would be live? Which integrations would be required? What is the visible "win" the buyer sees on Day 7?
12. **3-year and 5-year ARR ceiling at 5% capture:** Bottom-up. Show the math.

### 5.2 Pharmacy-specific

- Independent pharmacies: ~19,000 US, ~5,500 AU, ~12,000 UK. Confirm with NCPA, Australian Pharmacy Guild, GPhC.
- Subsegments: independent retail, compounding, specialty (oncology, fertility), online/mail-order, long-term-care pharmacy
- Acute pains: PBM reimbursement compression, prior authorisation burden (DIR fees), 340B program complexity, declining margins, pharmacist labour shortage
- Existing tech: PioneerRx, PrimeRx, ComputerRx, Liberty, BestRx, Micro Merchant Systems, Korona POS, FrameworkLTC. None are AI-native.
- Subsegment to test: Are **PE-backed independent pharmacy networks** (e.g., Pharmacy Quality Alliance member groups, regional rollups like Genoa Healthcare, Optum's pharmacy network) a multi-tenant fit?
- AU specific: Pharmacy Programs Administrator (PPA) / 7CPA reforms, Webster pack workflows, S8 controlled substance handling, MyMedicare integration
- Agent automation candidates: prior auth, MTM (medication therapy management), refill outreach, adherence calls, insurance verification, controlled-substance reporting, vaccine scheduling
- Specifically validate: is the typical independent pharmacy buying online today? What % of NCPA members purchased their last software via self-serve vs. sales call?

### 5.3 Healthcare service organisations (DSO / MSO / specialty rollups)

- DSOs (Dental Service Organisations): ~250 in US per ADSO, growing to estimated 35% of dentists by 2025
- MSOs (Medical Service Organisations): primary care, urgent care, dermatology, GI, cardiology rollups
- Multi-location HIPAA mandatory; cross-location ePHI segmentation is a real audit item
- Existing tech: Dentrix Ascend, Open Dental, athenahealth, eClinicalWorks, Epic (enterprise only), NextGen
- AI-native scan: who is winning the "AI for DSOs" or "AI for MSOs" narrative? Recent funding (2024–2026)? Examples: Pearl AI (dental imaging — narrow), Dentem, Yapi, Modento, Weave (communications)
- Subsegment to test: **emerging operators with 5–25 locations** (pre-PE-rollup or just-rolled-up) are too small for athenahealth/Epic and too big for single-practice software
- Agent automation candidates: cross-location KPI roll-ups, prior auth, recall and reactivation campaigns, no-show recovery, treatment-plan acceptance follow-up, payor contract performance monitoring
- Pre-PE-rollup buyer is owner-operator and might fit PLG; PE-rollup buyer is enterprise and does not. Score both subsegments separately.

### 5.4 Disability care / NDIS / Medicaid HCBS

- AU NDIS: ~25,000 registered providers (NDIS Quality and Safeguards Commission); 2024–2026 reform package (Getting the NDIS Back on Track) creating compliance pressure
- US Medicaid HCBS: ~31,000 home and community-based services agencies (CMS); state-by-state variation
- UK direct payments / personal budgets (Care Act 2014): smaller, fragmented
- Acute pains: NDIS audit prep, plan reading and interpretation, progress note compliance, billing and claims, worker screening checks (NDIS Worker Screening Check), incident reporting, restrictive practice authorisations
- Existing AU tech: Lumary (Salesforce-based, large), ShiftCare, Brevity, Careview, Visicase, Carelink+, AlayaCare
- Existing US tech: Therap, ContinuLink, Brightree, AlayaCare (overlap with home care)
- AI-native scan: Are any AI-native NDIS providers shipping? Recent (2025–2026) AU AI healthtech raises?
- Subsegment to test: **sub-50-staff NDIS providers** undergoing 2024–2026 reform; high regulatory pain, owner-operator buyers, modest ACV ($300–$1,500/mo)
- Agent automation candidates: intake screening, plan reading, scheduling and rostering, progress notes (compliance-grade), invoice generation, NDIS portal claim submission, audit preparation
- Specifically validate: NDIS reform timeline 2024–2026, whether providers are actively switching software, what % buy online today

### 5.5 Veterinary practices

- ~30,000 US, ~8,000 UK, ~3,000 AU; PE consolidation rate (Mars/VCA, NVA, IVC Evidensia)
- Acute pains: client retention and recall, after-hours communications, prescription renewals, treatment-plan acceptance, staff scheduling
- Existing tech: ezyVet (Idexx), Cornerstone (Idexx), AVImark (Covetrus), Provet Cloud, Vetspire
- AI-native scan: Petriage, Otto (vet AI), VetCT, Digitail
- Subsegment to test: **independent multi-location practices (2–10 locations)** before PE acquisition
- Agent automation candidates: client recall, post-visit follow-up, prescription refill outreach, no-show recovery, treatment-plan acceptance follow-up, online booking conversion
- Specifically validate: Idexx/Covetrus distribution lock-in — is it possible to sell software in vet without going through them?

### 5.6 Mental health / behavioural health practices

- ~600,000 US licensed mental health professionals; growing telehealth segment; group practices 2–50 clinicians
- Existing tech: SimplePractice (~$200M ARR estimate, EngageSmart > Vista), TheraNest, TherapyNotes, Headway (insurance enablement, well-funded), Alma (similar)
- These ARE PLG winners. The question is: have they shipped AI agents that own intake, scheduling, billing, insurance verification?
- Subsegment to test: **group practices 5–25 clinicians** that have outgrown solo-practitioner tools but aren't enterprise
- Agent automation candidates: intake screening (PHQ-9, GAD-7), insurance verification, scheduling, claim submission, denial follow-up, no-show recovery, AI-assisted progress notes (with HIPAA-grade audit), supervision documentation
- Critical validation question: SimplePractice / TherapyNotes AI roadmap May 2026 — what have they shipped? If they've shipped agentic features at scale, this vertical may be closed.

### 5.7 Home care / aged care agencies

- ~31,000 US home care agencies; 12,000+ home health agencies (Medicare-certified)
- AU: ~3,500 aged care providers undergoing 2024–2026 reform (new Aged Care Act, Support at Home programme)
- Existing tech: AlayaCare, ClearCare (acquired by WellSky), Generations Homecare System, Caretime, Smartcare, Axxess, MatrixCare
- Multi-tenant fit: very high (multi-client × multi-caregiver × multi-shift)
- Subsegment to test: **independent agencies 50–500 caregivers** (above mom-and-pop, below WellSky enterprise customer)
- Agent automation candidates: intake assessment, caregiver-client matching, family communication, missed-visit recovery, EVV (Electronic Visit Verification) compliance, billing and claims, hiring and credentialing of caregivers
- Specifically validate: caregiver hiring agents — can an AI agent own the recruiting funnel for caregivers? This is one of the top-3 industry pains.

### 5.8 Allied health (physio, chiro, OT, optometry)

- Use **Jane App as the case study**: ICP, pricing, motion, current AI status. What did Jane do that won?
- US: ~38,000 physical therapy practices, ~70,000 chiropractic practices, ~17,000 OT practices, ~32,000 optometry practices
- Existing tech: Jane, WebPT, Heno, ChiroTouch, ChiroSpring, RevolutionEHR, Crystal PM
- Subsegment to test: **multi-location chains 3–15 locations** that have outgrown Jane and aren't ready for WebPT enterprise
- Agent automation candidates: insurance verification, prior auth, no-show recovery, recall, online booking conversion, intake form completion, billing and denial management, marketing review-collection
- Critical validation question: Jane App AI roadmap — when do they ship agents? Acquisition rumours?

### 5.9 Wildcard slot

The executing session is *required* to identify one additional vertical not on the §4.2 list that scores 4+ on at least 8 of 12 criteria. The wildcard is the safety valve to catch verticals the operator is not aware of.

Suggested places to look:
- Adjacent regulated services (compounding labs, blood collection centres, fertility clinics, cannabis dispensaries in legal states)
- Education-adjacent (childcare, early learning, after-school programmes)
- Allied retail-services (independent insurance agencies, mortgage brokers, financial planners with multi-client compliance)
- Animal-adjacent (boarding, training, grooming chains)
- Faith / non-profit sub-verticals
- Trades-adjacent regulated (electrical contractors, HVAC with state licensing, locksmiths)

The wildcard must be defensible against the 12 criteria. If no wildcard clears the bar, state so explicitly.

## 6. Out of scope

- **Hospitality / restaurants / hotels** — operator believes it is saturated (Toast, Resy, Square, Lightspeed, OpenTable). Do not score.
- **Construction / trades except where regulated** — ServiceTitan and Jobber are entrenched
- **Pure consumer products / DTC ecommerce** — different motion entirely
- **B2B SaaS sold to other software companies** — covered in churn brief
- **PE / LP / fund operations** — covered in portfolio-ops brief
- **Pure CRM / sales-tools horizontal** — HubSpot / Salesforce defended
- **Generic agency platforms (the GHL play)** — already considered; commodity
- **K–12 and higher education core (LMS, SIS)** — slow procurement, RFP-driven, wrong shape for PLG
- **Government / public sector** — wrong stage
- **Verticals where buyer cannot legally use AI agents to take customer-facing actions** (e.g., prescribing physicians, licensed-attorney advice) — agents may still draft and queue, but if approval is mandatory on every touch, the time-savings collapse

## 7. Sources to consult

### Industry data and associations

- **Pharmacy:** NCPA (National Community Pharmacists Association), Pharmacy Guild of Australia, GPhC (UK), PSA, CMS / Medicare pharmacy data, NACDS
- **Healthcare:** ADSO (Association of Dental Support Organizations), AMA, AHA, athenahealth ecosystem reports, ECRI Institute
- **Disability care / aged care:** NDIS Quality and Safeguards Commission (AU), Department of Health and Aged Care (AU), CMS HCBS data (US), Care Quality Commission (UK), PHI National (US home care research)
- **Veterinary:** AVMA, RCVS (UK), Australian Veterinary Association, VetPartners
- **Mental health:** APA, NCBH, SAMHSA, Behavioral Health Tech reports
- **Allied health:** APTA (physio), ACA (chiro), AOTA (OT), AOA (optometry)
- **Childcare:** NAEYC, ChildCare Aware of America, Brightwheel research

### Software market data

- G2, Capterra, Software Advice, Software Suggest, GetApp, TrustRadius — vertical category leaders, customer reviews, pricing if disclosed
- PitchBook, Crunchbase, Tracxn — funding and ARR for AI-native challengers
- getlatka.com — ARR / customer counts for software companies that report
- Sacra — strategic profiles
- LinkedIn Sales Navigator — owner-operator buyer scan; recent (12 month) "Head of Operations" / "Practice Owner" / "Pharmacy Owner" job postings

### PLG playbook references

- "Product-Led Growth" (Wes Bush), OpenView PLG benchmarks, Lenny's Newsletter PLG case studies
- Jane App founder interviews, SimplePractice / EngageSmart S-1, Brightwheel (YC) operator content
- Toast S-1, ServiceTitan S-1, Procore S-1 — vertical-PLG-then-enterprise arc

### AI vertical scan

- a16z's AI healthcare landscape (most recent), Bessemer State of Cloud AI subsections, Sacra AI vertical reports
- AI in Healthcare newsletters: Out-Of-Pocket, Emily Evans Healthcare-AI, Dave deBronkart
- AI in pharmacy: Pharmacy Times, Drug Topics
- AI in disability / aged care: Aged Care Insite (AU), McKnight's Senior Living (US)

### Buyer-voice sources (acute pain)

- Reddit: r/pharmacy, r/optometry, r/psychotherapy, r/socialwork, r/Veterinary, r/dentistry, r/physicaltherapy, r/Optometry, r/AusFinance (NDIS provider threads), r/specialed
- Facebook owner-operator groups (search for "[vertical] practice owners" / "[vertical] business owners" — log member counts)
- Industry-specific forums (PharmacyOwners.com, DentalTown, Veterinary Information Network)
- Capterra / Software Advice 1-star and 2-star reviews of incumbent software — these are the best pain quotes available

### Compliance and regulatory

- HHS / OCR (HIPAA enforcement), CMS, DEA, state pharmacy boards, NDIS Commission, Aged Care Commission (AU), state nursing boards, NMC (UK)
- Recent (2024–2026) regulatory changes, audit cycles, certification requirements

## 8. Deliverables

A single comparative memo, ~25–40 pages, in `tasks/plg-vertical-wedge-research-output.md`, with these sections:

1. **TL;DR** (≤8 bullets, including the recommended vertical and the runner-up)
2. **Recommendation:** ONE vertical to commit to + a one-paragraph rationale + the conditions under which the recommendation should be reconsidered
3. **Scorecard** (single table: 10 verticals × 12 criteria, with 1–5 scores, total + ranking)
4. **Per-vertical deep-dive** (one section per vertical, answering all 12 universal questions in §5.1, plus the vertical-specific questions in §5.2–5.9)
5. **Wildcard finding** (the additional vertical the executing session identified, plus the criteria scores)
6. **PLG playbook synthesis** (what the Jane App / SimplePractice / Brightwheel / Toast / ServiceTitan playbooks teach; specifically what Synthetos must steal vs. what does not apply)
7. **Recommended wedge motion** for the top-ranked vertical (positioning, pricing, pilot, channels, sequencing vs. churn / portfolio-ops wedges)
8. **Risks ranked** (competitive, structural, macro)
9. **30 / 60 / 90-day next moves** (numbered, with owners and acceptance criteria)
10. **What could not be validated** (mandatory section — list every claim that the executing session could not source confidently)
11. **Sources** (markdown links, ≥40 distinct sources)

The output must be **comparative**, not a series of independent vertical reports. The point is to rank.

## 9. Quality bar

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
- Marketing-tone copy ("Synthetos is uniquely positioned to...")
- Pretending PLG is easy in regulated verticals — own the friction and explain how it gets handled

## 10. Assumptions to challenge explicitly

1. **Is PLG actually credible in regulated verticals?** Mental health practices buy SimplePractice online — but did pharmacy buyers ever buy PrimeRx online? Did NDIS providers buy Lumary online? Validate the *industry buying behaviour* before assuming PLG works.
2. **Is multi-tenant isolation a felt pain in any of these verticals, or is it the same "latent" problem the portfolio-ops research surfaced?** Find owner-operator quotes on cross-entity isolation pain *specifically*. If the answer is "no operator articulates this," the moat collapses.
3. **Can AI agents actually own customer-facing actions in regulated verticals, or is approval-on-every-touch mandatory?** If a pharmacist must sign off every refill outreach, the time-savings collapse and Synthetos sells "draft + queue" — a much weaker pitch than "agents do the work."
4. **Are the existing PLG winners (Jane App, SimplePractice, Brightwheel) about to ship credible AI agents themselves?** If so, the AI-native window in their vertical is already closed.
5. **Is 7-day TTV actually achievable in the recommended vertical, or is configuration intrinsically vertical-specific and ~30 days?** Validate by mapping Synthetos's current OOTB skills against the vertical's required workflows.
6. **Is the buyer reachable online at acceptable CAC?** Mental health: yes (well-trodden). Independent pharmacy: maybe. Healthcare service organisations: probably not. Vet: medium. Validate per-vertical with ad-platform research and Reddit / community membership data.
7. **Is the founder's personal experience in healthcare / disability care / pharmacy actually a sales advantage, or only a knowledge advantage?** If the network is in pharmacy, that changes the recommendation. State this explicitly.
8. **Should the wedge be a sub-segment (e.g., compounding pharmacy specifically; group practices 5–25 clinicians specifically) rather than a whole vertical?** Sub-segment wedges are usually sharper. Force the recommendation to one sub-segment.
9. **Is there an opportunity to *be* the multi-tenant agent runtime that the existing PLG winner integrates with**, rather than competing with them? Brief explore-only — not the primary recommendation but worth flagging.

## 11. Output format expectations

- Markdown
- All claims sourced (footnote-style or inline links)
- Concrete numbers preferred over ranges where possible
- Tables for the scorecard and competitor comparisons
- Executive summary readable in 90 seconds
- Full memo readable in 30 minutes
- No marketing tone. No hedging. State what is true, what is uncertain, and what would change the answer.
- The recommendation must be a single sentence that could be put on a slide: "Commit to **[vertical]**, sub-segment **[sub-segment]**, ICP **[ICP shape]**, ACV **[$X/mo]**, motion **[PLG / hybrid]**, because **[one reason]**."

## 12. Stop conditions

Stop and report a NO-GO (commit to one of the prior two wedges) if any of these conditions are hit:

- **No vertical scores 4+ on at least 8 of 12 criteria.** The hypothesis fails — there is no vertical that simultaneously meets the bar.
- **PLG buying behaviour is unverifiable in every regulated vertical evaluated.** If owner-operators in every shortlisted vertical require sales calls or local resellers, the online-PLG hypothesis fails and the wedge motion has to revert to founder-led sales.
- **Every shortlisted vertical has a credible AI-native incumbent at $10M+ ARR by May 2026.** The window is closed.
- **Approval-on-every-touch regulation makes agent autonomy uneconomic in every healthcare-adjacent vertical** evaluated. Synthetos is reduced to "draft and queue" which does not deliver the time-savings the wedge depends on.
- **CAC is structurally above LTV** (12-month CAC payback) at the recommended vertical's ACV. The PLG motion does not pencil.

If any single stop condition triggers, do not write a "GO" recommendation. Surface the blocker and explicitly recommend reverting to the churn or portfolio-ops wedge, with rationale.

If two or more stop conditions trigger, the strategic conclusion is that **vertical PLG is not the right shape for Synthetos**, and the founder should pick between the two prior wedges or consider a fundamentally different motion (services-as-software, platform/infrastructure play, or smaller profitable business).
