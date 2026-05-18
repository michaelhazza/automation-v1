# Iteration 4 — browser-hardening-primitives spec review

## Codex findings classification

FINDING #1 — humanize JSONB column residue in §4.3 line 138 + §6.2 line 243
  Source: Codex
  Section: §4.3, §6.2
  Classification: mechanical
  Disposition: auto-apply (rewrote both lines with §5.2 architect-pick conditional, mirroring iter 3 propagation)

FINDING #2 — `browser.humanize.applied` contradiction: pre-action wrapper decision vs durationMs post-completion payload
  Source: Codex
  Section: §10.4, §12
  Classification: mechanical
  Disposition: auto-apply (reverted to post-completion semantics in §10.4; iter 2's "pre-action wrapper decision" framing was wrong because durationMs in §12 telemetry payload requires post-completion emission)

FINDING #3 — §6.1 references Q8 instead of Q10
  Source: Codex
  Section: §6.1, §17
  Classification: mechanical
  Disposition: auto-apply (Q10 is the data-source question; Q8 is the disclosure-UI question)

FINDING #4 — §14 Playwright-bump path-trigger not in §5.1 CI workflow row
  Source: Codex
  Section: §5.1, §14
  Classification: mechanical
  Disposition: auto-apply (added path-filter trigger description to the YAML row in §5.1)

## Mechanical fixes applied

[ACCEPT] §4.3 — Humanize persistence description rewritten with architect-pick conditional (Finding #1).
[ACCEPT] §6.2 — HumanizeOptions envelope null trigger rewritten (Finding #1).
[ACCEPT] §10.4 — humanize action telemetry reverted to post-completion semantics with explicit wrapper-error handling (Finding #2).
[ACCEPT] §6.1 — Tenant-config source surface reference corrected from Q8 to Q10 (Finding #3).
[ACCEPT] §5.1 — `.github/workflows/browser-detection-harness.yml` row expanded to include Playwright-bump path-filter trigger (Finding #4).
[ACCEPT] frontmatter Last updated bumped to "spec-reviewer iter 4".

## Iteration 4 Summary

- Mechanical findings accepted: 4
- Mechanical findings rejected: 0
- Directional findings: 0
- Ambiguous findings: 0
- Reclassified → directional: 0
- Autonomous decisions (directional/ambiguous): 0
- Spec commit after iteration: pending Step 8b commit
