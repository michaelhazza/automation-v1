# ClientPulse UI Simplification — Stage 1 Audit

> **SUPERSEDED** — This audit is the research foundation only. The authoritative implementation spec is:
> `docs/superpowers/specs/2026-04-24-clientpulse-ui-simplification-spec.md`
> Do not use this file to drive implementation. Refer to the spec above.

**Branch:** `claude/clientpulse-ui-simplification-audit` (off `main` @ 6ee97b7)
**Date:** 2026-04-23
**Scope:** 22 ClientPulse mockups in `tasks/clientpulse-mockup-*.html`
**Rubric:** [`docs/frontend-design-principles.md`](../../../docs/frontend-design-principles.md) + [`CLAUDE.md` § Frontend Design Principles](../../../CLAUDE.md)

---

## Why this audit exists

ClientPulse shipped (PR #155 Session 1, PR #157 Session 2) before `docs/frontend-design-principles.md` was written. The mockups that guided the build were data-model-first — they surface every backend capability the spec exposes (health factors, churn bands, fingerprints, memory beliefs, cost attribution, intervention outcomes). The new principles invert that: **start from the primary task, defer observability, cap panels / KPIs / columns / sidebars**.

This audit inventories every ClientPulse mockup, confirms what actually shipped into `main`, measures both the mockup and the built UI against the current rubric, and produces a per-mockup recommendation: **keep / simplify / delete**.

The user then approves / overrides each recommendation. Stage 2 rewrites the approved-for-simplify mockups. Stage 3 writes the dev spec that maps approved mockups to built-code changes.

---

## How to read each entry

Every mockup gets one block in the shape:

```
### <mockup-name>
- **Mockup file** — path on disk
- **Lives at** — route or component in the built product (or "DESIGN-ONLY" / "MARKETING")
- **Source files** — the built counterpart in main
- **Built?** — Full / Partial / Not built / Admin-only / Marketing-only
- **Parity notes** — what the mockup shows vs what actually ships
- **Mockup complexity violations** — the rubric applied to the mockup design
- **Built-UI complexity violations** — the rubric applied to what users see in main today
- **Recommendation** — keep / simplify / delete
- **Rationale** — one sentence why
- **Stage 3 implication** — what changes if any Stage 3 needs to make in built code
```

The distinction between *mockup violations* and *built-UI violations* matters: sometimes the built UI already simplified past the mockup; sometimes the mockup captured a safe design the build drifted from; sometimes both are wrong.

---

## Legend — recommendation meanings

- **keep** — mockup is consistent with principles AND accurately reflects the simplified target UI. No edits. Stage 2 leaves the file alone.
- **simplify** — mockup stays (feature is valid) but needs to be rewritten to depict the simplified target. Stage 2 rewrites the HTML. Stage 3 may need to change built code to match the revised mockup.
- **delete** — feature is anti-pattern OR design-only and should not ship OR is redundant with another surface. Stage 2 deletes the file. Stage 3 may need to remove built code.

---

## Summary table

| # | Mockup | Built? | Recommendation | Stage 3 built-code change? |
|---|---|---|---|---|
| 1 | dashboard | Partial | **simplify** | Yes — remove KPI tile strip, single client list |
| 2 | drilldown | Full | **simplify** | Yes — collapse band-transitions, demote Config-Assistant button, trim attribution blocks |
| 3 | settings | Full (over-built) | **simplify** | **Yes — largest change: 10 blocks → tabbed layout** |
| 4 | subaccount-blueprints | Full | **simplify** | Yes — trim table to 4 columns, merge Browse-library into Create modal |
| 5 | organisation-templates | Full | **simplify** | Yes — trim table to 4 columns |
| 6 | create-task | Partial | **simplify** | No — mockup rewrite only |
| 7 | email-authoring | Partial | **simplify** | No — mockup rewrite only |
| 8 | fire-automation | Partial | **simplify** | Yes — remove `a.id` leak in picker |
| 9 | operator-alert | Full | **simplify** | No — mockup rewrite only |
| 10 | propose-intervention | Full | **simplify** | Yes — remove raw `s.contribution` render |
| 11 | send-sms | Partial | **simplify** | No — mockup rewrite only |
| 12 | template-editor | N/A (simpler built pattern) | **delete** | No |
| 13 | inline-edit | Not built | **delete** | No |
| 14 | config-assistant-chat | Full | **simplify** | No — mockup rewrite only |
| 15 | onboarding-orgadmin | Partial | **simplify** | Minor — audit email template + celebration copy |
| 16 | onboarding-sysadmin | Full | **simplify** | No — mockup rewrite only |
| 17 | briefing-per-client | Partial (playbook only) | **delete** | Yes — disable/gate auto-scheduled per-client briefing playbook |
| 18 | digest-per-client | Partial (playbook only) | **delete** | Yes — disable/gate per-subaccount weekly-digest playbook, or ship minimal variant |
| 19 | weekly-digest (org) | Not built | **delete** | No — feature was never shipped |
| 20 | operator-alert-received | Full (different metaphor) | **simplify** | No — mockup rewrite only |
| 21 | intelligence-briefing | Partial (playbook only) | **simplify** | Yes — tighten rendered template if it matches the mockup's density |
| 22 | capability-showcase | N/A (reference doc) | **delete** | No |

**Tally:** 16 simplify · 6 delete · 0 keep.

**Built-code changes needed in Stage 3:** 10 of 22. Grouped by severity:

- **Large:** Settings page restructure (tabs), Dashboard simplification (remove KPI strip, single client list).
- **Medium:** Drilldown (collapse transitions + demote Config-Assistant button + trim attribution), digest/briefing playbook gating (enable/disable decisions).
- **Small / surgical:** `FireAutomationEditor.tsx:39` (drop `a.id`), `ProposeInterventionModal.tsx:177` (drop `s.contribution`), Blueprints + Org Templates table column trimming, minor onboarding email/celebration trims.

---

## Cross-cutting findings

Patterns that show up across multiple mockups. These are the design reflexes the new principles explicitly inverted.

### 1. Observability bleed into primary journeys

KPI tiles, trend charts, per-entity sparklines, cost attribution blocks, diagnostic contribution scores all showed up repeatedly on non-monitoring surfaces: dashboard landing, digest emails, onboarding celebration, operator-alert cards, intervention-propose modal. The shipped code often simplified correctly (dashboard trimmed the trend chart, operator cards collapsed evidence) but a handful of surface-level leaks remain (`a.id` in FireAutomationEditor, `s.contribution` in ProposeInterventionModal, attribution code blocks in drilldown's history table). Fix these surgically in Stage 3.

### 2. Internal identifiers on user-facing surfaces

Automation IDs (`a.id`), signal contribution floats (`s.contribution`), SQL table names (`operational_defaults`, `system_hierarchy_templates`), health-factor weight decimals (`0.30`), churn-band threshold ranges (`20–39`) — all appeared on surfaces aimed at org-admins or operators, not Synthetos staff. The shipped code leaks two (`a.id`, `s.contribution`); the mockups contain the rest. Stage 2 mockup rewrites strip them from the design, Stage 3 fixes the two live leaks.

### 3. Digest / briefing density

Both the per-client and org-level weekly digests/briefings were designed as dense dashboard-in-an-email surfaces — KPI tiles with WoW deltas, intervention-causality narratives, internal memory/belief state, forward-looking watchlists blurred with backward-looking digests. All three per-client variants (`briefing-per-client`, `digest-per-client`, `weekly-digest` org) are recommended for deletion. The org-level `intelligence-briefing` is salvageable if reduced to TL;DR + 3–5 action bullets.

This is the highest-leverage decision in the audit. Deleting the dense variants saves a large amount of downstream work (email template design, memory-health data plumbing, playbook tuning, HITL-on-digest semantics, "view full briefing" page design).

### 4. Panel / column / tile budget creep

Nearly every settings-adjacent page, table, or card-grid exceeded its complexity cap. Settings at 10 blocks was the worst (2× the admin-relaxed budget). Blueprints + Organisation Templates each had 6 table columns (cap: 4). Dashboard had 4+ KPI tiles on a landing surface. Drilldown had 4 panels (cap: 3). Most of these are small trims but they add up — a consistent 4-column table rule, a consistent 0-KPI-on-landing rule, a consistent 3-panel-max rule should be enforced in Stage 3.

### 5. Second-primary-action creep

Several screens had two primary actions: Dashboard ("Propose intervention" + "Open Configuration Assistant"), Drilldown (same pair), Blueprints ("Browse shared library" + "+ New template"). The new rule is one per screen. Stage 3 either demotes the secondary to a text link / modal-side-flow, or moves it to a different surface.

### 6. Mockup-vs-built drift

The built code sometimes simplified past the mockup (dashboard's missing trend chart, email authoring's 5-field palette, template-editor's per-block inline pattern, operator-alert-received's lane-based cards). That drift is the correct direction — builders intuited the simplicity rule before it was written. The risk is that leaving the original dense mockups in `tasks/` misleads future design work back into the rejected pattern. Stage 2 mockup rewrites close this loop.

---

## Stage 3 preview — anticipated built-code changes

After Stage 2 rewrites the mockups, Stage 3 will write a dev spec mapping simplified mockups → built-code changes. Anticipated spec contents:

1. **Settings page restructure.** 10 block cards → tabs. New default tab: Scoring (health factors + churn bands). Additional tabs: Interventions (templates + defaults + alert limits), Blind spots (risk signals + fingerprints), Trial (onboarding milestones + staff activity), Operations (data retention + everything else). ~5 tabs × 2–3 blocks each. Largest built-code change.

2. **Dashboard simplification.** Remove `HealthSummaryCards`-style tile strip. Replace with a single "Clients" list keyed on band (Critical / At Risk / Watch / Healthy, grouped with count headers). Inline health-band dots, no sparklines, no tiles. One primary action (propose intervention).

3. **Drilldown trims.** Collapse `BandTransitionsTable` under a disclosure. Demote Config-Assistant button to a text link. Trim intervention-history attribution code blocks to compact outcome badges with raw scores deferred to an expanded row.

4. **Blueprints + Organisation Templates table column trim.** Both: 6 columns → 4. Merge Version + Created + Published into one compound column. Demote Source badge inline with Name.

5. **Surgical code fixes.**
   - `FireAutomationEditor.tsx:39` — drop `a.id` from picker row.
   - `ProposeInterventionModal.tsx:177` — drop `s.contribution` numeric render.

6. **Second-primary-action demotions.** Dashboard + Drilldown + Blueprints — one primary button per screen, others become text links or modal-embedded flows.

7. **Digest / briefing feature gating.** Decisions needed from the user:
   - Disable `intelligence-briefing.playbook.ts` per-client auto-scheduling? (deletes forward-looking per-client weekly briefings)
   - Disable `weekly-digest.playbook.ts` per-subaccount scope? (deletes backward-looking per-client weekly digests, or ships a minimal 3-line variant)
   - Keep the org-level intelligence briefing with simpler template? (yes, per audit recommendation)

8. **Minor onboarding trims.** Review actual invite-email template + celebration-screen copy for the leaked internal-config references (factor weights, band thresholds, template slugs); replace with operator-appropriate language.

---

## Sign-off checklist (for Stage 2)

Before Stage 2 mockup rewrites begin:

- [ ] User has reviewed the per-mockup recommendations above.
- [ ] User has approved / overridden each recommendation (16 simplify, 6 delete).
- [ ] User has made the digest/briefing feature-gating decisions (items 7 in Stage 3 preview).
- [ ] User has confirmed `tasks/clientpulse-mockup-capability-showcase.html` disposition (delete vs. relocate to `docs/`).

Once sign-off is complete, Stage 2 proceeds mockup-by-mockup.


---

## Group A — Core UI pages

### clientpulse-mockup-dashboard

- **Mockup file:** [prototypes/pulse/clientpulse-mockup-dashboard.html](../../../prototypes/pulse/clientpulse-mockup-dashboard.html)
- **Lives at:** `/clientpulse` (landing)
- **Source files:**
  - [client/src/pages/ClientPulseDashboardPage.tsx](../../../client/src/pages/ClientPulseDashboardPage.tsx)
  - [client/src/components/clientpulse/ProposeInterventionModal.tsx](../../../client/src/components/clientpulse/ProposeInterventionModal.tsx)
- **Built?** Partial (built UI is materially simpler than mockup — the mockup's full-screen grid + 12-week band-trend chart + sparklines + 9-column client grid were NOT shipped).
- **Parity notes:**
  - Mockup: 5 KPI tiles (Healthy / Watch / At Risk / Critical / MRR at Risk) + portfolio band-trend stacked-area chart + full client grid with per-row sparklines + intervention queue sidebar + sorting/filtering popovers.
  - Built: 4 health cards (Healthy / Watch / At Risk / Critical — no MRR tile), a "high-risk clients" list (top N with propose-intervention link), and a "latest report" widget. No trend chart, no sparklines, no grid, no filtering controls.
- **Mockup complexity violations:**
  - 5 KPI tiles on landing (cap: 0).
  - Portfolio band-trend stacked-area chart (cap: 0 charts).
  - MRR-at-risk tile = per-tenant financial rollup (explicitly deferred by principles).
  - 9-column client grid (cap: 4 columns).
- **Built-UI complexity violations:**
  - 4 KPI health cards on landing (cap: 0). Subagent flagged these as "borderline monitoring context"; by the rubric they are still a violation — the primary task on `/clientpulse` is *pick a client to drill into or act on*, not *monitor portfolio health*.
  - Configuration-assistant launch button coexists with "propose intervention" links — two primary actions on one screen (cap: 1).
- **Recommendation:** **simplify**
- **Rationale:** Drop the KPI-tile strip entirely; surface health as coloured dots on a single "Clients" list keyed to the primary task (pick → drilldown or propose-intervention). One primary action per screen.
- **Stage 3 implication:** Delete the `HealthSummaryCards`-style block, the trial banner if it's a second primary action, and consolidate to a single client list with inline health-band dots.

---

### clientpulse-mockup-drilldown

- **Mockup file:** [prototypes/pulse/clientpulse-mockup-drilldown.html](../../../prototypes/pulse/clientpulse-mockup-drilldown.html)
- **Lives at:** `/clientpulse/clients/:subaccountId`
- **Source files:**
  - [client/src/pages/ClientPulseDrilldownPage.tsx](../../../client/src/pages/ClientPulseDrilldownPage.tsx)
  - [client/src/components/clientpulse/drilldown/SignalPanel.tsx](../../../client/src/components/clientpulse/drilldown/SignalPanel.tsx)
  - [client/src/components/clientpulse/drilldown/BandTransitionsTable.tsx](../../../client/src/components/clientpulse/drilldown/BandTransitionsTable.tsx)
  - [client/src/components/clientpulse/drilldown/InterventionHistoryTable.tsx](../../../client/src/components/clientpulse/drilldown/InterventionHistoryTable.tsx)
- **Built?** Full (high-fidelity parity with the mockup).
- **Parity notes:**
  - Header card + Signal panel + Band transitions table + Intervention history table. Two header buttons (Propose intervention, Open Configuration Assistant).
- **Mockup complexity violations:**
  - 4 panels (cap: 3).
  - 2 primary actions in header (Propose + Open Config Assistant). Cap: 1.
- **Built-UI complexity violations:**
  - Same — 4 panels, 2 primary actions.
  - Intervention history table exposes `healthScoreBefore` / `healthScoreAfter` attribution code blocks inline. These are internal attribution values; admin-useful but load-bearing for the operator's decision on *the next* intervention, not for reading history.
- **Recommendation:** **simplify**
- **Rationale:** Drilldown is the operator's decision surface — keep Signal + Intervention history as the two primary panels, collapse Band transitions into an "Advanced → history" expander, and keep only the Propose-intervention button as primary (demote Config Assistant to a text link or remove; it's reachable from Settings).
- **Stage 3 implication:** Collapse `BandTransitionsTable` under a disclosure; remove secondary header button; trim intervention-history attribution code blocks to a compact outcome badge (improved / unchanged / worsened) with raw scores deferred to an expanded row.

---

### clientpulse-mockup-settings

- **Mockup file:** [prototypes/pulse/clientpulse-mockup-settings.html](../../../prototypes/pulse/clientpulse-mockup-settings.html)
- **Lives at:** `/clientpulse/settings`
- **Source files:**
  - [client/src/pages/ClientPulseSettingsPage.tsx](../../../client/src/pages/ClientPulseSettingsPage.tsx)
  - [client/src/components/clientpulse-settings/editors/*.tsx](../../../client/src/components/clientpulse-settings/editors) (10 block editors)
  - [client/src/components/clientpulse-settings/shared/ProvenanceStrip.tsx](../../../client/src/components/clientpulse-settings/shared/ProvenanceStrip.tsx)
- **Built?** Full (built is actually *denser* than mockup — 10 block cards vs 6 in mockup).
- **Parity notes:**
  - Mockup: 6 section cards (health factors, churn bands, email templates, blind-spot detection, integration fingerprints, trial milestones) + Configuration Assistant callout + ProvenanceStrip.
  - Built: 10 block cards (the 6 above + churnRiskSignals + interventionDefaults + alertLimits + staffActivity + dataRetention) + per-block typed editors + per-block save/reset.
- **Mockup complexity violations:**
  - 6 section cards on a non-admin-view surface (relaxed admin cap: 5 panels). Mockup violates by 1 panel.
- **Built-UI complexity violations:**
  - **10 block cards on one scroll surface (cap: 5 for admin-view, 3 for default).** Severe — the built UI is 2× the relaxed admin budget.
  - Each block has its own save/reset/edit — no unified primary action.
- **Recommendation:** **simplify**
- **Rationale:** Settings is the worst offender. The user's primary task is *tune one thing*, not *tune ten things*. Split into a vertical tabs layout (one tab per functional group — Scoring / Interventions / Blind spots / Trial / Operations), with 2–3 blocks visible per tab max. Configuration Assistant remains the escape hatch for non-technical users.
- **Stage 3 implication:** Restructure `ClientPulseSettingsPage` into a tabs layout; move dataRetention + staffActivity + alertLimits into an "Operations" tab; keep scoring (health factors + churn bands) as default. This is the largest built-code change in the audit.

---

### clientpulse-mockup-subaccount-blueprints

- **Mockup file:** [prototypes/pulse/clientpulse-mockup-subaccount-blueprints.html](../../../prototypes/pulse/clientpulse-mockup-subaccount-blueprints.html)
- **Lives at:** `/agents/blueprints`
- **Source files:**
  - [client/src/pages/SubaccountBlueprintsPage.tsx](../../../client/src/pages/SubaccountBlueprintsPage.tsx)
- **Built?** Full.
- **Parity notes:**
  - Mockup: table of blueprints with badge, agents count, version, created date, actions.
  - Built: exact same structure minus mockup's search input and "What changed in Phase A" banner.
- **Mockup complexity violations:**
  - 6 table columns (cap: 4).
- **Built-UI complexity violations:**
  - 6 table columns (Name + Source + Agents + Version + Created + Actions). Cap: 4.
  - 2 primary actions in header (Browse shared library + New template). Cap: 1.
- **Recommendation:** **simplify**
- **Rationale:** Collapse Version + Created into a single "Updated" timestamp column; demote Source to an inline badge next to Name; keep "+ New template" as the sole primary action and move "Browse shared library" into the modal flow triggered by New.
- **Stage 3 implication:** Reduce `SubaccountBlueprintsPage` table columns to 4 (Name-with-badge / Agents / Updated / Actions). Merge the Browse-library affordance into the Create modal as a "start from" option.

---

### clientpulse-mockup-organisation-templates

- **Mockup file:** [prototypes/pulse/clientpulse-mockup-organisation-templates.html](../../../prototypes/pulse/clientpulse-mockup-organisation-templates.html)
- **Lives at:** `/system/organisation-templates` (Synthetos-admin only)
- **Source files:**
  - [client/src/pages/SystemOrganisationTemplatesPage.tsx](../../../client/src/pages/SystemOrganisationTemplatesPage.tsx)
- **Built?** Full.
- **Parity notes:**
  - Mockup: card-grid of templates with stats (agents / op-defaults blocks / required integrations) + actions (View hierarchy / Edit operational defaults / Adoption history).
  - Built: table with columns (Name / Agents / Published / Version / Created / Actions) + import modal + preview modal.
  - Structural divergence: mockup's "Edit operational defaults" and "Adoption history" actions were deferred; built has Publish/Unpublish + Preview + Delete instead.
- **Mockup complexity violations:**
  - Card grid with per-card stat blocks — would be fine under admin-relaxed budget, but the 3-action-per-card pattern adds visual weight.
- **Built-UI complexity violations:**
  - 6 table columns even under admin-relaxed rules (cap: 4).
  - No inline indication that "Edit operational defaults" lives elsewhere — discoverability gap.
- **Recommendation:** **simplify**
- **Rationale:** Admin-only surface, so the relaxed budget applies — but 6 columns still overshoots. Collapse Published + Version + Created into one "Status · v{n} · {date}" compound column; keep Preview / Import as sole primary actions.
- **Stage 3 implication:** Trim `SystemOrganisationTemplatesPage` columns to 4. Document (in-app) that operational-defaults editing lives on the org detail page.

---

---

## Group B — Intervention action editors

These six mockups represent the runtime editors the operator uses to compose / configure an intervention (after picking an action from `ProposeInterventionModal`). Each mockup was significantly more feature-rich than what shipped — the built editors consistently trimmed template-pickers, test-buttons, preview cards, and save-as-template affordances. Most Group B recommendations are **simplify the mockup to match the shipped form-only UI**, plus a handful of built-code tightening.

### clientpulse-mockup-create-task

- **Mockup file:** [prototypes/pulse/clientpulse-mockup-create-task.html](../../../prototypes/pulse/clientpulse-mockup-create-task.html)
- **Lives at:** Editor invoked from `ProposeInterventionModal` after picking "Create task"
- **Source files:**
  - [client/src/components/clientpulse/CreateTaskEditor.tsx](../../../client/src/components/clientpulse/CreateTaskEditor.tsx)
  - [client/src/components/clientpulse-settings/editors/payloadSubEditors/CreateTaskDefaultsEditor.tsx](../../../client/src/components/clientpulse-settings/editors/payloadSubEditors/CreateTaskDefaultsEditor.tsx) (settings-level defaults, not the runtime editor)
- **Built?** Partial — runtime editor has the core fields; mockup's task-preview card + "How this works" destination callout were not shipped.
- **Parity notes:**
  - Mockup: assignee + related contact + title + notes + due date + priority + rendered "task preview card" showing how it lands in the CRM + "How this works" callout.
  - Built: all form fields present; preview card and callout omitted.
- **Mockup complexity violations:**
  - Preview card = second panel on a form surface (cap: 3, but this surface's task is *fill in and save* — a second panel is unjustified).
  - Destination callout = third panel reiterating what the submit button already does.
- **Built-UI complexity violations:** none.
- **Recommendation:** **simplify**
- **Rationale:** Rewrite the mockup to match the built (form-only) UI. The preview card is decorative; the operator sees the task in the CRM immediately after approval.
- **Stage 3 implication:** No built-code change needed.

---

### clientpulse-mockup-email-authoring

- **Mockup file:** [prototypes/pulse/clientpulse-mockup-email-authoring.html](../../../prototypes/pulse/clientpulse-mockup-email-authoring.html)
- **Lives at:** Editor invoked from `ProposeInterventionModal` after picking "Send email"
- **Source files:**
  - [client/src/components/clientpulse/EmailAuthoringEditor.tsx](../../../client/src/components/clientpulse/EmailAuthoringEditor.tsx)
- **Built?** Partial — form is built; mockup's template chooser, test-email button, and save-as-template toggle were not shipped.
- **Parity notes:**
  - Mockup: from/to pickers + subject + body + 11-field merge palette + live preview + "Start from template" dropdown + test-email button + save-as-template toggle in footer.
  - Built: from/to pickers + subject + body + 5-field merge palette + debounced live preview. No template chooser, no test, no save-as-template.
- **Mockup complexity violations:**
  - Template chooser + test-email control + save-as-template toggle = three secondary affordances on a "compose and send" surface.
  - 11-field merge palette is visual clutter; built already reduced to 5, which is correct.
- **Built-UI complexity violations:** none.
- **Recommendation:** **simplify**
- **Rationale:** Rewrite the mockup to depict the shipped form (5-field merge palette, no template picker, no test button). Template reuse and testing can be a deferred v2 enhancement if users ask.
- **Stage 3 implication:** No built-code change needed.

---

### clientpulse-mockup-fire-automation

- **Mockup file:** [prototypes/pulse/clientpulse-mockup-fire-automation.html](../../../prototypes/pulse/clientpulse-mockup-fire-automation.html)
- **Lives at:** Editor invoked from `ProposeInterventionModal` after picking "Fire automation"
- **Source files:**
  - [client/src/components/clientpulse/FireAutomationEditor.tsx](../../../client/src/components/clientpulse/FireAutomationEditor.tsx)
- **Built?** Partial — core form present; mockup's large picker card + step-by-step preview + selection summary card were not shipped.
- **Parity notes:**
  - Mockup: left-pane picker card with search + filter pills + per-automation rich metadata (step count, enrolled count, edited date, category) + right-pane details card + "What this automation does" step preview + selection summary.
  - Built: single `LiveDataPicker` field + contact picker + scheduling toggle + rationale field. Picker's `renderItem` **renders `a.id` as metadata** (internal CRM identifier leakage).
- **Mockup complexity violations:**
  - Two-pane layout (picker + details) = second panel (borderline acceptable, but paired with step preview = 3 panels on an editor).
  - Step preview list on an editor surface — should be a hover / disclosure, not always-visible.
- **Built-UI complexity violations:**
  - **`a.id` exposure in `FireAutomationEditor.tsx:39` — internal CRM automation ID surfaced to the operator.** Cap: 0 hash/ID exposures by default.
- **Recommendation:** **simplify**
- **Rationale:** Rewrite the mockup to match the shipped form. Fix the `a.id` leakage in built code — the picker should show name + step count + last-edited date, not the raw ID.
- **Stage 3 implication:** Edit `FireAutomationEditor.tsx:39` to drop `a.id` from the picker row; if a step-count helper is desired, surface it as `{stepCount} steps` text only.

---

### clientpulse-mockup-operator-alert

- **Mockup file:** [prototypes/pulse/clientpulse-mockup-operator-alert.html](../../../prototypes/pulse/clientpulse-mockup-operator-alert.html)
- **Lives at:** Editor invoked from `ProposeInterventionModal` after picking "Notify operator"
- **Source files:**
  - [client/src/components/clientpulse/OperatorAlertEditor.tsx](../../../client/src/components/clientpulse/OperatorAlertEditor.tsx)
- **Built?** Full — mockup's preview card and destination callout are the only omissions.
- **Parity notes:**
  - Mockup: title + message + severity toggle + recipient preset + channel checkboxes + rendered "how it lands in Kel's notification tray" preview card + "how this works" callout + "Slack requires Operate tier" helper.
  - Built: all functional fields present, preview + callouts + helper text omitted.
- **Mockup complexity violations:** Preview card + callouts = two decorative panels beyond the form.
- **Built-UI complexity violations:** none.
- **Recommendation:** **simplify**
- **Rationale:** Rewrite the mockup to depict the shipped form. Operators don't need to see the rendered notification tray — they know what an in-app toast looks like.
- **Stage 3 implication:** No built-code change needed.

---

### clientpulse-mockup-propose-intervention

- **Mockup file:** [prototypes/pulse/clientpulse-mockup-propose-intervention.html](../../../prototypes/pulse/clientpulse-mockup-propose-intervention.html)
- **Lives at:** Modal invoked from the drilldown page (and accessible from dashboard rows)
- **Source files:**
  - [client/src/components/clientpulse/ProposeInterventionModal.tsx](../../../client/src/components/clientpulse/ProposeInterventionModal.tsx)
- **Built?** Full — tight parity with the mockup including the outcome-weighted RECOMMENDED badge on the action picker.
- **Parity notes:**
  - 2-column layout (left: context pane with health + top signals + recent interventions + cooldown state; right: action picker + per-action editor).
- **Mockup complexity violations:** 2 panels (context + build). Within cap.
- **Built-UI complexity violations:**
  - **Raw `s.contribution` scores rendered inline in the Top Signals section (`ProposeInterventionModal.tsx:177`).** This is a diagnostic value (float attribution weight) that doesn't inform the operator's action — they only need the signal name.
- **Recommendation:** **simplify**
- **Rationale:** Mockup is fine; rewrite only if we simplify the built UI. Built needs one small fix: drop the numeric contribution score, keep the signal name as a chip or bulleted row.
- **Stage 3 implication:** Edit `ProposeInterventionModal.tsx:177` to remove the `{s.contribution}` render; keep signal name and optional "↑ high / ↓ low" direction indicator if it's load-bearing.

---

### clientpulse-mockup-send-sms

- **Mockup file:** [prototypes/pulse/clientpulse-mockup-send-sms.html](../../../prototypes/pulse/clientpulse-mockup-send-sms.html)
- **Lives at:** Editor invoked from `ProposeInterventionModal` after picking "Send SMS"
- **Source files:**
  - [client/src/components/clientpulse/SendSmsEditor.tsx](../../../client/src/components/clientpulse/SendSmsEditor.tsx)
- **Built?** Partial — form present; mockup's phone-bubble preview, Send/Schedule dropdown, test-SMS block, and save-as-template toggle were not shipped.
- **Parity notes:**
  - Mockup: from-number picker + to-contact picker + message textarea with char counter + phone-style blue-bubble preview + merge palette + Send/Schedule dropdown + test-SMS block + save-as-template toggle.
  - Built: from/to pickers + message textarea + segment-aware char counter + 7-field merge palette + debounced plain-text preview. No phone bubble, no schedule dropdown, no test, no save-as-template.
- **Mockup complexity violations:** Same pattern as email — template chooser + test + save-as-template = three secondary affordances beyond the compose-and-send task.
- **Built-UI complexity violations:** none.
- **Recommendation:** **simplify**
- **Rationale:** Rewrite the mockup to depict the shipped form. Phone-bubble preview is cosmetic; segment-aware char counter already communicates delivery cost.
- **Stage 3 implication:** No built-code change needed.

---

---

## Group C — Template editor, inline-edit pattern, config chat

### clientpulse-mockup-template-editor

- **Mockup file:** `tasks/clientpulse-mockup-template-editor.html` (DELETED Stage 2 — approved)
- **Lives at:** Pattern realised inline on `/clientpulse/settings` (per-block typed editors), NOT as a standalone modal with tab-staging.
- **Source files:**
  - [client/src/components/clientpulse-settings/editors/InterventionTemplatesEditor.tsx](../../../client/src/components/clientpulse-settings/editors/InterventionTemplatesEditor.tsx)
  - [client/src/components/clientpulse-settings/editors/HealthScoreFactorsEditor.tsx](../../../client/src/components/clientpulse-settings/editors/HealthScoreFactorsEditor.tsx)
  - [client/src/components/clientpulse-settings/editors/ChurnBandsEditor.tsx](../../../client/src/components/clientpulse-settings/editors/ChurnBandsEditor.tsx)
  - [client/src/components/clientpulse-settings/shared/ProvenanceStrip.tsx](../../../client/src/components/clientpulse-settings/shared/ProvenanceStrip.tsx)
- **Built?** Partial — the mockup depicts a single rich modal with left-nav tabs + "unsaved edits" cross-tab staging + "Discard all" semantics. What shipped is the simpler per-block inline edit pattern on the Settings page.
- **Parity notes:**
  - Mockup: one modal with left-nav tabs (Health factors / Churn bands / Interventions / Integrations / Onboarding) + orange "dirty" dots per nav + cross-tab "unsaved edits" banner + "Discard all" action.
  - Built: 10 independent block cards on the Settings page. Each block has its own save + reset + typed editor. No cross-tab staging, no "dirty" nav, no discard-all.
- **Mockup complexity violations:**
  - Cross-tab staging adds cognitive overhead (operator must remember which tab has unsaved edits). Violates "one primary action per screen" — Save-this-block vs Save-all-tabs conflict.
- **Built-UI complexity violations:** inherits Settings violations (10 blocks in one scroll; covered above in the settings entry).
- **Recommendation:** **delete**
- **Rationale:** The mockup described a design pattern that was explicitly simplified away during build — the shipped design is *better* than the mockup and more aligned with the new principles. Keeping the mockup around as a reference would mislead future design work toward the rejected modal-with-tab-staging pattern.
- **Stage 3 implication:** No built-code change from this mockup specifically; settings consolidation is already covered in the Settings entry.

---

### clientpulse-mockup-inline-edit

- **Mockup file:** `tasks/clientpulse-mockup-inline-edit.html` (DELETED Stage 2 — approved)
- **Lives at:** **DESIGN-ONLY — never built.**
- **Source files:** None.
- **Built?** Not built.
- **Parity notes:**
  - Mockup describes inline "acknowledge / snooze / disable pattern / change threshold / copy evidence" affordances on a per-client briefing email view, backed by a toast-and-undo flow and a deep-link to Settings.
  - No briefing display surface, no such inline menu, no such toast-undo flow exists in the codebase.
- **Mockup complexity violations:**
  - 5-item overflow menu on a briefing view — every item is a configuration shortcut that belongs in Settings. Violates "is every element load-bearing for the primary task?" — primary task on a briefing is *read the briefing*, not *re-tune the blind-spot detector*.
- **Built-UI complexity violations:** N/A (not built).
- **Recommendation:** **delete**
- **Rationale:** Feature was never built and conflicts with the principle that configuration belongs in Settings, not inline on a read surface. Future inline-control patterns should be designed from a primary task — this one was designed from the data model.
- **Stage 3 implication:** No built-code change.

---

### clientpulse-mockup-config-assistant-chat

- **Mockup file:** [prototypes/pulse/clientpulse-mockup-config-assistant-chat.html](../../../prototypes/pulse/clientpulse-mockup-config-assistant-chat.html)
- **Lives at:** `/admin/config-assistant` (ConfigAssistantPage) + a popup via `useConfigAssistantPopup`
- **Source files:**
  - [client/src/pages/ConfigAssistantPage.tsx](../../../client/src/pages/ConfigAssistantPage.tsx)
  - [client/src/components/config-assistant/ConfigAssistantPopup.tsx](../../../client/src/components/config-assistant/ConfigAssistantPopup.tsx)
  - [client/src/hooks/useConfigAssistantPopup.tsx](../../../client/src/hooks/useConfigAssistantPopup.tsx)
- **Built?** Full — core chat + dual-path governance (auto-apply vs review-queue) + confirmation previews + deep-link `?prompt=` + 15-minute session resume all shipped.
- **Parity notes:**
  - Mockup vs built: very close parity on the primary chat flow. Omitted in build: minimised-state pill ("Plan executing — 3 of 5 steps"); Undo / View in settings / See history action buttons on confirmation messages.
- **Mockup complexity violations:**
  - Minimised-state pill, Undo / View in settings / See history buttons — these expose a richer surface than the shipped "Open review queue / Cancel request" pair, which is the correct reduction.
- **Built-UI complexity violations:**
  - None — chat UIs operate under a different rule (inherently conversational), and the shipped version adheres to progressive disclosure (starter chips → depth as the user engages).
- **Recommendation:** **simplify**
- **Rationale:** Rewrite the mockup to reflect the shipped simpler surface — drop the minimised-state pill and the three extra action buttons from the confirmation cards. This prevents the mockup from tempting a future designer into adding affordances that were deliberately cut.
- **Stage 3 implication:** No built-code change needed.

---

---

## Group D — Onboarding and digest / briefing surfaces

This group holds the heaviest design debt. The digest/briefing mockups reproduce dashboard metrics inside emails, narrate intervention causality, expose internal memory/belief state, and mix forward-looking content into backward-looking digests. The onboarding mockups leak internal factor weights, churn-band thresholds, and template counts into non-admin-facing screens.

### clientpulse-mockup-onboarding-orgadmin

- **Mockup file:** [prototypes/pulse/clientpulse-mockup-onboarding-orgadmin.html](../../../prototypes/pulse/clientpulse-mockup-onboarding-orgadmin.html)
- **Lives at:** `/welcome` wizard + `/integrations/ghl` OAuth flow + `/welcome?complete=1` celebration.
- **Source files:**
  - [client/src/pages/OnboardingWizardPage.tsx](../../../client/src/pages/OnboardingWizardPage.tsx)
  - [server/playbooks/intelligence-briefing.playbook.ts](../../../server/playbooks/intelligence-briefing.playbook.ts) (autoStartOnOnboarding)
  - [server/playbooks/weekly-digest.playbook.ts](../../../server/playbooks/weekly-digest.playbook.ts) (autoStartOnOnboarding)
- **Built?** Partial — the wizard flow exists and is simpler than the mockup; the mockup's invite-email content + 6-step sync progress + 4-tile celebration screen were not shipped as-designed.
- **Parity notes:**
  - Mockup screen 1 (invite email): lists health-factor weights, churn-band thresholds, intervention template names, fingerprint counts. Built invite-email content is generic (standard `emailService`).
  - Mockup screen 2 (welcome + checklist): shipped roughly.
  - Mockup screen 3 (OAuth + sync progress): 6 sync steps with rich counts ("87 sub-accounts", "128,400 contacts", "2,840 opps"). Built sync is 4 simpler steps.
  - Mockup screen 4 (celebration): 4 KPI tiles (sub-account count, pending reviews, "needing attention", MRR at risk). Built celebration is simpler.
- **Mockup complexity violations:**
  - Invite email leaks internal config (weight values, band thresholds, template slugs) — violates "no exposure of internal identifiers to primary user". The org-admin doesn't need to see "weight 0.30" to accept an invite.
  - Sync progress dumps 6 line-item counts ("128,400 contacts") — observability bleed into onboarding.
  - Celebration KPI tiles on a post-onboarding success screen (cap: 0 by default). Primary task there is *celebrate and move on*, not *monitor*.
- **Built-UI complexity violations:** none severe — the build already trimmed most of this.
- **Recommendation:** **simplify**
- **Rationale:** Rewrite the mockup's invite-email content to read like a welcome message (not a config dump); reduce sync progress to 3–4 steps without raw counts (one progress bar per step is enough); replace the celebration KPI strip with a single "Your workspace is ready — open dashboard →" CTA.
- **Stage 3 implication:** Audit the actual onboarding email template + celebration page for matches to the simplified mockup; likely only minor trimming.

---

### clientpulse-mockup-onboarding-sysadmin

- **Mockup file:** [prototypes/pulse/clientpulse-mockup-onboarding-sysadmin.html](../../../prototypes/pulse/clientpulse-mockup-onboarding-sysadmin.html)
- **Lives at:** `/system/organisations` (Create Organisation modal)
- **Source files:**
  - [client/src/pages/SystemOrganisationsPage.tsx](../../../client/src/pages/SystemOrganisationsPage.tsx)
- **Built?** Full — modal with template picker + tier toggle shipped. The mockup's right-side preview pane was not built.
- **Parity notes:**
  - Mockup: two-pane modal (form left, preview pane right) showing 6 sections of the selected template's content (health factors, churn bands, interventions, fingerprints, scan schedule, operate-tier unlocks) + footer note exposing `operational_defaults` / `operational_config` / `system_hierarchy_templates` table names.
  - Built: single scrollable form card with template picker and tier toggle — preview pane and footer not shipped.
- **Mockup complexity violations:**
  - Preview pane reproduces the template editor on a create-org modal (wrong surface — preview belongs on the template detail page).
  - Footer exposes SQL table names to a Synthetos admin. This is "internal identifier" leakage even under admin-relaxed rules — table names aren't load-bearing for *create an org*.
- **Built-UI complexity violations:** none.
- **Recommendation:** **simplify**
- **Rationale:** Rewrite the mockup to depict the shipped single-pane form. Delete the preview pane and the table-name footer from the mockup.
- **Stage 3 implication:** No built-code change.

---

### clientpulse-mockup-briefing-per-client

- **Mockup file:** [prototypes/pulse/clientpulse-mockup-briefing-per-client.html](../../../prototypes/pulse/clientpulse-mockup-briefing-per-client.html)
- **Lives at:** `server/playbooks/intelligence-briefing.playbook.ts` (scheduled Monday 07:00; playbook exists, actual rendered email template not pinned in codebase).
- **Source files:**
  - [server/playbooks/intelligence-briefing.playbook.ts](../../../server/playbooks/intelligence-briefing.playbook.ts)
  - [server/services/deliveryService.ts](../../../server/services/deliveryService.ts)
  - [client/src/pages/PortalPage.tsx](../../../client/src/pages/PortalPage.tsx) (shows only a "briefing is ready" hero card, not full content)
- **Built?** Partial — playbook shipped and is scheduled; the per-client rendered briefing content (as depicted) is NOT pinned anywhere the audit can verify matches the mockup.
- **Parity notes:**
  - Mockup is a forward-looking per-client intelligence brief: TL;DR narrative + ClientPulse snapshot (band + top signals) + 4 numbered priorities + pending-intervention CTA + upcoming events + team-activity inference ("Ben's silence is your silence") + dashboard CTA.
  - Built: playbook produces generic JSON output; actual email rendering relies on delivery service and template handlers that the audit could not pin to match.
- **Mockup complexity violations:**
  - Reproduces dashboard narrative inside email (duplication).
  - Narrates system inference in first-person ("your silence") — editorialising on top of cold signals.
  - Mixes operational language ("At Risk (28)") with narrative voice — confusing register.
  - 5 distinct sections on a per-client email (briefings should be tight).
- **Built-UI complexity violations:** N/A (template content not verifiable).
- **Recommendation:** **delete** (defer the feature, delete the mockup)
- **Rationale:** Per-client forward-looking briefings duplicate dashboard content and are an anti-pattern per principles. If forward-looking signal is needed, it belongs on the drilldown page (where context already lives), not in a weekly per-client email. Defer the feature; delete the mockup so future designers don't resurrect it.
- **Stage 3 implication:** Disable `intelligence-briefing.playbook.ts`'s auto-scheduled per-client runs in Stage 3 (or gate behind a feature flag). Portfolio-level intelligence briefing, if wanted, is a different surface with a different design.

---

### clientpulse-mockup-digest-per-client

- **Mockup file:** [prototypes/pulse/clientpulse-mockup-digest-per-client.html](../../../prototypes/pulse/clientpulse-mockup-digest-per-client.html)
- **Lives at:** `server/playbooks/weekly-digest.playbook.ts` (scope: 'subaccount'; scheduled Friday 17:00).
- **Source files:**
  - [server/playbooks/weekly-digest.playbook.ts](../../../server/playbooks/weekly-digest.playbook.ts)
  - [server/services/deliveryService.ts](../../../server/services/deliveryService.ts)
- **Built?** Partial — playbook shipped and scheduled; rendered content not pinned.
- **Parity notes:**
  - Mockup is a backward-looking per-client digest: TL;DR + 4 KPI tiles with WoW deltas + 6-item work list + intervention-outcome cards narrating causality ("check-in email Monday → client logged in Wednesday → built funnel") + memory tags (belief/pattern/cooldown) with explanations + forward-looking "Monday handoff" bridge.
- **Mockup complexity violations:**
  - 4 KPI tiles in a digest (cap: 0).
  - Intervention-outcome cards narrate causal chains with attribution deltas ("82→87") — that is retrospective observability, not digest.
  - Memory block exposes system beliefs ("Ben responds to text, not email") + pattern-learning ("funnel refresh moved conversion 1.8%→3.1%") as first-class email content — internal system state leaked to the operator.
  - "Monday handoff" is forward-looking inside a backward-looking digest — blurs with the per-client briefing, meaning users get both surfaces competing for attention.
  - 20+ distinct UI elements for a weekly summary.
- **Built-UI complexity violations:** N/A (content not verifiable).
- **Recommendation:** **delete** (defer the feature, delete the mockup)
- **Rationale:** Same reasoning as briefing-per-client — duplicates dashboard content and leaks internals. If weekly per-client summary is wanted, it should be a 3-line status email (band change + top 1 action needed), not a 20-element digest. Defer the rich variant; delete the mockup.
- **Stage 3 implication:** Disable or gate `weekly-digest.playbook.ts`'s per-subaccount scope; either ship a minimal 3-line variant or scrap the feature entirely pending user research.

---

### clientpulse-mockup-weekly-digest

- **Mockup file:** `tasks/clientpulse-mockup-weekly-digest.html` (DELETED Stage 2 — approved)
- **Lives at:** **DESIGN-ONLY — never built.** Describes a NEW org-level `weekly-digest-org.playbook.ts` that was slated for Phase 0.5 but never shipped. `portfolioRollupJob.ts` is the closest pre-playbook equivalent and does not render the mockup design.
- **Source files:**
  - [server/jobs/portfolioRollupJob.ts](../../../server/jobs/portfolioRollupJob.ts) (existing, pre-playbook, does not match mockup)
  - No `weekly-digest-org.playbook.ts` exists.
- **Built?** Not built.
- **Parity notes:**
  - Mockup: org-level digest with 87-client portfolio sweep — WoW health table (5 bands × 4 columns), churn projection card, 6 intervention-outcome cards, watchlist (3 cards), activity highlights (4 cards), memory queue (3 rows). ~25+ distinct UI elements.
- **Mockup complexity violations:**
  - Reproduces the dashboard's health-band counts inside a digest.
  - 25+ UI elements — far beyond any reasonable digest budget.
  - Memory queue exposes belief conflicts / auto-applied blocks / clarification question counts / unclassified fingerprint counts — internal system state.
  - Watchlist for Monday blurs digest and briefing.
- **Built-UI complexity violations:** N/A (not built).
- **Recommendation:** **delete**
- **Rationale:** Feature was never built. The design is an anti-pattern that duplicates dashboard and exposes internal memory state. If org-level weekly signal is genuinely wanted, the correct surface is the dashboard itself (which already shows band distribution) plus an optional 3-line email ("5 clients moved from Healthy → Watch this week"). Delete the mockup so future designers don't resurrect the 25-element version.
- **Stage 3 implication:** No built code to remove. Decision to scrap vs reduce the weekly-digest-org concept belongs outside this audit.

---

---

## Group E — Operator alert received, intelligence briefing, capability showcase

### clientpulse-mockup-operator-alert-received

- **Mockup file:** [prototypes/pulse/clientpulse-mockup-operator-alert-received.html](../../../prototypes/pulse/clientpulse-mockup-operator-alert-received.html)
- **Lives at:** `/pulse` (attention tab) — rendered via the Lane-based PulsePage UI.
- **Source files:**
  - [client/src/pages/PulsePage.tsx](../../../client/src/pages/PulsePage.tsx)
  - [client/src/components/pulse/Lane.tsx](../../../client/src/components/pulse/Lane.tsx)
  - [client/src/components/pulse/Card.tsx](../../../client/src/components/pulse/Card.tsx)
  - [client/src/components/pulse/ActionBar.tsx](../../../client/src/components/pulse/ActionBar.tsx)
  - [client/src/components/pulse/MajorApprovalModal.tsx](../../../client/src/components/pulse/MajorApprovalModal.tsx)
- **Built?** Full — built UI uses a Kanban-like three-lane design (client / major / internal) with per-card approve/reject; mockup uses a notification-inbox metaphor.
- **Parity notes:**
  - Mockup: notification tray with filter chips + one expanded urgent alert showing signal-strip context (health band, staff activity, retention window, tier, funnel status) + two collapsed older items.
  - Built: swimlanes + cards with title / reasoning / subaccount / agent / cost summary + collapsible "Show evidence" disclosure. No inline signal strip on the card.
- **Mockup complexity violations:**
  - Signal strip on an alert card is inline observability (health band / staff activity / tier / funnel status) that the operator doesn't need to decide *approve / reject / defer*. Four diagnostic pills violate the "is every element load-bearing for the primary task?" test.
- **Built-UI complexity violations:**
  - None — the built version correctly deferred signals to progressive disclosure (collapse evidence) and the drilldown link.
- **Recommendation:** **simplify**
- **Rationale:** Rewrite the mockup to reflect the shipped lane-based card design. Drop the signal strip entirely — if an approver wants context they open the drilldown. This also aligns the mockup with the built UI's simpler surface so future design work starts from the right baseline.
- **Stage 3 implication:** No built-code change needed.

---

### clientpulse-mockup-intelligence-briefing

- **Mockup file:** [prototypes/pulse/clientpulse-mockup-intelligence-briefing.html](../../../prototypes/pulse/clientpulse-mockup-intelligence-briefing.html)
- **Lives at:** `server/playbooks/intelligence-briefing.playbook.ts` — note this is a different scope from `briefing-per-client`: this mockup appears to target the **org-level** portfolio briefing (forward-looking, Monday 07:00). The playbook file supports both scopes depending on configuration.
- **Source files:**
  - [server/playbooks/intelligence-briefing.playbook.ts](../../../server/playbooks/intelligence-briefing.playbook.ts)
  - [server/playbooks/intelligence-briefing.schema.ts](../../../server/playbooks/intelligence-briefing.schema.ts)
- **Built?** Partial — playbook shipped, rendered email template not pinned.
- **Parity notes:**
  - Mockup: portfolio briefing with TL;DR + 4 projected-KPI tiles (Projected Critical / Projected At Risk / Projected Watch / MRR at Risk) + Awaiting Approval CTA + Watch this week (account list) + Tier-downgrade windows + Trial milestones + Cooldown endings + Integration classification + CTA footer.
- **Mockup complexity violations:**
  - 4 KPI tiles (cap: 0 for non-monitoring surface; briefings are forward-looking reading, not monitoring).
  - Multiple account lists (Watch / Tier-downgrade / Trial / Cooldown / Integration) — five sub-lists beyond TL;DR is dense even for a briefing.
  - Specific dollar amounts mixed with forecast percentages — precision theatre (projecting MRR-at-risk to the dollar weekly is spurious).
- **Built-UI complexity violations:** N/A (content not verifiable, but the playbook produces JSON that is rendered downstream; check the actual template in Stage 3).
- **Recommendation:** **simplify**
- **Rationale:** Unlike `briefing-per-client`, an **org-level** forward-looking briefing has legitimate value (portfolio awareness driving operator attention). But it must be tight: TL;DR + 3–5 bullets on what to do this week, no KPI tiles, no per-account sub-lists. Rewrite the mockup to depict that simpler form. Keep the feature, delete the density.
- **Stage 3 implication:** Audit the actual rendered intelligence-briefing email template against the simplified mockup; trim KPI tiles and sub-list density. If the template produces content dynamically from the playbook output, tighten the playbook's `research` step's output shape.

---

### clientpulse-mockup-capability-showcase

- **Mockup file:** `tasks/clientpulse-mockup-capability-showcase.html` (DELETED Stage 2 — approved; was 117 KB)
- **Lives at:** **DESIGN-ONLY — no product surface.** This is a 117KB capabilities-reference document cataloguing intervention scenarios (13 types), event types, blind-spot patterns, outcome narratives, memory tags (13 types), handoff teasers, integration fingerprints, top movers, KPI types, review-queue item types, cold-start states, tier-migration events, and agent action types.
- **Source files:** None.
- **Built?** Not built (and shouldn't be — it's an engineering reference, not a product surface).
- **Parity notes:**
  - Annotation banner on the file explicitly states "Exhaustive reference of the item types ClientPulse + Automation OS can surface". Includes "[spec only]" markers for unbuilt items.
- **Mockup complexity violations:**
  - N/A — a reference document is not a UI artifact and sits outside the principles.
- **Built-UI complexity violations:** N/A.
- **Recommendation:** **delete** (from `tasks/`; optionally relocate)
- **Rationale:** This doesn't belong in `tasks/clientpulse-mockup-*.html` alongside actual product mockups — it's a capabilities catalogue that will confuse future sessions into thinking a "Capability Showcase" page is in-scope. If the catalogue still has reference value, move it to `docs/clientpulse-capability-reference.md` (convert to markdown) or to a new `docs/product-reference/` folder; otherwise delete outright. My recommendation is to **delete outright** — most of the content is already duplicated in `dev-spec-pulse.md` and `capabilities.md`, and leaving a 117KB HTML design artifact in the repo invites stale drift.
- **Stage 3 implication:** None.

---

---

## Cross-cutting findings

*(filled in Chunk 7)*

---

## Stage 3 preview — anticipated built-code changes

*(filled in Chunk 7)*
