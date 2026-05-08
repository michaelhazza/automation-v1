# Brief: Trust & Verification Layer

**Status:** Draft for stress-testing
**Owner:** Product
**Date:** 2026-05-07

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

1. **Layer one is required, layer two is optional, layer three is automatic.** Every skill must ship a verify hook. Scorecards are opt-in per agent because not every agent role benefits and the eval cost is real. Correction memory runs in the background whenever a user takes a corrective action, so the operator does not have to remember to use it.

2. **Deterministic checks before LLM judgement.** Verify hooks should be code, not prompts, wherever possible. Scorecards use LLM-as-judge but only after the deterministic layer has passed. We do not want a model judging whether an API call succeeded, that is a structural fact.

3. **Trust is earned through observation, not declared by developers.** No skill or agent gets a "trusted" flag based on developer assertion. Trust accrues through observed scorecard performance over time. This is the part that lets us eventually graduate skills to higher autonomy tiers without the operator having to make that call manually.

## 6. What we are looking at building

### IA alignment

The recent four-spec consolidation (Foundation / Operate / Build / Govern) reduced ~25 pages to ~12. This brief rides that IA. It does not introduce a new top-level surface.

| Layer | Where it surfaces | Why there |
|---|---|---|
| Skill verification | **Operate / Run-trace** — pass / fail badge per step. Verify-failed events also feed Inbox. | Verify is a per-step run signal. Operate already owns the run-time observation surface. |
| Agent scorecards (and model bench) | **Govern / Quality** (new fourth Govern primitive alongside Knowledge / Spending / Connections). Scorecard *configuration* lives on Build / Agent edit. | Govern answers "what does the platform know about itself." Quality fits naturally as a sibling of Knowledge / Spending. Configuration belongs to the agent it's attached to, which lives on Build. |
| Correction-sourced auto-memory | **Operate / Run-trace** for the in-context "Correct" action. **Govern / Knowledge** for the resulting auto-memory entries (existing surface, with a new "Source: from corrections" filter). | Capturing happens where the operator already sits looking at the run. Reviewing happens where they already manage knowledge. |

No new top-level page. No new memory primitive. The operator sees a small new action ("Correct") at the step level on Run-trace, and a new filter on the existing Knowledge page.

### Layer 1: Skill verification

Three new fields on every skill in the capabilities registry:

- **`verify`** — a function or small inline check that runs immediately after the skill action, returns pass / fail / inconclusive, and captures the reason. Examples: row exists with the expected shape, external API returned 2xx, file written matches the schema, calendar event landed on the requested day.
- **`reversible`** — boolean, declares whether the action can be undone. Used by the agent loop to decide whether to ask before acting.
- **`blast_radius`** — enumerated label (`self` | `tenant` | `external`) declaring who else is affected. Used to decide whether scorecards apply, whether approval is required, and whether the action is logged at a higher tier.

Skills that genuinely cannot define a verify check declare `verify: null` with a written justification. This is a flag, not a blocker, but the count of `verify: null` skills is a quality metric we will track.

**Who authors verify checks:**

- **System skills.** Platform team authors the verify check when shipping the skill. Ships baked in.
- **Custom skills (org or subaccount).** When an admin adds a custom skill, the platform proposes a verify check based on the skill's API spec or tool description (LLM-suggested). The admin reviews and chooses: accept, edit, or mark "no deterministic check possible" with one-line justification.
- **Plain English first.** The proposed check is shown in operator-readable form ("Did the API return a 2xx response?"). The actual implementation lives in an "Advanced" disclosure for technical users.
- **Mandatory at creation.** A custom skill cannot be saved without either a confirmed verify check or an explicit "no deterministic check possible" with justification. This is the only way coverage holds at scale.

### Layer 2: Agent scorecards

Scorecards are first-class library objects, not properties of an agent. An agent attaches one or more scorecards by reference. Each scorecard contains a small set (typically 3-5) of named **quality checks**, each with a description the judge model uses to score and a **pass mark** (shown to operators as a percentage, stored as 0-1 internally).

**Library and scoping.** Scorecards live in a unified library, surfaced as a tab on Govern / Quality. The library spans three scopes:

- **System** — platform-shipped, available everywhere. Read-only to org and subaccount admins.
- **Organisation** — created by the org admin. Visible to org-level agents and (by default) to subaccounts in the org.
- **Subaccount** — created by a subaccount admin. Visible only inside that subaccount.

Each library row carries a **Source** pill (System / Organisation / This subaccount) so operators see at a glance what they own versus what they inherit.

**Visibility, controlled by one toggle.** Every scorecard row has a single **"Share with sub-accounts"** toggle.

- For System scorecards viewed at org scope, default on. Org admin can turn off to hide that scorecard from their subaccounts.
- For Organisation scorecards, default on. Org admin can turn off to keep it org-internal.
- Subaccount scorecards do not show the toggle (subaccount-only by definition).

This is the only visibility primitive we ship. No fork tracking, no diff, no version pinning UI. If an admin wants to customise a scorecard, they **Duplicate** it (independent copy at their scope) and edit the copy.

**Multi-attach.** An agent has a list of attached scorecards. Each is scored independently and tracked independently. Trend views and drift detection split by scorecard, so an operator can tell that "tone match" is fine but "factual grounding" is drifting.

**System agent + agent template integration.** Both existing platform primitives extend with scorecard fields, mirroring how skills already inherit:

- `system_agents` gets `default_system_scorecard_slugs` (always attached, hidden from org UI) and `default_org_scorecard_slugs` (suggested at install, org admin can keep / swap / remove).
- `agent_templates` gets `default_scorecard_slugs` (suggested when creating a new agent from a template).

When an admin installs a System Agent or creates from an Agent Template, the recommended scorecard set is pre-attached. They can keep, add more, or remove.

**How often to grade.** Operator-configured per agent. Default: grade 20% of runs sampled at random. Anything flagged by Layer 1 verify or by an operator correction is graded regardless.

**Trend view.** Per scorecard, per quality check, a time series the operator can scan in seconds. The headline question: "Is anything getting worse?"

**Model bench.** A separate operator-triggered workflow on Govern / Quality. Pick an agent (agent bench) or a specific skill (skill bench), pick candidate models, pick a sample count, optionally point at recent real runs as test inputs (default) or a paste-in set. Each candidate is scored against the agent's attached scorecards. Output: a comparison table with mean score, variance, latency, cost, and a composite (cheapest model that clears every pass mark wins). Operator approves the recommended default before it takes effect.

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
- **"Source: from corrections" filter on Knowledge page.** Operators can find correction-sourced entries quickly without leaving the existing page.
- **Pattern-detector hook into S11.** When N corrections (default 3) cluster on the same skill/agent/dimension within a window, the existing auto-synthesis pipeline promotes them to a memory block at `status: pending_review`, `confidence: low`. Operator approves through the existing HITL queue. Optionally, the pattern detector also surfaces a scorecard suggestion ("operators keep correcting tone, consider tightening `tone_match` floor").

**Scope.** Per tenant, per agent. Existing decay, supersession, recency, and tenant-isolation guarantees on the memory subsystem apply. We add nothing new to those rules.

## 7. Staged development process

We do not build all three layers at once. Each stage delivers value on its own and creates the substrate for the next.

### Stage 1: Skill verification (foundational)

- Add the three new fields (`verify`, `reversible`, `blast_radius`) to the capabilities registry schema.
- Write verify hooks for the top 20 most-used system skills. Document the pattern.
- Build the **suggested verify** flow for custom skill creation (org and subaccount). Plain-English first, code in advanced disclosure, mandatory at save (or "no deterministic check possible" with one-line justification).
- Add a registry-level lint rule: skills shipping without a verify hook must declare `verify: null` with justification.
- Surface verify results on Run-trace step rows (pass / fail / inconclusive / not-applicable). Verify failures feed Inbox.

**Exit criteria:** every new skill PR (system, org, or subaccount) carries a verify hook or a justified null, and the operator can see verify results inline on Run-trace.

### Stage 2: Agent scorecards + library + model bench

- Add the **scorecard** resource with three-scope ownership (system / org / subaccount). Every scorecard carries `share_with_subaccounts` (boolean, default on for system and org scopes).
- Add the **scorecard library** as a tab on Govern / Quality, showing System / Org / Subaccount scorecards with Source pills, attach counts, and the Share-with-subaccounts toggle on system and org rows.
- Add **multi-attach** on agents: an agent has an ordered list of attached scorecard ids.
- Extend `system_agents` with `default_system_scorecard_slugs` (hidden, always attached on install) and `default_org_scorecard_slugs` (suggested at install).
- Extend `agent_templates` with `default_scorecard_slugs` (suggested at agent creation).
- Build the **scorecard creation form** (blank or pre-filled from Duplicate). Quality checks expressed as name + description + pass mark (operator-facing as percentage).
- Build the sampled judge runner. Default sample rate 20%, configurable per agent.
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
- **Not a behavioural change to existing skills.** Stage 1 adds metadata only. Existing skill behaviour is unchanged unless the verify hook fails, in which case the agent loop already has a "what to do on failure" path we extend, not replace.

## 9. Open questions to stress-test

1. **Where does the verify hook actually run?** In-process with the skill (fast, tight coupling) or as a separate post-action job (slower, cleaner)? Probably in-process for synchronous skills and post-action for long-running ones, but worth deciding before the schema lands.
2. **How do we keep judge cost bounded?** A 20% sample rate is a starting point. Do we adapt the rate based on observed score variance (sample less when the agent is clearly stable, more when it's drifting)? Probably yes, but not in Stage 2.
3. **How does the bench handle prompt portability?** A prompt tuned for Opus may unfairly disadvantage Sonnet. Stage 2 ships with same-prompt benching (most honest as a real-world test). Auto-prompt-adaptation is a possible Stage 4 if scores look unfair in practice.
4. **Scorecard scoping, resolved.** Three scopes (System / Organisation / Subaccount), one library, one **Share with sub-accounts** toggle on system and org rows. No fork tracking, no diff. Customisation is done via Duplicate. Subaccounts can create their own scorecards (full autonomy).
5. **Correction privacy.** Corrections may contain sensitive operator commentary. They live in the existing memory tenant-isolation tier, with existing retention rules. Confirm with the security review when Stage 3 lands.
6. **Naming, resolved.** *Scorecards* replaces HyperAgent's *rubrics*. *Quality checks* replaces "dimensions" in operator-facing copy. The Layer 3 capability is intentionally not given a top-level marketing name — it rides the existing `auto-memory` umbrella and the existing `Edit and override` lifecycle on the consolidated Knowledge page. The only new operator-facing word is the verb **Correct** on Run-trace step outputs.
7. **Govern / Quality as a fourth Govern primitive, resolved.** Scorecards land as a new sibling of Knowledge / Spending / Connections in the Govern IA. The page has tabs: Agents (drift list), Scorecards (library), Bench history.
8. **Test inputs for the model bench.** Default: replay recent real runs (most honest signal). For cold starts, allow paste-in. Skill bench replays recent invocations of one skill. To be confirmed in Stage 2 design.
9. **Bench cost ceiling.** Benching N candidates × M samples × judge cost is real money. Operator chooses the candidate set and sample size; platform shows estimated cost before "Run bench" fires. No autonomous benching without explicit operator action in v1.

## 10. Success metrics

Once the full three layers are live:

- **Skill coverage.** Percent of skills with a non-null verify hook. Target: above 80% within one quarter of Stage 1 shipping.
- **Operator review time per task.** Tracked via session telemetry. Target: 30% reduction on tasks where a scorecard is attached.
- **Mean time to detect agent drift.** From "score starts dropping" to "operator notified." Target: under 24 hours.
- **Correction repetition rate.** Percent of corrections that are repeats of prior corrections on the same agent. Target: declining month over month.
- **Cost per quality unit.** For agents with a bench-approved model, track cost-per-task at a fixed scorecard floor. Target: 40% reduction in cost on benched agents within two quarters.
