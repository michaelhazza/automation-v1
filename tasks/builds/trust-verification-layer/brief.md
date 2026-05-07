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
3. **Correction memory.** When a user corrects an output, that correction gets captured and fed back into the agent's future runs, either as a scorecard input or as a skill-prompt patch.

These three layers are complementary, not competing. Skill verification answers "did it work?" Scorecards answer "was it good?" Correction memory answers "what did the user actually want?"

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

### Layer 1: Skill verification

Three new fields on every skill in the capabilities registry:

- **`verify`** — a function or small inline check that runs immediately after the skill action, returns pass / fail / inconclusive, and captures the reason. Examples: row exists with the expected shape, external API returned 2xx, file written matches the schema, calendar event landed on the requested day.
- **`reversible`** — boolean, declares whether the action can be undone. Used by the agent loop to decide whether to ask before acting.
- **`blast_radius`** — enumerated label (`self` | `tenant` | `external`) declaring who else is affected. Used to decide whether scorecards apply, whether approval is required, and whether the action is logged at a higher tier.

Skills that genuinely cannot define a verify check declare `verify: null` with a written justification. This is a flag, not a blocker, but the count of `verify: null` skills is a quality metric we will track.

### Layer 2: Agent scorecards

A new resource attached to agents, with a built-in bench workflow:

- **Scorecard definition.** A small set (3-5) of named quality dimensions, each with a description the judge model uses to score (0-1) and a floor threshold. Example for a content agent: `tone_match` (>=0.8), `factual_grounding` (>=0.9), `hook_strength` (>=0.7).
- **Sampling rate.** Operator-configured. Default: evaluate 20% of runs. Anything flagged by Layer 1 or by user correction is auto-evaluated regardless.
- **Trend view.** Per scorecard, per dimension, a time series the operator can scan in seconds. The headline question this answers: "Is my agent getting better or worse?"
- **Model bench.** A separate operator-triggered workflow: pick an agent or a skill, pick a candidate model set, pick a sample size (10-20), run the same task across all candidates, score each via the scorecard, output a table with mean score, variance, latency, cost, and a composite (cheapest model that clears the floor wins). Result writes to `bench-log.md`. Operator approves the suggested default before it takes effect.
- **Regression detection.** When a model is updated by the provider, the bench can be re-run automatically against previously approved configurations. If a skill's score drops past a threshold, the operator gets a single notification.

### Layer 3: Correction memory

Captured automatically whenever the operator edits, rejects, or replaces an agent output:

- **What gets captured.** The original output, the operator's correction, a short structured reason (pulled from the operator's edit, or asked once if the edit alone is ambiguous), and the skill or agent it applies to.
- **What it feeds.** Two things. First, future runs of the same skill or agent get the correction injected as a few-shot example or prompt patch. Second, if a pattern emerges (the operator keeps correcting the same dimension), the platform suggests adding or tightening a scorecard dimension.
- **Scope.** Per tenant, per agent. Corrections do not leak across tenants. Corrections are visible to the operator and editable, so a one-off correction does not become a permanent rule by accident.

## 7. Staged development process

We do not build all three layers at once. Each stage delivers value on its own and creates the substrate for the next.

### Stage 1: Skill verification (foundational)

- Add the three new fields (`verify`, `reversible`, `blast_radius`) to the capabilities registry schema.
- Write verify hooks for the top 20 most-used skills. Document the pattern.
- Add a registry-level lint rule: skills shipping without a verify hook must declare `verify: null` with justification.
- Surface verify results in the agent run log so the operator can see pass / fail at a glance.

**Exit criteria:** every new skill PR carries a verify hook (or a justified null), and the operator can see verify results in the run UI.

### Stage 2: Agent scorecards + model bench

- Add the scorecard resource. Operators can author them in the UI or via a config file.
- Build the sampled judge runner. Default sample rate 20%, configurable.
- Build the trend view. One chart per scorecard dimension over time.
- Build the model bench as a separate operator-triggered workflow. Output a comparison table and a recommended default. Operator approves before it ships.
- Wire regression detection to run the bench automatically on model updates.

**Exit criteria:** operator can attach a scorecard to an agent, see scoring trends, and run a bench to pick a model with confidence.

### Stage 3: Correction memory

- Capture corrections at the point of edit, not via a separate UI. The operator should not have to remember to "save this as a lesson."
- Inject relevant corrections into future runs of the same skill or agent.
- Surface pattern detection: when N corrections cluster on one dimension, suggest a scorecard update.
- Per-tenant scoping, with operator-visible memory so they can prune.

**Exit criteria:** an operator who corrects the same mistake twice sees the correction reflected in the third run automatically, and the platform proposes a scorecard tightening when a pattern is clear.

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
4. **Should scorecards be tenant-scoped or template-able across tenants?** Probably both, with platform-default scorecards per agent type that tenants can fork. To be confirmed in Stage 2 design.
5. **Correction memory and privacy.** Corrections may contain sensitive operator commentary. They live in the same isolation tier as the agent's tenant data, with the same retention rules. Confirm with the security review when Stage 3 lands.
6. **Naming.** This brief uses *scorecards* in place of HyperAgent's *rubrics* and *correction memory* for the third layer. Both names are placeholders, replaceable if better surface.

## 10. Success metrics

Once the full three layers are live:

- **Skill coverage.** Percent of skills with a non-null verify hook. Target: above 80% within one quarter of Stage 1 shipping.
- **Operator review time per task.** Tracked via session telemetry. Target: 30% reduction on tasks where a scorecard is attached.
- **Mean time to detect agent drift.** From "score starts dropping" to "operator notified." Target: under 24 hours.
- **Correction repetition rate.** Percent of corrections that are repeats of prior corrections on the same agent. Target: declining month over month.
- **Cost per quality unit.** For agents with a bench-approved model, track cost-per-task at a fixed scorecard floor. Target: 40% reduction in cost on benched agents within two quarters.
