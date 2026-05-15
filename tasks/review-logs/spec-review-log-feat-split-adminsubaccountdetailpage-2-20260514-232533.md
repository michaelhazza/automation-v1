# Spec Review Iteration 2 — feat-split-adminsubaccountdetailpage

**Spec path:** `tasks/builds/feat-split-adminsubaccountdetailpage/spec.md`
**Codex version:** 0.125.0
**Iteration:** 2 of 5
**Timestamp:** 20260514-232533

---

## Codex output summary

Iteration 2 surfaced 3 P2 findings. All real, all mechanical. None match a directional signal.

---

## Findings

### FINDING #1 — Draft tab-state lost on tab switch (behaviour delta)

- Source: Codex P2 (line 301 of spec)
- Section: §1 / §2 / §12 (cross-cutting)
- Description: Today, `settingsForm`, `boardColumns`, modal-open/form state all live on the host above the activeTab conditional, so they survive tab switches. After extraction those states live inside tab components, which unmount on switch — losing draft state.
- Adjudication: real behaviour delta. §1 promises "preserve every user-visible behaviour" so this must be either preserved or explicitly acknowledged.
- Fix applied: add explicit acknowledgement to §2 non-goals AND §12 self-consistency check with rationale for why preservation isn't worth the architectural cost.
- Classification: mechanical.

### FINDING #2 — Error-banner contract is too broad

- Source: Codex P2 (line 145 of spec)
- Section: §8 error-banner contract
- Description: Iteration 1's §8 paragraph said "every extracted tab" must render the simple flat banner, but AgentsTab, BeliefsTab, DevContextConfig, OnboardingTab already use different local error treatments today, and §2 forbids visual change.
- Fix applied: narrow the contract to ONLY the three tabs whose error path was on the host (CategoriesTab, WorkflowsTab, AdminTab); add an explicit paragraph noting other tabs keep their existing local error treatment verbatim.
- Classification: mechanical.

### FINDING #3 — §13 smoke-test criterion impossible in client mode

- Source: Codex P2 (line 308 of spec)
- Section: §13
- Description: §13 said "every tab in both `mode='admin'` and `mode='client'`" but client mode only exposes `board` and `categories`.
- Fix applied: split the criterion into admin-mode (all 11 tabs) and client-mode (board + categories) lines.
- Classification: mechanical.

---

## Adjudication log

### [ACCEPT] §2 / §12 — Acknowledge draft-state delta
- Fix applied: add to §2 non-goals; add a detailed acknowledged-delta bullet to §12 with rationale.

### [ACCEPT] §8 — Narrow error-banner contract to 3 tabs
- Fix applied: rewrite the §8 paragraph, naming WorkflowsTab/CategoriesTab/AdminTab as the scope; explicitly note other tabs keep their existing local error treatment.

### [ACCEPT] §13 — Split smoke-test by mode
- Fix applied: replace the single bullet with two mode-scoped bullets.

---

## Iteration 2 Summary

- Mechanical findings accepted: 3
- Mechanical findings rejected: 0
- Directional findings: 0
- Ambiguous findings: 0
- Reclassified → directional: 0
- Autonomous decisions (directional/ambiguous): 0
  - AUTO-REJECT (framing): 0
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED: 0
- Spec commit after iteration: `81e9d34b`
