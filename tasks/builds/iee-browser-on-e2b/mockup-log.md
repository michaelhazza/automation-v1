# Mockup log — iee-browser-on-e2b

## Round 1 — 2026-05-13 (initial draft)

**Operator feedback:** initial draft

---

**Codebase grounding (Step 0a) — PER SCREEN (mandatory):**

- **iee-browser-on-e2b.html (single screen, Operator tab):**
  extends `client/src/pages/AdminSubaccountDetailPage.tsx`
  extends `client/src/pages/govern/operatorSettings/OperatorSettingsTab.tsx`
  extends `client/src/pages/govern/operatorSettings/_fields.tsx`
  prior prototype extended: `prototypes/operator-backend/r13-subaccount-operator-settings-tab.html`

---

**Codebase grounding — round-wide:**

Files read:
- `docs/frontend-design-principles.md`
- `tasks/builds/iee-browser-on-e2b/brief.md`
- `prototypes/operator-backend/r13-subaccount-operator-settings-tab.html`
- `prototypes/operator-backend/_shared.css`
- `client/src/pages/AdminSubaccountDetailPage.tsx` (first 270 lines)
- `client/src/pages/govern/operatorSettings/OperatorSettingsTab.tsx`
- `client/src/pages/govern/operatorSettings/_fields.tsx`

Vocabulary and conventions inherited (quoted from codebase):
- `type ActiveTab = 'onboarding' | 'engines' | 'workflows' | 'agents' | 'beliefs' | 'categories' | 'tags' | 'board' | 'operator' | 'usage' | 'admin' | 'workspace'`
- `TAB_LABELS: { ..., operator: 'Operator', usage: 'Usage & Costs', admin: 'Admin' }`
- `canSeeOperatorTab = mode === 'admin' && (role === 'org_admin' || role === 'manager' || role === 'system_admin')`
- `canEditOperatorSettings = role === 'org_admin' || role === 'system_admin'`
- `inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500'`
- Tab active state: `border-indigo-600 text-indigo-600 font-semibold`
- `NumberField` component: `grid-cols-[1fr_160px]`, `py-3.5 px-5 border-b border-slate-50 last:border-b-0`
- Field input: `w-[90px] px-2.5 py-1.5 border border-slate-300 rounded-lg text-[13px] text-right font-mono`
- Section card pattern: `bg-white border border-slate-200 rounded-xl mb-5 overflow-hidden shadow-sm`
- Section header: `px-5 py-3.5 border-b border-slate-100`, `text-[14px] font-bold text-slate-800`
- Save footer copy: "Changes apply to new sessions only. In-progress sessions are not affected."
- Save button: `btn btn-primary` — `Save settings`
- `admin-only-pill`: `eef2ff` background, `4338ca` text, `c7d2fe` border — "Org admin"
- Sidebar: `#0f172a` background, `#4f46e5` logo icon, `#10b981` client dot

New dedicated pages proposed: none. All additions extend the existing Operator tab surface.

---

**Changes made:**
- Created `prototypes/iee-browser-on-e2b.html` as a single-file prototype
- Reproduced the full Operator tab (Session limits + Task limits sections) from r13 / OperatorSettingsTab.tsx verbatim, to give review context
- Appended new "IEE browser" section below the existing sections, containing:
  1. Launch flag: on/off toggle with "On"/"Off" label (interactive via JS)
  2. Warm pool size: number input 0-5, default 1, unit "sandboxes"
  3. Browser profile retention: number input 7-90, default 30, unit "days"
  4. Cost guardrails: two sub-groups (per-task ceiling with minutes + cents sub-fields; per-day ceiling with cents/day sub-field), each with incident event name chip
- Spend widget (month-to-date sandbox compute): omitted. Settings screen primary task is configuration, not monitoring. Month-to-date spend belongs on Usage & Costs tab.

---

**Frontend-design-principles checks:**

- Start with primary task: YES. Primary task is "configure IEE browser controls for this subaccount." All fields map directly to the configurable knobs from the brief. No exploratory or monitoring content.
- Default to hidden: YES. Spend widget deliberately omitted (monitoring content, not configuration). Cost guardrail section is compact and grouped, not a dashboard.
- One primary action: YES. Single "Save settings" button remains the only commit action on the tab.
- Inline state: YES. Toggle state ("On"/"Off") is inline next to the control. No separate status panel.
- Re-check passed: YES. Non-technical operator sees four configuration fields in a clearly labelled section. Toggle is self-evident. Number inputs have units. Help text is one sentence per field.
- Extends existing surface: YES. All new fields added inside the existing "Operator" tab as a new section card. No new tab, no new nav entry, no new page.

**Rule violations flagged:** none

---

**Files modified:**
- `prototypes/iee-browser-on-e2b.html` (created)
- `tasks/builds/iee-browser-on-e2b/mockup-log.md` (created)

---

**Design choices made (for operator review):**

1. **Toggle vs checkbox.** Used a toggle switch (matching common admin settings UIs) rather than a checkbox, to make the on/off state more legible at a glance. The label updates to "On" / "Off" interactively.

2. **Warm pool unit label.** Used "sandboxes" rather than a bare number, so the operator understands what 0-5 refers to without reading the help text.

3. **Cost guardrails as sub-groups, not separate field rows.** Per-task ceiling has two inputs (minutes + cents) that are logically paired — they are displayed as a group rather than two separate field rows, to make clear that both fire the same incident event. The incident event name is shown as a small amber chip inline.

4. **Incident chip styling.** Used the amber/yellow chip (consistent with `status-pending` pill in `_shared.css`) to signal "this is an alert event, not a completion event." No red because incidents are advisory, not blocking.

5. **Help text length.** All help texts are one short sentence, per the "one short sentence per field" rule. Profile retention includes the plain-English explanation of what a "browser profile" is (per brief §3.3 explainer instruction).

6. **"Org admin" pill on section header.** Consistent with the existing `admin-only-pill` pattern used on the tab button itself.

7. **Spend widget omitted.** The brief marks this as "optional, your call." Primary task on this screen is configuration. Month-to-date sandbox spend belongs on Usage & Costs, not on a settings tab where it would be decoration.

---

**What to look at in operator review:**

- Toggle vs dedicated "Enabled / Disabled" select — does the toggle feel right for an admin settings context?
- Incident chip styling — is the amber enough signal, or should these be inline text instead?
- Cost guardrail layout — are the per-task sub-fields (minutes + cents stacked vertically on the right) scannable, or would a single row per sub-field (with label on the left) be clearer?
- "sandboxes" as the unit for warm pool size — acceptable, or prefer "slots" or no unit?
- Spend widget omission — confirmed acceptable, or should it appear?

---

## Round 2 — 2026-05-13 15:00

**Operator feedback:** Round 1 carried too many knobs and leaked technical terms. Six specific directives applied this round: (1) drop warm-pool size field, (2) replace dual minutes+cents ceiling with single dollar ceiling, (3) remove event-name chips, (4) relabel toggle as "Status" kill switch, (5) show cost ceilings in dollars not cents, (6) no spend widget (reconfirmed from round 1).

---

**Codebase grounding (Step 0a) — PER SCREEN (mandatory):**

- **iee-browser-on-e2b.html (single screen, Operator tab):**
  extends `client/src/pages/AdminSubaccountDetailPage.tsx`
  extends `client/src/pages/govern/operatorSettings/OperatorSettingsTab.tsx`
  extends `client/src/pages/govern/operatorSettings/_fields.tsx`
  prior prototype inherited: `prototypes/operator-backend/r13-subaccount-operator-settings-tab.html`

---

**Codebase grounding — round-wide:**

Files read this round:
- `docs/frontend-design-principles.md`
- `tasks/builds/iee-browser-on-e2b/brief.md` (v3 reframe block read)
- `tasks/builds/iee-browser-on-e2b/mockup-log.md` (round 1 entry)
- `prototypes/iee-browser-on-e2b.html` (round 1 output)
- `prototypes/operator-backend/r13-subaccount-operator-settings-tab.html`
- `prototypes/operator-backend/_shared.css`
- `client/src/pages/govern/operatorSettings/OperatorSettingsTab.tsx`
- `client/src/pages/govern/operatorSettings/_fields.tsx`

Vocabulary and conventions inherited (quoted from codebase):
- `grid grid-cols-[1fr_160px] items-start gap-4 py-3.5 px-5 border-b border-slate-50 last:border-b-0` — NumberField row grid from `_fields.tsx`
- `w-[90px] px-2.5 py-1.5 border border-slate-300 rounded-lg text-[13px] text-slate-800 bg-white text-right font-mono` — number input class from `_fields.tsx`
- `bg-white border border-slate-200 rounded-xl mb-5 overflow-hidden shadow-sm` — section card from `OperatorSettingsTab.tsx`
- `px-5 py-3.5 border-b border-slate-100` — section header from `OperatorSettingsTab.tsx`
- `text-[14px] font-bold text-slate-800` — section title from `OperatorSettingsTab.tsx`
- Save footer copy: "Changes apply to new sessions only. In-progress sessions are not affected."
- Tab active: `color: #4f46e5; border-bottom-color: #4f46e5; font-weight: 600`
- `admin-only-pill`: `#eef2ff` background, `#4338ca` text, `#c7d2fe` border
- Sidebar: `#0f172a` background, `#4f46e5` logo icon, `#10b981` client dot

New dedicated pages proposed: none. All additions extend the existing Operator tab.

---

**Changes made:**

- Removed warm-pool size field entirely (§3.4 / §4 item 5 — hardcoded to 1 in V1)
- Replaced per-task dual ceiling (minutes + cents) with a single dollar-denominated currency input; default $1.00
- Replaced per-subaccount daily ceiling (cents) with a single dollar-denominated currency input; default $5.00
- Removed all incident event-name chips (`iee_browser.task_cost_anomaly`, `iee_browser.subaccount_cost_anomaly`); replaced with plain-English help text per field
- Relabelled launch flag from "Enable IEE browser tasks" to "Status"; new help text: "When off, this subaccount cannot run any IEE browser tasks. Use to disable for support escalations."
- New toggle label behaviour: "Off" state dims the label text to `#94a3b8` to reinforce the disabled state visually
- Added currency input component: `$` prefix element joined flush to input left edge; focus ring extends across both prefix and input via `.currency-wrap:focus-within`; font-mono for number alignment
- Retained "IEE browser" section in same position (third section, after Session limits and Task limits), same `admin-only-pill` on section header
- Save footer and all other tab content unchanged

---

**Frontend-design-principles checks:**

- Start with primary task: YES. Four fields, all config. No monitoring content.
- Default to hidden: YES. No spend widget, no event names, no raw cents values.
- One primary action: YES. Single "Save settings" button, same as rest of the tab.
- Inline state: YES. Toggle state (On/Off) is inline next to the control.
- Re-check passed: YES. Non-technical admin sees four labelled fields, each with a one-sentence plain-English explanation. Nothing requires technical knowledge.
- Extends existing surface: YES. Third section card in the existing Operator tab. No new tab, no new nav entry, no new page.

**Rule violations flagged:** none

---

**Files modified:**
- `prototypes/iee-browser-on-e2b.html` (overwritten with round 2)
- `tasks/builds/iee-browser-on-e2b/mockup-log.md` (this entry appended)

---

**Design choices made (for operator review):**

1. **Currency input layout.** The `$` prefix is rendered as a separate element flush-joined to the left edge of the number input (no gap, shared border). This is a common pattern (Stripe, Vercel) and communicates "dollar amount" without needing a unit label to the right. The pair shares a focus ring on focus-within.

2. **Two decimal places.** `step="0.01"` on the currency inputs allows cent-level precision. Default values display as `1.00` and `5.00`, matching how dollar amounts appear in billing UIs. The internal representation remains cents; the UI layer does the conversion.

3. **Toggle dimming on Off.** When status is Off, the "Off" label text is dimmed to slate-400, making the disabled state slightly more legible without requiring a separate red indicator.

4. **Help text length.** All four help texts are one sentence. Profile retention is the longest (two clauses joined with a colon) because the brief §3.3 calls for a plain-English explanation of what a "browser profile" is.

5. **No "Cost guardrails" group header.** Round 1 grouped the cost fields under a "Cost guardrails" sub-header. Round 2 removes the grouping entirely; each ceiling is its own standard field-row, consistent with how all other fields on this tab are presented. Simpler and more scannable.

---

**What to look at in operator review:**

- Currency input styling: does the flush $-prefix feel right, or would a simple unit label to the right ("per task") be cleaner?
- Per-subaccount daily ceiling field label: "Per-subaccount daily cost ceiling" is the longest label on the tab. Acceptable, or shorten to "Daily cost ceiling"?
- Toggle Off-state dimming: is the visual change sufficient to signal "this is disabled", or is it too subtle?
- Profile retention help text: "cookies, logins, MFA tokens" — acceptable level of detail for an admin audience, or still too technical?
