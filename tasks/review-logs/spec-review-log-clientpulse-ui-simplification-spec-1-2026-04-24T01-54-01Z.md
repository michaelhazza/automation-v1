# Spec Review Iteration 1 — clientpulse-ui-simplification-spec

**Spec:** `docs/superpowers/specs/2026-04-24-clientpulse-ui-simplification-spec.md`
**Iteration:** 1 of 5
**Started:** 2026-04-24T01:54:01Z

---

## Overview

Codex produced 26 findings (verbatim in `tasks/review-logs/_clientpulse-ui-iter1-codex-output-v2.txt`, lines 14691–14793). The rubric pass added 3 additional findings (FireAutomationEditor path drift, ProposeInterventionModal path drift, §5.1 "may" vs G5 mandatory contradiction). Classification and disposition is split into the two sections below.

---

## Rubric findings (added to Codex's list)

- **R1** — `FireAutomationEditor.tsx` path drift: §6.6, §8.1, §10 reference `client/src/components/FireAutomationEditor.tsx`. Actual path is `client/src/components/clientpulse/FireAutomationEditor.tsx`.
- **R2** — `ProposeInterventionModal.tsx` path drift: §6.4, §8.2, §10 reference `client/src/components/ProposeInterventionModal.tsx`. Actual path is `client/src/components/clientpulse/ProposeInterventionModal.tsx`.
- **R3** — §1.5 says "No new run-detail page is built" and §5.1 hedges meta-bar changes as "may be applied", but G5 makes the meta bar mandatory. "May" + mandatory gate = contradiction.

---

## Classification summary

- **Mechanical accepted:** 26 Codex + 3 rubric = 29 findings total
- **Mechanical rejected:** 0
- **Directional / ambiguous sub-findings (AUTO-DECIDED in Step 7):** 2 — Defer 24h behaviour (from Codex #12) and CRM/Agents workspace cards (from Codex #14). Both AUTO-DECIDED `reject` (drop from v1) with rationale recorded.

Detailed per-finding classification is in the companion file
`spec-review-log-clientpulse-ui-simplification-spec-1-2026-04-24T01-54-01Z-classifications.md`.

---

## Iteration 1 Summary

- Mechanical findings accepted:  29 (26 Codex + 3 rubric)
- Mechanical findings rejected:  0
- Directional findings:           0
- Ambiguous findings:             0
- Reclassified → directional:     0
- Autonomous decisions (directional/ambiguous): 2
  - AUTO-REJECT (framing):    0
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED:             2 (both "reject" — Defer 24h button; CRM + /agents workspace cards. See tasks/todo.md)

Spec commit after iteration: c1f98a8fac5a7a9972ad962a3a5cde760c73e3df

---

## Notes on the iteration

- Codex's review ran once (first attempt used `codex review --uncommitted` which only produced the raw diff and no findings; second attempt used `codex exec` with the spec piped in and full reviewer instructions, which produced 26 well-formed findings).
- The spec had a large number of factual cross-codebase mismatches — the highest finding density was around routes (`/` redirects to `/admin/pulse`, `/agent-runs/:runId` doesn't exist, `/pulse` is actually `/admin/pulse`), already-existing endpoints described as "new" (`/api/activity`, `/api/pulse/attention`, `GET /api/agent-runs/:id`), and fabricated built files (`AdminAgentTemplatesPage`, `CreateOrgPage`).
- No directional or ambiguous findings survived — every Codex item was either a factual correction, a file-inventory drift, a self-contradiction, or a framing-reject (G3/G4 unit tests converted to manual). The only sub-parts that routed to AUTO-DECIDED were (1) Defer 24h button and (2) CRM/Agents workspace cards — both dropped from v1 to avoid scope creep.
