# Research brief: self-improving agents, evaluation loops, and overlay-vs-fork primitives

## Context

We are designing a closed-loop self-improvement system on top of an existing evaluation subsystem. Current state:

- Scorecard subsystem: LLM-as-judge (Claude Haiku), deterministic sampling, per-quality-check pass marks, immutable verdicts persisted with rubric snapshots.
- Correction pattern detector: clusters operator corrections by embedding similarity, currently only suggests tightening pass marks.
- Memory layer with typed entries (observation, issue, preference, pattern, decision) and type-specific decay.

We are about to add:

1. A **post-failure root-cause synthesis** step that fires on scorecard fails. It cross-references the run, the failed check, the entity record (customer / patient / etc), and recent corrections, and emits a structured root-cause record.
2. A new **skill amendment** primitive. Typed overlays (instruction-extension, example, guardrail, fact, exception) that extend a system-level skill at the subaccount tier **without** forking it. Multiple amendments stack in defined order; system skill remains the base text. This replaces the current fork-on-customise model where any tweak creates a full independent copy and loses inheritance from system updates.
3. A morning review queue surfaces draft amendments for operator one-click accept / edit / reject.

The longer-term path (separate brief) is upward promotion of amendments to the system tier via ring rollout when N subaccounts independently adopt the same shape.

## What would change my mind?

1. **Production reports of self-improving agents.** Any vertical. Agents that edit their own prompts, skills, or persistent context based on evaluation feedback. What worked? What failed? What were the specific failure modes (drift, runaway specialisation, judge gaming, hallucinated improvements, regression on previously-passing cases)?

2. **Which research has held up in production?** DSPy, TextGrad, ADAS, Reflexion, Self-Refine, and similar. Which approaches have been validated outside benchmark conditions, and which remain academic?

3. **Overlay-on-base vs full-fork as a primitive.** Has anyone shipped a **typed** overlay system (not free-text additions)? What overlay categories have proven useful vs. noisy? Where does typed overlay break down and force a full fork?

4. **Judge gaming and metric capture.** When the same system both writes amendments and is evaluated by an LLM judge, what failure modes appear? Mitigations that have actually worked in production?

5. **Stopping the loop from degrading.** Best practice for preventing slow-drift degradation: regression test sets, periodic baseline reset, human gates, frozen evaluation suites, separate judge models?

6. **The skeptic's case.** Strongest argument that closed-loop self-improvement is the wrong frame, and that the same outcomes are better achieved with templated authoring, library curation, or supervised fine-tuning instead.

## Output I want

A list of (a) patterns to adopt with one-line rationale, (b) patterns to avoid with one-line rationale, and (c) specific known production failures to design against. Anchored to public sources from the last 18 months. Skip generic content.
