```mockup-review-log
# Mockup review — closed-loop-skill-improvement Round 4
**Reviewed:** 2026-05-18T19:40Z
**Reviewer:** mockup-reviewer (inline, executed by main session)
**Round under review:** Round 4 (2026-05-18 19:35, corrective pass)
**Prior round log:** `mockup-review-log-round-3-2026-05-18T19-30Z.md` returned NEEDS_REWORK with 6 blocking findings
**Prototype files re-audited:**
- `prototypes/closed-loop-skill-improvement/index.html`
- `prototypes/closed-loop-skill-improvement/s1-inbox-improvements.html`
- `prototypes/closed-loop-skill-improvement/s2-review-drawer.html`
- `prototypes/closed-loop-skill-improvement/s3-skill-row-expanded.html`
- `prototypes/closed-loop-skill-improvement/s4-runtrace-event.html`

---

## Round 3 blocking findings — verification

| # | Round 3 finding | Round 4 status |
|---|---|---|
| 1 | s1:298 em-dash in paused-notice title | ✅ Fixed — colon substitution |
| 2 | s2:224 em-dash in reject-reason button | ✅ Fixed — colon substitution |
| 3 | s3:305 em-dash in sample amendment body | ✅ Fixed — semicolon substitution |
| 4 | s4:309 em-dash in composition-exclusion line | ✅ Fixed — colon + comma substitution |
| 5 | Em-dashes in four `<title>` tags (index, s1, s3, s4) | ✅ Fixed — middle-dot (·) substitution |
| 6 | Phantom sidebar nav items (Inbox/Runs/Reports across s1/s3/s4) | ✅ Fixed — sidebars now mirror `client/src/config/sidebar.ts` workspace nav: Home (with review-count badge), Tasks, Automations, Workflows, Action Log, Knowledge, plus Agents section header |

## Round 3 should-fix findings — verification

| # | Round 3 finding | Round 4 status |
|---|---|---|
| 1 | Sidebar inheritance decorative-only — risk of misleading review | ✅ Addressed — sidebar now sourced from `sidebar.ts`, not invented |
| 2 | s3 "Stack health" section label uses forbidden jargon | ⚠️ Carried forward — section remains under "Show advanced details" expander (default-collapsed); recommended relabel deferred as non-blocking |
| 3 | s4 composition-detail exposes raw amendment IDs | ⚠️ Carried forward — IDs sit behind default-collapsed "Show composition detail" expander, which is the legitimate audit-disclosure surface per `docs/frontend-design-principles.md § Progressive disclosure patterns` |

## Re-grep verification

```
=== em-dashes in visible HTML ===
prototypes/closed-loop-skill-improvement/s1-inbox-improvements.html:220:
       SKILL IMPROVEMENTS SECTION — new, below existing tab content
       [INSIDE A <!-- ... --> COMMENT BLOCK; not user-facing per the rule scope]
(all visible em-dashes fixed)

=== invented sidebar items still present? ===
prototypes/closed-loop-skill-improvement/s1-inbox-improvements.html:144:
  <h1 class="page-title">Inbox</h1>
prototypes/closed-loop-skill-improvement/s2-review-drawer.html:150:
  <h1 ...>Inbox</h1>
[These are page-title <h1>s, NOT sidebar items. The page title "Inbox"
correctly inherits from ReviewQueuePage.tsx line 747. No phantom sidebar
nav items remain.]
```

## 🔴 Blocking

None.

## 🟡 Should-fix

- [🟡] `s3-skill-row-expanded.html:336` — "Stack health" section label inside the "Show advanced details" expander still uses the term `Stack health`
  Why: `mockup-reviewer § Axis 2 — No jargon in default UI` lists `stack health` as forbidden. The expander is default-collapsed, but the operator who clicks it sees the jargon. Suggested relabel: `"Activity"` or `"Health"` or simply `"Stats"`. Deferred from Round 3 — non-blocking because the metric labels themselves ("Active improvements", "Conflicts detected", "Rollbacks (30 days)") are already plain English. Carried forward for the operator to decide.

- [🟡] `s4-runtrace-event.html:298-311` — composition-detail section exposes raw amendment IDs (`amend_3bc1`, `amend_2fa9`, `sv_4a1b2c`)
  Why: Same disposition as Round 3 — IDs sit behind default-collapsed "Show composition detail" expander (correct audit-surface placement per `docs/frontend-design-principles.md § Progressive disclosure patterns`). Carried forward as a refinement consideration, not a blocker.

## 💭 Consider

(Round 3 considerations carried forward — none addressed since they were non-blocking.)

---

Blocking: 0 / Should-fix: 2 / Consider: 0
**Verdict:** CLEAN
```

**Summary for caller:** All six Round 3 blocking findings are mechanically resolved. Em-dash audit confirms zero visible occurrences across all four prototypes (one remaining occurrence is inside an HTML comment block in s1, which is author-facing only and outside the `docs/frontend-design-principles.md § Em-dashes` rule's "UI copy, labels, app-facing text, sample mockup data" scope). Sidebar audit confirms zero phantom nav items — all four prototypes' sidebars now render the real workspace nav from `client/src/config/sidebar.ts` (Home with review-count badge, Tasks, Automations, Workflows, Action Log, Knowledge, Agents). Active states match the page being viewed: Home active on s1 (Inbox is reached via Home with its review badge), no active state on s3 (Skills table is reached via subaccount admin drilldown), Action Log active on s4 (run traces are reached via Action Log drilldown). Two should-fix items from Round 3 carry forward as refinement considerations rather than blockers — both relate to surfaces that are correctly default-collapsed behind audit-detail expanders.

Round 4 is **CLEAN** and ready for operator review.
