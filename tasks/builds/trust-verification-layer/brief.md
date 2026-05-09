# Brief: Trust & Verification Layer

**Status:** Draft for stress-testing (mockups round 4 complete)
**Owner:** Product
**Date:** 2026-05-07 (last updated 2026-05-08)

---

## Table of contents

1. What we're doing
2. What we're trying to achieve
3. Why we're doing it
4. Why this is important now
5. How we will approach this
6. What we are looking at building
   - Layer 1: Skill verification
   - Layer 2: Agent scorecards
   - Layer 3: Correction memory
7. Staged development process
8. What this is not
9. Open questions to stress-test
10. Success metrics
11. Mockups
12. Directives for the spec phase

---

## 1. What we're doing

Adding a three-layer trust and verification system to Synthetos so agents can do more work autonomously without a human reviewing every output.

The three layers, in the order we will build them:

1. **Skill verification.** Every skill declares a deterministic check that runs after the action: did it work mechanically?
2. **Agent scorecards.** Each agent gets one or more scorecards: LLM-judged quality dimensions ("on-brand tone", "no hallucinated numbers"), sampled across runs, with a built-in model bench so we can compare quality across models for the same task.
3. **Correction-sourced auto-memory.** When a user corrects an agent output, the correction is captured as a high-signal entry in the existing auto-memory pipeline. It surfaces on the existing Knowledge page using the existing `Edit and override` and approve / reject actions. No new memory primitive, no new top-level surface.

These three layers are complementary, not competing. Skill verification answers "did it work?" Scorecards answer "was it good?" Correction-sourced auto-memory answers "what did the user actually want?"

## 2. What we're trying to achieve

A clear, measurable lift in autonomous output quality, so the operator spends less time reviewing routine work and more time on the items that genuinely need judgement.

Concrete success looks like:

- Operator can confidently let an agent run unsupervised on a class of task because the platform tells them, with evidence, that the agent meets a quality bar.
- When an agent's quality drops over time (model drift, edge-case data, prompt rot), the platform notices before the operator does.
- The operator can answer "should this skill run on Sonnet or Opus?" with data instead of guessing.
- A correction the operator makes once does not have to be made again.

## 3. Why we're doing it

Two reasons, one philosophical and one operational.

**Philosophical.** The frontier-product debate is shifting from "can the agent click the button?" to "does the agent understand what the button means?" Access is largely solved. The next moat is the *semantic meaning of work* (what an action touches, who's affected, what counts as success) plus *verification* (how do we know the result is good). Synthetos already exposes capabilities, but today's capabilities tell agents *what they can do*, not *what good looks like*. This brief closes that gap.

**Operational.** The biggest blocker to scaling agent fleets is the human-in-the-loop tax. An operator cannot oversee 20 agents the way they oversee 2. Without a verification layer, every output needs a human check, and per-agent leverage collapses. With a verification layer, the operator manages by exception, intervening only when scorecards flag drift or correction memory surfaces a pattern.

## 4. Why this is important now

Three converging signals:

1. **Models are good enough that quality of output now depends mostly on context and feedback loops, not raw model capability.** Adding verification structure compounds with every model upgrade we do not control.
2. **Competing platforms are racing to make their work primitives semantically legible.** HyperAgent ships rubrics, Salesforce 360 leans into semantic agent access, Perplexity is moving from search to workflow. Synthetos is well placed because we already model skills as first-class. Adding verification puts us ahead of platforms that have rich UX but shallow semantics.
3. **Cost pressure.** The operator pays for tokens. Without scorecards, there is no principled way to know whether dropping a skill from Opus to Sonnet hurts quality. With scorecards, that decision is data-driven and the savings are real.

## 5. How we will approach this

Three principles for the build:

1. **Layer one is required, layer two is optional, layer three is automatic.** Every skill must ship a runtime check. Scorecards are opt-in per agent because not every agent role benefits and the eval cost is real. Correction memory runs in the background whenever a user takes a corrective action, so the operator does not have to remember to use it.

2. **Deterministic checks before LLM judgement.** Runtime checks should be code, not prompts, wherever possible. Scorecards use LLM-as-judge but only after the deterministic layer has passed. We do not want a model judging whether an API call succeeded, that is a structural fact.

3. **Trust is earned through observation, not declared by developers.** No skill or agent gets a "trusted" flag based on developer assertion. Trust accrues through observed scorecard performance over time. This is the part that lets us eventually graduate skills to higher autonomy tiers without the operator having to make that call manually.

## 6. What we are looking at building

### Mental model (one-sentence-per-primitive)

The Trust & Verification Layer is six primitives that play different roles in the same loop. The operator should be able to answer "what is this layer doing?" in one breath:

| Primitive | What it is | Role in the loop |
|---|---|---|
| **Skills** | What the system can do | The unit of action. Carries a runtime check + blast radius + reversibility. |
| **Runtime checks** (Layer 1) | Per-step deterministic enforcement of correctness | "Did the action mechanically work?" |
| **Scorecards** (Layer 2) | How quality is measured | Named LLM-judged checks attached to an agent: "was the output good?" |
| **Model bench** (Layer 2) | Quality / cost comparison harness | "Which model meets the quality bar at the lowest cost?" |
| **Corrections** (Layer 3) | Human feedback that improves future behaviour | The operator's edit on a step output, captured as high-signal memory. |
| **Knowledge / memory** | What the system knows | Where corrections, prior decisions, and approved guidance are stored and retrieved. |

The loop: Skills act → Runtime check enforces correctness → Scorecards measure quality on a sample → Drift triggers a Bench → Operator corrects what's wrong → Knowledge captures the correction → Next run is better. Every screen in this brief sits at one of those stations.

### IA alignment

The recent four-spec consolidation (Foundation / Operate / Build / Govern) reduced ~25 pages to ~12. This brief rides that IA. It does not introduce a new top-level surface.

| Layer | Where it surfaces | Why there |
|---|---|---|
| Skill verification | **Operate / Run-trace** — pass / fail badge per step. Failed runtime checks also feed Inbox. | The runtime check is a per-step run signal. Operate already owns the run-time observation surface. |
| Agent scorecards (and model bench) | **Govern / Quality** (new fourth Govern primitive alongside Knowledge / Spending / Connections). Scorecard *configuration* lives on Build / Agent edit. | Govern answers "what does the platform know about itself." Quality fits naturally as a sibling of Knowledge / Spending. Configuration belongs to the agent it's attached to, which lives on Build. |
| Correction-sourced auto-memory | **Operate / Run-trace** for the in-context "Correct" action. **Govern / Knowledge** for the resulting auto-memory entries (existing surface, with a new "Source: from corrections" filter). | Capturing happens where the operator already sits looking at the run. Reviewing happens where they already manage knowledge. |

No new top-level page. No new memory primitive. The operator sees a small new action ("Correct") at the step level on Run-trace, and a new filter on the existing Knowledge page.

### Layer 1: Skill verification

Three new fields on every skill in the capabilities registry:

- **`verify`** — a function or small inline check that runs immediately after the skill action, returns pass / fail / inconclusive, and captures the reason. Examples: row exists with the expected shape, external API returned 2xx, file written matches the schema, calendar event landed on the requested day.
- **`reversible`** — boolean, declares whether the action can be undone. Used by the agent loop to decide whether to ask before acting.
- **`blast_radius`** — enumerated label (`self` | `tenant` | `external`) declaring who else is affected. Used to decide whether scorecards apply, whether approval is required, and whether the action is logged at a higher tier.

Skills that genuinely cannot define a runtime check declare `verify: null` with a written justification. This is a flag, not a blocker, but the count of `verify: null` skills is a quality metric we will track.

**A failed runtime check is not always a hard stop.** Failure handling depends on `blast_radius` and action type. For self-scoped or reversible actions, a failure is informational: surfaced on Run-trace, fed to Inbox, and the agent loop is permitted to continue or retry. For external-blast-radius or irreversible actions, a failure is blocking: the agent loop pauses pending operator approval. The exact decision matrix lives in the spec.

**Who authors runtime checks:**

- **System skills.** Platform team authors the runtime check when shipping the skill. Ships baked in.
- **Custom skills (org or subaccount).** When an admin adds a custom skill, the platform proposes a runtime check based on the skill's API spec or tool description (LLM-suggested). The admin reviews and chooses: accept, edit, or mark "no deterministic check possible" with one-line justification.
- **Two-stage suggestion.** The creation flow opens with a single big description field ("Describe what this skill does") and a **Suggest details** action. The platform fills name, blast radius, reversibility, and a draft runtime check from that description. The admin reviews and edits before saving. A **Re-suggest** affordance is available if the description changes.
- **Plain English first.** The proposed check is shown in operator-readable form ("Did the API return a 2xx response?"). The actual implementation lives in an "Advanced" disclosure for technical users.
- **Scope-aware operator copy.** `blast_radius` values use plain-English explanations with examples in operator UI. The internal label `tenant` is written as **this account** in operator-facing copy; the word "tenant" does not appear in operator UI.
- **Mandatory at creation.** A custom skill cannot be saved without either a confirmed runtime check or an explicit "no deterministic check possible" with justification. This is the only way coverage holds at scale.

### Layer 2: Agent scorecards

Scorecards are first-class library objects, not properties of an agent. An agent attaches one or more scorecards by reference. Each scorecard contains a small set (typically 3-5) of named **quality checks**, each with a description the judge model uses to score and a **pass mark** (shown to operators as a percentage, stored as 0-1 internally).

**Scorecards are directional signals, not objective truth.** A scorecard score is a model-based, probabilistic, evaluative judgement. It helps operators detect trends, regressions, and outliers; it does not replace human judgement on high-stakes work. Operators should treat "agent scored 82% this week" as evidence to investigate, not as a verdict.

**Pass mark reference data.** When an operator authors a quality check, the form shows a small reference note below each pass mark input ("Similar checks: 76-92%" or "No reference data yet" for novel checks). This calibrates the operator without forcing them to know the domain ahead of time. Reference data is computed from observed pass marks on similar checks across the fleet.

**Library and scoping.** Scorecards live in a unified library, surfaced as a tab on Govern / Quality. The library spans three scopes:

- **System** — platform-shipped, available everywhere. Read-only to org and subaccount admins.
- **Organisation** — created by the org admin. Visible to org-level agents and (by default) to subaccounts in the org.
- **Subaccount** — created by a subaccount admin. Visible only inside that subaccount.

Each library row carries a **Source** pill so operators see at a glance what they own versus what they inherit. The pill compresses depending on viewer scope to reduce cognitive load:

- **At sub-account scope:** two values, **Platform** and **Custom**. The Custom pill tooltips the actual owning scope (Organisation or This subaccount) on hover. Sub-account operators rarely care which authority above them shipped a scorecard, only whether they can edit it.
- **At org-admin scope:** three values, **System / Organisation / This subaccount**. The full distinction matters because it controls editing rights and visibility toggles.

**Visibility, controlled by one toggle.** Every scorecard row has a single **"Share with sub-accounts"** toggle.

- For System scorecards viewed at org scope, default on. Org admin can turn off to hide that scorecard from their subaccounts.
- For Organisation scorecards, default on. Org admin can turn off to keep it org-internal.
- Subaccount scorecards do not show the toggle (subaccount-only by definition).

This is the only visibility primitive we ship. No fork tracking, no diff, no version pinning UI. If an admin wants to customise a scorecard, they **Duplicate** it (independent copy at their scope) and edit the copy.

**Multi-attach.** An agent has a list of attached scorecards. Each is scored independently and tracked independently. Trend views and drift detection split by scorecard, so an operator can tell that "tone match" is fine but "factual grounding" is drifting.

**Three authority levels at attach time.** Scorecards land on an agent under one of three authorities, displayed differently to different viewers:

- **System-mandatory.** Shipped with a System Agent. Always attached, cannot be removed or edited at any scope below platform.
- **Org-mandatory.** Designated by an org admin. Always attached on every agent in that org's subaccounts; cannot be removed by sub-account operators.
- **Suggested.** Proposed by the platform or by the org. Default-on, but the operator can uncheck before saving and detach later.

**At sub-account scope, system-mandatory and org-mandatory render identically** as a locked **Required** row with a lock icon and an expandable caret revealing read-only quality check details. The sub-account operator cannot remove either, so distinguishing the source of the requirement is noise. The distinction surfaces only at org-admin scope, where the org admin can edit org-mandatory scorecards but not system-mandatory ones.

**At sub-account scope, the Suggested rows drop source attribution.** The operator does not see "Platform-suggested" vs "Organisation-suggested" labels; the rows simply read "Suggested." The org-admin scope keeps the full attribution because that distinction guides edit rights.

**System agent + agent template integration.** Both existing platform primitives extend with scorecard fields, mirroring how skills already inherit:

- `system_agents` gets `default_system_scorecard_slugs` (system-mandatory, always attached) and `default_org_scorecard_slugs` (suggested at install, org admin can keep / swap / remove / promote to org-mandatory).
- Org admin scope adds `org_mandatory_scorecard_slugs` at the organisation level. Scorecards in this list are always attached to every agent in every subaccount in the org and render as Required at sub-account scope.
- `agent_templates` gets `default_scorecard_slugs` (suggested when creating a new agent from a template).

When an admin installs a System Agent or creates from an Agent Template, the recommended scorecard set is pre-attached: any system-mandatory and org-mandatory scorecards as locked Required rows (each expandable to inspect read-only quality checks), suggested scorecards as default-on checkable rows. The operator confirms or edits before saving.

**How often to grade.** Operator-configured per agent via a four-step **quartile control: Off / 25% / 50% / 75%**. Default 25%. Anything flagged by a Layer 1 runtime check failure or by an operator correction is graded regardless. **100% sampling is intentionally excluded:** if every run truly needs grading, the right answer is a stricter scorecard, not 100% sampling — sampling exists to bound judge cost.

**Trend view.** Per scorecard, per quality check, a time series the operator can scan in seconds. The headline question: "Is anything getting worse?"

**Model bench.** A separate operator-triggered workflow on Govern / Quality. Pick an agent (agent bench) or a specific skill (skill bench), pick candidate models, pick a sample count, point at test inputs. Each candidate is scored against the agent's attached scorecards. Output: a comparison table with mean score, variance, latency, cost, **regression risk** (a Low / Medium / High indicator derived from observed score variance — high variance means inconsistent outputs and elevated risk of edge-case regressions), and a composite (cheapest model that clears every pass mark *and* shows acceptable stability wins). Operator approves the recommended default before it takes effect.

Test-input affordances:

- **Recent real runs (default).** Multi-selectable list with quick-pick affordances (e.g. "Pick newest 15", "Clear all"). Most honest signal because it replays real production work.
- **Paste-in set.** Defaults to **one prompt card**. Operator clicks **Add Prompt** to grow the set. Each card supports a multi-line textarea for long prompts. This avoids the friction of starting with multiple empty cards the operator has to close before pasting.

**Cost transparency.** Estimated bench cost is shown up front, labelled with the billing scope (**"charged to this account's token budget"**), and the operator confirms before the bench fires. No autonomous benching without explicit operator action.

**Regression detection.** When a provider ships a new model version, the bench can be re-run automatically against previously approved configurations. A score drop past a threshold pings the operator once.

### Layer 3: Correction-sourced auto-memory

Not a new memory system. A new capture trigger plus two small UX hooks, feeding the existing auto-memory pipeline and the existing Knowledge surface.

**Existing primitives we ride on (no changes needed to the core schema):**

- `memory_blocks.capturedVia` already supports `'manual_edit' | 'auto_synthesised' | 'user_triggered' | 'approval_suggestion'`. We add one enum value: `'operator_correction'`.
- `memory_blocks.status` already covers `pending_review` / `in_use` / `ignored`.
- The Knowledge page already exposes `Edit and override`, approve, and reject actions on auto-memory entries with provenance + confidence.
- The auto-synthesis pipeline (memory spec S11) already promotes recurring high-quality entries to memory blocks via the existing review queue.

**What we add:**

- **In-context "Correct" action on Run-trace step outputs.** When the operator clicks it, we open a small dialog: edited output + optional reason. The system writes a memory entry tagged `capturedVia: 'operator_correction'`, scoped to the skill/agent that produced the step, with quality score boosted (high-signal). If a scorecard is attached to the agent, the corrected output is auto-evaluated to confirm the correction actually clears the floor.
- **The Correct dialog explicitly shows three things before the operator confirms** — so corrections never feel like sending data into a black box:
  - **Scope:** "This agent only" (default) — corrections do not silently bleed across agents.
  - **Persistence:** "Active on next run" — the entry is immediately available to memory retrieval. If a pattern is later detected (N similar corrections clustering), the system promotes it to a memory block at `pending_review` and the operator approves through the existing HITL queue.
  - **Confidence / reviewability:** "High signal — applied immediately, but listed under Knowledge → Source: from corrections where you can edit, override, or reject."
- **"Source: from corrections" filter on Knowledge page.** Operators can find correction-sourced entries quickly without leaving the existing page.
- **Each correction-sourced entry exposes provenance** so memory feels like an auditable system, not a hidden one. A row drawer surfaces: source run (linkable), trigger event (the corrected step), time captured, last used, usage frequency (count of retrievals in the last 30 days), attached agents, confidence tier, and whether the entry is human-approved or pattern-inferred. Existing `Edit and override` / approve / reject controls remain on the row.
- **Pattern-detector hook into S11.** When N corrections (default 3) cluster on the same skill/agent/dimension within a window, the existing auto-synthesis pipeline promotes them to a memory block at `status: pending_review`, `confidence: low`. Operator approves through the existing HITL queue. Optionally, the pattern detector also surfaces a scorecard suggestion ("operators keep correcting tone, consider tightening `tone_match` floor").

**Scope.** Per tenant, per agent. Existing decay, supersession, recency, and tenant-isolation guarantees on the memory subsystem apply. We add nothing new to those rules.

## 7. Staged development process

We do not build all three layers at once. Each stage delivers value on its own and creates the substrate for the next.

### Stage 1: Skill verification (foundational)

- Add the three new fields (`verify`, `reversible`, `blast_radius`) to the capabilities registry schema. The schema field stays named `verify`; the operator-facing concept is the **runtime check**.
- Write runtime checks for the top 20 most-used system skills. Document the pattern.
- Build the **suggested runtime check** flow for custom skill creation (org and subaccount). Plain-English first, code in advanced disclosure, mandatory at save (or "no deterministic check possible" with one-line justification).
- Add a registry-level lint rule: skills shipping without a runtime check must declare `verify: null` with justification.
- Surface runtime check results on Run-trace step rows. Operator-facing badge has **three states: Pass / Fail / Pending**. Pending covers both async checks still running and skills with no deterministic check (`verify: null`). Fewer states means faster recognition. Failed runtime checks feed Inbox.

**Exit criteria:** every new skill PR (system, org, or subaccount) carries a runtime check or a justified null, and the operator can see runtime check results inline on Run-trace.

### Stage 2: Agent scorecards + library + model bench

- Add the **scorecard** resource with three-scope ownership (system / org / subaccount). Every scorecard carries `share_with_subaccounts` (boolean, default on for system and org scopes).
- Add the **scorecard library** as a tab on Govern / Quality, showing System / Org / Subaccount scorecards with Source pills, attach counts, and the Share-with-subaccounts toggle on system and org rows.
- Add **multi-attach** on agents: an agent has an ordered list of attached scorecard ids.
- Extend `system_agents` with `default_system_scorecard_slugs` (hidden, always attached on install) and `default_org_scorecard_slugs` (suggested at install).
- Extend `agent_templates` with `default_scorecard_slugs` (suggested at agent creation).
- Build the **scorecard creation form** (blank or pre-filled from Duplicate). Quality checks expressed as name + description + pass mark (operator-facing as percentage).
- Build the sampled judge runner. Quartile control (Off / 25% / 50% / 75%), default 25%, configurable per agent. 100% sampling intentionally excluded.
- Build the **Agents** tab on Govern / Quality (drift list with sparklines and per-scorecard trend drawer).
- Build the **model bench** workflow on Govern / Quality. Modes: Agent bench (uses recent real runs as test inputs by default), Skill bench (uses recent invocations of one skill). Test-input picker supports paste-in for cold starts.
- Wire regression detection: re-run the bench against approved configurations on provider model updates.

**Exit criteria:** an admin at any scope can browse the library, attach one or more scorecards to an agent, see scoring trends per scorecard on Govern / Quality, and run a bench to pick a model with confidence. Org admins can hide system scorecards from their subaccounts using the single Share-with-subaccounts toggle.

### Stage 3: Correction-sourced auto-memory

- Add the `'operator_correction'` value to `memory_blocks.capturedVia`. No schema migration of consequence (enum extension only).
- Ship the in-context "Correct" action on Run-trace step outputs (Operate surface).
- Ship the "Source: from corrections" filter on the existing Knowledge page (Govern surface).
- Wire pattern detection into the existing auto-synthesis pipeline (memory spec S11). When N corrections cluster, promote to a memory block at `pending_review`.
- Optional: when a scorecard is attached, surface a "tighten `dimension_X`" suggestion as a non-blocking nudge.

**Exit criteria:** an operator who corrects the same mistake twice on Run-trace sees the correction reflected in the third run automatically (via memory injection), and the platform proposes a scorecard or memory-block update when a pattern is clear. No new pages were added; the surfaces are Run-trace and Knowledge.

**Upstream dependencies:** memory spec S7 (confidence-tiered HITL) and S11 (auto-synthesis from recurring entries) ideally land first. If they have not, Stage 3 implements a minimal pattern-detector inline rather than blocking.

## 8. What this is not

To keep scope honest:

- **Not auto-routing.** A meta-model that picks the right model per task at runtime is interesting but premature. We start with operator-approved bench results setting the default. Auto-routing is a possible Stage 4.
- **Not a replacement for human review on high-stakes work.** Scorecards reduce routine review, they do not eliminate review on actions with external blast radius (sending money, contacting customers, deploying code).
- **Not a generic eval harness for arbitrary workflows.** The scope is Synthetos agents and skills. We are not building a standalone product.
- **Not a behavioural change to existing skills.** Stage 1 adds metadata only. Existing skill behaviour is unchanged unless the runtime check fails, in which case the agent loop already has a "what to do on failure" path we extend, not replace.
- **Not a first-class Policy primitive.** Allowed-action lists, forbidden-action lists, approval thresholds, escalation rules, budget policies, and compliance-rule objects are out of scope for this layer. Action-level invariants are captured implicitly via `blast_radius` + runtime checks. A dedicated Policy primitive (with its own UX, approval mechanics, and audit trail) is a separate brief, candidate for Stage 4 once this layer's data shows where the gaps are.

## 9. Open questions to stress-test

1. **Where does the runtime check actually run?** In-process with the skill (fast, tight coupling) or as a separate post-action job (slower, cleaner)? Probably in-process for synchronous skills and post-action for long-running ones, but worth deciding before the schema lands.
2. **How do we keep judge cost bounded?** A 25% default sample rate is the starting point (quartile control: Off / 25% / 50% / 75%, 100% intentionally excluded). Adaptive rates that lower sampling on stable agents and raise it on drifting ones are interesting but not in Stage 2.
3. **How does the bench handle prompt portability?** A prompt tuned for Opus may unfairly disadvantage Sonnet. Stage 2 ships with same-prompt benching (most honest as a real-world test). Auto-prompt-adaptation is a possible Stage 4 if scores look unfair in practice.
4. **Scorecard scoping, resolved.** Three scopes (System / Organisation / Subaccount), one library, one **Share with sub-accounts** toggle on system and org rows. No fork tracking, no diff. Customisation is done via Duplicate. Subaccounts can create their own scorecards (full autonomy). Source pill compresses to **Platform / Custom** at sub-account scope (Custom tooltips actual scope on hover), expands to **System / Organisation / This subaccount** at org-admin scope where the distinction governs editing rights. Three authority levels at attach time: system-mandatory, org-mandatory, suggested. At sub-account scope, system-mandatory and org-mandatory render identically as a locked Required row (caret-expandable to inspect read-only quality checks); the source distinction only surfaces at org-admin scope.
5. **Correction privacy.** Corrections may contain sensitive operator commentary. They live in the existing memory tenant-isolation tier, with existing retention rules. Confirm with the security review when Stage 3 lands.
6. **Naming, resolved.** *Scorecards* replaces HyperAgent's *rubrics*. *Quality checks* replaces "dimensions" in operator-facing copy. The Layer 3 capability is intentionally not given a top-level marketing name — it rides the existing `auto-memory` umbrella and the existing `Edit and override` lifecycle on the consolidated Knowledge page. The only new operator-facing word is the verb **Correct** on Run-trace step outputs. Schema-internal label `tenant` is rendered as **this account** in operator UI; the word "tenant" does not appear in operator-facing copy.
7. **Govern / Quality as a fourth Govern primitive, resolved.** Scorecards land as a new sibling of Knowledge / Spending / Connections in the Govern IA. The page has tabs: Agents (drift list), Scorecards (library), Bench history.
8. **Test inputs for the model bench, resolved.** Default: replay recent real runs (multi-selectable, with quick-pick affordances like "Pick newest 15"). Paste-in available for cold starts, defaulting to one prompt card with multi-line textarea; operator clicks Add Prompt to grow the set. Skill bench replays recent invocations of one skill.
9. **Bench cost ceiling, resolved.** Benching N candidates × M samples × judge cost is real money. Operator chooses the candidate set and sample size; platform shows estimated cost before "Run bench" fires, labelled with billing scope ("charged to this account's token budget"). No autonomous benching without explicit operator action in v1.

## 10. Success metrics

Once the full three layers are live:

- **Skill coverage.** Percent of skills with a non-null runtime check. Target: above 80% within one quarter of Stage 1 shipping.
- **Operator review time per task.** Tracked via session telemetry. Target: 30% reduction on tasks where a scorecard is attached.
- **Mean time to detect agent drift.** From "score starts dropping" to "operator notified." Target: under 24 hours.
- **Correction repetition rate.** Percent of corrections that are repeats of prior corrections on the same agent. Target: declining month over month.
- **Cost per quality unit.** For agents with a bench-approved model, track cost-per-task at a fixed scorecard floor. Target: 40% reduction in cost on benched agents within two quarters.

## 11. Mockups

Hi-fi clickable HTML prototypes covering every operator-facing surface in this brief. Four rounds of iteration completed (2026-05-07 to 2026-05-08). All paths relative to repo root.

**Entry point**

- [`prototypes/trust-verification-layer/index.html`](../../../prototypes/trust-verification-layer/index.html) — landing page with status, design decisions per round, and links to every screen below.

**Layer 1: Skill verification (Stage 1)**

| Screen | What it shows |
|---|---|
| [`skill-create.html`](../../../prototypes/trust-verification-layer/skill-create.html) | Custom skill creation. Two-stage flow: Describe → Suggest details. Plain-English runtime check primary, code in Advanced disclosure. Scope-aware blast-radius copy with examples (no "tenant" jargon). Re-suggest affordance. Cannot save without a runtime check decision. |
| [`run-trace.html`](../../../prototypes/trust-verification-layer/run-trace.html) | Run-trace with three-state runtime check badge per step (Pass / Fail / Pending). Aggregate check summary strip above the event list. Inline Correct action on hover (also seeds Layer 3). |

**Layer 2: Agent scorecards, library, model bench (Stage 2)**

| Screen | What it shows |
|---|---|
| [`govern-quality.html`](../../../prototypes/trust-verification-layer/govern-quality.html) | New Govern / Quality primitive with three tabs: Agents (drift list, sparklines, agent drawer with 30-day trend), Scorecards (embeds the library), Bench history (past runs with recommended / approved / outcome). Empty states on Agents and Bench history. |
| [`scorecard-library.html`](../../../prototypes/trust-verification-layer/scorecard-library.html) | Scorecard library. Source pill compressed to **Platform / Custom** at sub-account scope (Custom tooltips actual scope). Attach counts, Share-with-subaccounts toggle on system/org rows, Duplicate action. Custom-only empty state. |
| [`scorecard-create.html`](../../../prototypes/trust-verification-layer/scorecard-create.html) | Scorecard creation form. Quality checks list with name, description, pass mark (% input). Pass-mark reference data note per check ("Similar checks: 76-92%"). Share-with-subaccounts toggle with live visibility estimate. |
| [`agent-create.html`](../../../prototypes/trust-verification-layer/agent-create.html) | Agent creation showing scorecard pre-attachment. Two paths in tabs: Install System Agent and Create from Template. Required rows (system-mandatory and org-mandatory) render identically with lock icon and caret-expandable read-only check details. Suggested rows have no source attribution at sub-account scope. |
| [`agent-edit-scorecard.html`](../../../prototypes/trust-verification-layer/agent-edit-scorecard.html) | Scorecard tab on agent edit. Multi-attached scorecards with Source pills, View link, Detach. Quartile grading control (Off / 25% / 50% / 75%) with live cost help. Recent score summary per scorecard with sparklines and drift warnings. |
| [`model-bench.html`](../../../prototypes/trust-verification-layer/model-bench.html) | Model bench workflow. Three-state page (Setup / Running / Results). Test inputs: multi-select recent real runs (default, with quick-pick affordances) or paste-in (defaults to one prompt card, Add Prompt grows the set). Cost estimate labelled with billing scope. Approve as default on the recommended row. |

**Layer 3: Correction-sourced auto-memory (Stage 3)**

| Screen | What it shows |
|---|---|
| [`run-trace.html`](../../../prototypes/trust-verification-layer/run-trace.html) | Same screen as Layer 1. Inline Correct action opens a small dialog (edited output + reason + reassurance footer) that writes a `capturedVia: 'operator_correction'` memory entry. |
| [`knowledge.html`](../../../prototypes/trust-verification-layer/knowledge.html) | Knowledge page (existing surface) with new "Source: from corrections" filter and source column. Pattern-detector suggestion card example ("3 tone corrections cluster around Outreach Agent"). |

**Process record**

- [`mockup-log.md`](./mockup-log.md) — round-by-round change log including operator feedback per round, design decisions, and frontend-design-principles checks. Rounds 1-4 complete.

> Mockups are illustrative, not authoritative. Where mockup detail and brief text disagree, the brief wins. The implementation spec (next phase) will lock contracts and resolve any remaining gaps.

## 12. Directives for the spec phase

The brief is intentionally not the final word on every detail. The following items have been deliberately deferred from this brief and **must be resolved during spec authoring**:

1. **Terminology, resolved.** Layer 1 checks are called **"runtime checks"** in operator UI, copy, event names, metrics, component names, API routes, and analytics. The schema field on a skill stays named `verify` (developer-facing literal). The umbrella concept is the **Trust & Verification Layer**. Scorecard items remain **"quality checks."** The spec must apply this vocabulary consistently from day one — no use of "verify check" or "verify hook" in operator-facing copy, event names, or metric labels.

2. **Structured failure output for runtime checks.** Layer 1 must declare what a failed check exposes to the operator. At minimum: machine-readable reason code, plain-English explanation, impact (did it block downstream execution?), and a suggested-fix string when the platform can infer one. Spec to define the schema and the operator UI patterns (Run-trace step drawer, Inbox detail). Without this, operators distrust the badge.

3. **Confirm Knowledge page provenance fields.** The brief lists the fields that should be visible on correction-sourced rows (source run, trigger event, last used, usage frequency, attached agents, confidence, human-approved vs inferred). Spec to confirm these map to existing memory schema or define migration deltas. The Knowledge mockup may need a Round 5 pass once the spec is firm.

4. **Bench regression risk thresholds.** The brief introduces a Low / Medium / High regression-risk indicator derived from variance. Spec to define exact thresholds and any minimum-sample requirement before the indicator displays.

5. **Policy primitive deferral confirmed.** A first-class Policy object is out of scope for this layer (see §8). If during spec authoring it becomes clear that policy-shaped requirements *cannot* be expressed via `blast_radius` + runtime checks, escalate as a scoping question rather than expanding scope inside this spec.

6. **Pending and Inconclusive are distinct internal states.** The operator-facing Run-trace badge collapses to three values (Pass / Fail / Pending). At the schema and event level, **Pending** (not yet evaluated — async still running) and **Inconclusive** (evaluated but the check could not determine an outcome) must remain distinct, alongside **Not-applicable** (`verify: null` skills). The distinction matters for retries, analytics, trust reporting, benchmark validity, and operator interpretation downstream. The spec must preserve all four internal states even though the operator UI collapses them today.

This list is the canonical handoff from the brief to the spec phase. The spec author should treat each item as a required resolution, not optional.
