# Confidence Cut-Points Decision — Architect Tuning 2026-05-04

Spec reference: docs/workflows-dev-spec.md §6.1, §6.2.

## Contents

1. [Methodology](#1-methodology)
2. [Synthetic Labelled Samples](#2-synthetic-labelled-samples)
   - Group A: Zero-rejection clean histories
   - Group B: Single rejection, varying volume
   - Group C: Two rejections, varying volume
   - Group D: Three or more rejections
   - Group E: Budget approval template
   - Group F: Client report template
   - Group G: Invoice generation template
   - Group H: Subaccount first use
   - Group I: Upstream low confidence
   - Group J: Irreversible side effects
   - Group K: Edge and boundary cases
3. [Inferred Decision Boundaries](#3-inferred-decision-boundaries)
4. [Constants Summary](#4-constants-summary)

---

## 1. Methodology

The system has no real production run history (V1 development phase). To derive
principled thresholds we:

1. Enumerated the decision space along three axes:
   - Volume axis: how many past reviews exist (0, 1, 2, 3, 5, 7, 10+)
   - Quality axis: rejection rate (0%, 14%, 17%, 20%, 33%, 50%)
   - Context axis: template class (routine / critical / new subaccount)

2. Generated 55 synthetic samples covering boundary cases and interior points.

3. Labelled each with the desired chip and documented the rationale.

4. Looked for consistent decision boundaries, then expressed them as the
   simplest constants that correctly classify all samples.

---

## 2. Synthetic Labelled Samples

Format columns: `approved | rejected | chip (rule-5 only) | rationale`

Samples where `isCritical=true`, `sideEffectClass=irreversible`, `subFirst=true`,
or `upstream=low` fire a higher-priority rule before reaching rule 5. Those
samples are included to confirm the boundary is invisible to rule 5; the chip
shown is the label that rule 5 alone would produce if higher-priority rules
were absent.

### Group A: Zero-rejection clean histories (volume varies)

| # | approved | rejected | chip | rationale |
|---|----------|----------|------|-----------|
| 1 | 0 | 0 | medium | No evidence; default fires |
| 2 | 1 | 0 | medium | Single approval proves nothing |
| 3 | 2 | 0 | medium | Two approvals is weak; one bad run would flip it |
| 4 | 3 | 0 | **high** | Three approvals, zero rejections: three independent reviewers were satisfied. The "careful first 3" pattern. |
| 5 | 4 | 0 | **high** | Stronger than 3; still clean |
| 6 | 5 | 0 | **high** | Satisfied by both pathways |
| 7 | 7 | 0 | **high** | Clearly established |
| 8 | 10 | 0 | **high** | Strong established pattern |
| 9 | 20 | 0 | **high** | Long clean history |

### Group B: Single rejection with varying volume

| # | approved | rejected | total | rate | chip | rationale |
|---|----------|----------|-------|------|------|-----------|
| 10 | 1 | 1 | 2 | 50% | medium | Very small sample, high rate |
| 11 | 2 | 1 | 3 | 33% | medium | Small sample, high rate |
| 12 | 3 | 1 | 4 | 25% | medium | 1-in-4 rejection still warrants caution |
| 13 | 4 | 1 | 5 | 20% | medium | 1-in-5 is the old threshold boundary; decided NOT high enough |
| 14 | 5 | 1 | 6 | 16.7% | medium | 16.7% > 15%; still medium |
| 15 | 6 | 1 | 7 | 14.3% | **high** | 14.3% < 15%; 7 reviews, 1 rejection is acceptable variance |
| 16 | 9 | 1 | 10 | 10% | **high** | 10% < 15%; established pattern |
| 17 | 14 | 1 | 15 | 6.7% | **high** | Low rate, high volume |
| 18 | 19 | 1 | 20 | 5% | **high** | Very low rate |

### Group C: Two rejections with varying volume

| # | approved | rejected | total | rate | chip | rationale |
|---|----------|----------|-------|------|------|-----------|
| 19 | 3 | 2 | 5 | 40% | medium | 40%: clearly not high confidence |
| 20 | 5 | 2 | 7 | 28.6% | medium | Rate too high |
| 21 | 9 | 2 | 11 | 18.2% | medium | Above 15% |
| 22 | 11 | 2 | 13 | 15.4% | medium | Just above 15%; correctly medium |
| 23 | 12 | 2 | 14 | 14.3% | **high** | Just below 15%; adequate volume |
| 24 | 18 | 2 | 20 | 10% | **high** | Established pattern |

### Group D: Three or more rejections

| # | approved | rejected | total | rate | chip | rationale |
|---|----------|----------|-------|------|------|-----------|
| 25 | 7 | 3 | 10 | 30% | medium | High rate, problematic template |
| 26 | 17 | 3 | 20 | 15% | medium | Exactly 15% = NOT < 15%; correctly medium |
| 27 | 18 | 3 | 21 | 14.3% | **high** | Just under 15% with good volume |
| 28 | 47 | 3 | 50 | 6% | **high** | Mature template, occasional rejection |

### Group E: Template type — budget approval (routine, non-critical, reversible)

| # | approved | rejected | isCritical | sideEffect | subFirst | chip | rationale |
|---|----------|----------|------------|------------|----------|------|-----------|
| 29 | 0 | 0 | false | reversible | false | medium | No history |
| 30 | 3 | 0 | false | reversible | false | **high** | Clean history pathway fires |
| 31 | 5 | 1 | false | reversible | false | medium | 16.7% > 15% |
| 32 | 7 | 1 | false | reversible | false | **high** | 14.3% < 15% |
| 33 | 5 | 0 | true | reversible | false | medium | isCritical fires rule 3 first (medium) |

### Group F: Template type — client report (non-critical, idempotent)

| # | approved | rejected | isCritical | sideEffect | subFirst | chip | rationale |
|---|----------|----------|------------|------------|----------|------|-----------|
| 34 | 0 | 0 | false | idempotent | false | medium | No history |
| 35 | 3 | 0 | false | idempotent | false | **high** | Clean history, low-risk template |
| 36 | 5 | 1 | false | idempotent | false | medium | 16.7% > 15% |
| 37 | 10 | 1 | false | idempotent | false | **high** | 9.1% < 15% |

### Group G: Template type — invoice generation (non-critical, reversible)

| # | approved | rejected | isCritical | sideEffect | subFirst | chip | rationale |
|---|----------|----------|------------|------------|----------|------|-----------|
| 38 | 0 | 0 | false | reversible | false | medium | No history |
| 39 | 2 | 0 | false | reversible | false | medium | Below clean-history minimum |
| 40 | 3 | 0 | false | reversible | false | **high** | Clean history threshold met |
| 41 | 4 | 0 | false | reversible | false | **high** | Clean, more volume |
| 42 | 5 | 0 | false | reversible | false | **high** | Both pathways satisfied |

### Group H: Subaccount first use (rule 2 fires first)

| # | approved | rejected | subFirst | upstream | chip (rule 2 fires) | rationale |
|---|----------|----------|----------|----------|---------------------|-----------|
| 43 | 10 | 0 | true | null | low (rule 2) | First-use overrides clean history |
| 44 | 3 | 0 | true | null | low (rule 2) | Same: subFirst wins |
| 45 | 0 | 0 | true | null | low (rule 2) | No history and first use |

### Group I: Upstream low confidence (rule 1 fires first)

| # | approved | rejected | upstream | chip (rule 1 fires) | rationale |
|---|----------|----------|----------|---------------------|-----------|
| 46 | 10 | 0 | low | low (rule 1) | Upstream low cascades despite history |
| 47 | 3 | 0 | low | low (rule 1) | Same |

### Group J: Irreversible side effects (rule 4 fires first)

| # | approved | rejected | sideEffect | chip (rule 4 fires) | rationale |
|---|----------|----------|------------|---------------------|-----------|
| 48 | 10 | 0 | irreversible | medium (rule 4) | Irreversible beats history |
| 49 | 3 | 0 | irreversible | medium (rule 4) | Same |

### Group K: Edge and boundary cases

| # | approved | rejected | total | rate | chip | rationale |
|---|----------|----------|-------|------|------|-----------|
| 50 | 0 | 5 | 5 | 100% | medium | All rejections, clearly not high |
| 51 | 2 | 1 | 3 | 33% | medium | Below clean-history minimum |
| 52 | 3 | 0 | 3 | 0% | **high** | Exactly at clean-history minimum |
| 53 | 5 | 0 | 5 | 0% | **high** | Both pathways; clean history is primary |
| 54 | 4 | 1 | 5 | 20% | medium | 20% is NOT < 15% and not clean history |
| 55 | 5 | 1 | 6 | 16.7% | medium | Just above 15% |
| 56 | 6 | 1 | 7 | 14.3% | **high** | Just below 15%, adequate volume |

---

## 3. Inferred Decision Boundaries

### Pathway A: Clean history

A template reviewed N times with zero rejections signals that operators have
consistently found the run acceptable. The question is: what is the minimum N
where "all approved" is meaningful rather than lucky?

- N=1: Could be a single careless reviewer. Not meaningful.
- N=2: Could be two consecutive careless reviews. Still weak.
- N=3: Three independent approvals with zero rejections. Reviewer attention
  declines after the first few careful checks. Three is enough to establish
  "this works as expected." Common V1 pattern: a new template is reviewed
  carefully for its first 3 runs then becomes routine.

**Chosen: `CLEAN_HISTORY_MIN_APPROVED = 3`, `rejected === 0`.**

Rationale: the strict zero-rejection requirement means even one push-back at
any point drops the template back to medium until it accumulates enough volume
on pathway B. This is conservative and appropriate: one rejection in 3 runs is
a 33% rate.

### Pathway B: Established pattern

For templates that have some rejections, the question becomes: at what
rejection rate does the noise-to-signal ratio tip toward "broadly reliable"?

Old threshold: `< 0.20` (20%) at 5+ reviews. Problem: at exactly 5 reviews,
1 rejection = 20%. The old threshold would label "4 approvals, 1 rejection" as
high confidence, which feels wrong. A 1-in-5 rejection rate is notable.

Alternative considered: `< 0.10` (10%). Too strict for small samples: requires
0 rejections up to 10 reviews, which collapses to pathway A behavior.

**Chosen: `ESTABLISHED_PATTERN_MAX_REJECTION_RATE = 0.15` (15%).**

At 5 reviews: requires 0 rejections (0% < 15%). Pathway B cannot fire with 1
rejection in 5 reviews, preventing the "4/1 at 5" false positive.
At 7 reviews: allows 1 rejection (14.3% < 15%). First volume where a single
rejection is absorbed: 6 successful reviews plus one push-back.
At 14 reviews: allows 2 rejections (14.3% < 15%).
At 20 reviews: allows 2 rejections (10% < 15%).

**Minimum volume for pathway B: `ESTABLISHED_PATTERN_MIN_TOTAL = 5`.**

Below 5 total reviews, pathway A (zero-rejection) is the only path to high
confidence. This prevents pathway B from firing on tiny samples where the rate
happens to be low (e.g., 1 approved + 0 rejected = 0%, but insufficient
evidence for high confidence).

### Why two pathways rather than one?

Pathway A is strictly superior signal for low-volume templates. "Reviewed 3
times, never pushed back" is cleaner evidence than "5 reviews, 0%." The
dual-pathway design rewards templates that earned operator trust early without
requiring 5+ reviews first.

---

## 4. Constants Summary

```
CLEAN_HISTORY_MIN_APPROVED             = 3
CLEAN_HISTORY_REQUIRED_REJECTIONS      = 0  (strict zero, encoded as === 0)
ESTABLISHED_PATTERN_MIN_TOTAL          = 5
ESTABLISHED_PATTERN_MAX_REJECTION_RATE = 0.15
```

Reviewed: 2026-05-04. Revisit when production data is available (target:
200+ real-world reviews across at least 10 distinct templates).
