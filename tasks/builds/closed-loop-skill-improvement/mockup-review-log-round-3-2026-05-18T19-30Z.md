```mockup-review-log
# Mockup review — closed-loop-skill-improvement Round 3
**Reviewed:** 2026-05-18T19:30Z
**Reviewer:** mockup-reviewer (inline, executed by main session — agent newly-merged framework not yet in session registry)
**Round under review:** Round 3 (2026-05-18 17:00) per `tasks/builds/closed-loop-skill-improvement/mockup-log.md`
**Prototype files audited:**
- `prototypes/closed-loop-skill-improvement/index.html`
- `prototypes/closed-loop-skill-improvement/s1-inbox-improvements.html`
- `prototypes/closed-loop-skill-improvement/s2-review-drawer.html`
- `prototypes/closed-loop-skill-improvement/s3-skill-row-expanded.html`
- `prototypes/closed-loop-skill-improvement/s4-runtrace-event.html`
**Codebase files verified:**
- `client/src/pages/ReviewQueuePage.tsx` (extension target for s1 + s2)
- `client/src/pages/SubaccountSkillsPage.tsx` (extension target for s3)
- `client/src/pages/operate/RunTracePage.tsx` (extension target for s4)
- `client/src/pages/operate/components/RunTraceEventRenderer.tsx` (extension target for s4)
- `client/src/components/ViewModeSwitcher.tsx` (referenced by s1)
- `client/src/config/sidebar.ts` (canonical sidebar registry)

---

## 🔴 Blocking — must be fixed before showing to the operator

- [🔴] `s1-inbox-improvements.html:298` — visible em-dash in paused-notice title (`"Prospect Research — suggestions paused"`)
  Why: `CLAUDE.md § User Preferences` and `docs/frontend-design-principles.md § Em-dashes` prohibit em-dashes in any UI copy, labels, or app-facing text. Use comma, colon, or rewrite (e.g. `"Prospect Research, suggestions paused"` or `"Prospect Research: suggestions paused"`).

- [🔴] `s2-review-drawer.html:224` — visible em-dash in reject-reason button (`"Unsafe — don't suggest again"`)
  Why: Same rule. This is one of the three load-bearing primary-flow buttons and is a particularly visible offender. Replace with `"Unsafe: don't suggest again"` or `"Unsafe, don't suggest again"`.

- [🔴] `s3-skill-row-expanded.html:305` — visible em-dash in sample amendment body (`"Avoid using the word 'urgent' in subject lines — use 'time-sensitive' instead."`)
  Why: Same rule. Sample data is still UI copy per `docs/frontend-design-principles.md § Em-dashes`: "applies to mockup data (sample document names, sample agent names) too, not just chrome."

- [🔴] `s4-runtrace-event.html:309` — visible em-dash in composition-exclusion line (`"cc_enterprise (amend_7g4h) — deduplication: superseded by amend_3bc1"`)
  Why: Same rule. Even though this lives behind the default-collapsed "Show composition detail" expander (which is correct per the audit-disclosure rule), the rule applies to all UI copy regardless of default visibility.

- [🔴] `index.html:6`, `s1-inbox-improvements.html:6`, `s3-skill-row-expanded.html:6`, `s4-runtrace-event.html:6` — em-dashes in HTML `<title>` tags (visible in browser tab)
  Why: Same rule. The `<title>` is operator-facing chrome. Replace with colon or comma.

- [🔴] `s1-inbox-improvements.html:106-124`, `s3-skill-row-expanded.html:147-165`, `s4-runtrace-event.html:131-150` — phantom sidebar nav items
  Why: `mockup-reviewer § Axis 1: Grounding — No phantom nav items`. The prototypes render a sidebar with these items: `Inbox`, `Runs`, `Agents`, `Tasks`, `Reports`, `Settings`. Verification against `client/src/config/sidebar.ts`:
    - `"Inbox"` does NOT exist in the workspace sidebar registry. The corresponding nav item is `"Home"` (with a badge count), keyed `home`, route `/`. The page the prototype extends (`ReviewQueuePage.tsx`) is reached via subaccount admin drilldown, not via a top-level "Inbox" sidebar entry.
    - `"Runs"` does NOT exist in the workspace sidebar registry. The closest is `"Action Log"`, keyed `action-log`, route `/admin/subaccounts/:subaccountId/actions`. The run-trace page is reached by drilling in from runs surfaces, not from a "Runs" nav item.
    - `"Reports"` does NOT exist in the workspace sidebar registry at all.
    - `"Tasks"` exists (keyed `tasks`, route `/admin/subaccounts/:subaccountId/workspace`) ✓
    - `"Agents"` exists as a section header ✓
    - `"Settings"` placement is approximate — the real nav uses `"Manage"` and `"Organisation"` groupings.
   Round summary's per-screen grounding enumeration did NOT justify any of these nav additions. Fix: either render the actual workspace sidebar items from `sidebar.ts` (Home / Personal / Work-group items) or replace the sidebar with a generic placeholder shell that doesn't imply specific nav items.

## 🟡 Should-fix — strong recommendation, but not strictly blocking

- [🟡] All four prototypes — sidebar inheritance is decorative-only and risks misleading review. The current sidebars use plausible-looking but invented labels. Even if the operator understands they are placeholders, a reviewer or stakeholder shown the prototypes may assume the labelling is design intent. Recommend: cite the canonical config in the round summary, OR add a small `(sidebar shown is placeholder — real nav per sidebar.ts)` annotation under the index.

- [🟡] `s3-skill-row-expanded.html:336-350` — "Stack health" advanced section uses the term `Stack health` as the section label
  Why: `mockup-reviewer § Axis 2 — No jargon in default UI` lists `stack health` as an example forbidden in default copy. While this section IS behind the "Show advanced details" expander (correctly default-collapsed), the operator who clicks the expander still sees the jargon. Consider relabelling to `"Activity"` or `"Health"` or `"Stats"` — the metric labels themselves ("Active improvements", "Conflicts detected", "Rollbacks (30 days)") are already plain English; only the section heading carries the jargon.

- [🟡] `s4-runtrace-event.html:298-311` — composition-detail section exposes raw amendment IDs (`amend_3bc1`, `amend_2fa9`, `sv_4a1b2c`)
  Why: `mockup-reviewer § Axis 2 — Hash / ID exposures: 0 by default`. These IDs sit behind the "Show composition detail" expander (correctly default-collapsed per `docs/frontend-design-principles.md § Progressive disclosure patterns` rule 3), which is the legitimate place for audit-detail surfaces. Borderline acceptable, but consider whether the operator needs the raw IDs or whether a friendly name (e.g. `"Tone matching follow-up"`) plus a compact ID would serve audit needs better. Not blocking — audit surfaces are explicitly permitted to expose internal identifiers per the design rules.

## 💭 Consider — taste / future-proofing

- [💭] `s1-inbox-improvements.html:215-307` — the "Skill improvements" section sits below the existing "Needs Review" tab content (correct: not a third tab). However, placement assumes both existing review items AND skill improvements are simultaneously visible. With realistic queue volumes, the section header could end up below several screens of scrolling. Consider: a small inline anchor link in the page header or a tab-count style affordance ("4 skill improvements below"), still without making it a separate tab.

- [💭] `s2-review-drawer.html:196-200` — primary action label is `"Accept"` (good); secondary is `"Edit first"` (good); destructive is `"Reject"` (good). Consider: the operator-trust posture in the brief recommends `"Apply"` over `"Approve"` to avoid implying the system "got it right." `"Accept"` is fine and is the recommendation in the brief. No change needed; just noting the consistency check passed.

- [💭] `s3-skill-row-expanded.html:198-208` — collapsed rows above and below the expanded one are clickable (`expandable-row` class with `void(0)` onclick on row 1). Consider implementing the toggle on every row so the operator can click any skill to inspect its stack, not just `Draft Email`. Not blocking; demonstration scope is appropriate.

- [💭] `s4-runtrace-event.html:281-285` — the "Run ended with failure" event uses a slate "stop" glyph (`■`). Consider matching the existing run-end iconography from `RunTraceEventRenderer.tsx` for consistency. Minor.

---

Blocking: 6 / Should-fix: 3 / Consider: 4
**Verdict:** NEEDS_REWORK
```

**Summary for caller:** Round 3 mockups are structurally sound — every screen extends a named existing page with correct vocabulary, no new dedicated pages, no third Inbox tab, plain-English reject reasons, single tech-detail expanders, stack-health metrics reduced and tucked behind progressive disclosure, cap-reached state inline rather than separate page. The blocking findings are concentrated in two recurring categories: em-dashes (6 visible offenders across 4 files plus 4 `<title>` tags) and a hand-rolled sidebar that invents `Inbox`, `Runs`, and `Reports` nav items that don't exist in `client/src/config/sidebar.ts`. Both are mechanical fixes that the next round of mockup-designer can address in a single pass without rethinking the surface design. Recommend feeding this log back to mockup-designer for one corrective round before presenting to the operator.
