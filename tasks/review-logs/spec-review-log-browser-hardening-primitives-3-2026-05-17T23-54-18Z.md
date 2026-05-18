# Iteration 3 — browser-hardening-primitives spec review

## Codex findings classification

FINDING #1 — HumanizeToggle path drift (line 139 vs 169)
  Source: Codex
  Section: §4.3, §5.1
  Classification: mechanical
  Disposition: auto-apply (canonicalised to `client/src/components/HumanizeToggle.tsx`)

FINDING #2 — `workflow.humanize` / `workflows.humanize` column references not propagated to downstream sections
  Source: Codex
  Section: §8.3, §9, §10.1, §10.6, §20
  Classification: mechanical
  Disposition: auto-apply (each downstream reference rewritten with the §5.2 architect-pick conditional)

FINDING #3 — proxyConfig + workflow.locale/timezone + subaccount.language not inventoried
  Source: Codex
  Section: §6.1, §6.4, §8.2, §19.2
  Classification: mechanical (treat as architect-pick at chunk authoring — same pattern as humanize persistence)
  Disposition: auto-apply (added Tenant-config source surface subsection in §6.1; added Open Question Q10 in §17)

FINDING #4 — baseline-weakening gate script not wired into CI workflow
  Source: Codex
  Section: §4.1, §5.1, §11.2, §19.1
  Classification: mechanical
  Disposition: auto-apply (updated `.github/workflows/browser-detection-harness.yml` row to call out pre-step invocation; updated §11.2 to note the wiring)

## Mechanical fixes applied

[ACCEPT] §4.3 — HumanizeToggle path canonicalised to `client/src/components/HumanizeToggle.tsx` (Finding #1).
[ACCEPT] §8.3 — Humanize persistence read rewritten with architect-pick conditional (Finding #2).
[ACCEPT] §9 — Phase 3 dependency line rewritten: "persists humanize via §5.2 architect-pick path"; UI line marked conditional (Finding #2).
[ACCEPT] §10.1 — humanize persistence-write idempotency rewritten per architect-pick path (a/b/c) (Finding #2).
[ACCEPT] §10.6 — humanize CHECK constraint surfacing rewritten per architect-pick path (Finding #2).
[ACCEPT] §20 — humanize migration row rewritten as conditional on architect-pick path (Finding #2).
[ACCEPT] §6.1 — Added Tenant-config source surface subsection covering proxyConfig + locale/timezone/language overrides (Finding #3).
[ACCEPT] §17 — Added Q10 (Tenant-config source for proxyConfig + overrides) (Finding #3).
[ACCEPT] §5.1 — Browser-detection-harness CI workflow row: explicitly invokes baseline-weakening gate as pre-step (Finding #4).
[ACCEPT] §11.2 — Baseline-weakening gate row notes the CI wiring (Finding #4).
[ACCEPT] §18 — Numeric reconciliation updated: 10 open questions (was 9) (Finding #3 propagation).
[ACCEPT] frontmatter Last updated bumped to "spec-reviewer iter 3".

## Iteration 3 Summary

- Mechanical findings accepted: 4
- Mechanical findings rejected: 0
- Directional findings: 0
- Ambiguous findings: 0
- Reclassified → directional: 0
- Autonomous decisions (directional/ambiguous): 0
- Spec commit after iteration: 0cf74666
