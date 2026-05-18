```mockup-review-log
# Mockup review — closed-loop-skill-improvement Round 5
**Reviewed:** 2026-05-18T20:15Z
**Reviewer:** mockup-reviewer (inline)
**Round under review:** Round 5 — s3 updated for inherited vs custom distinction
**Prior round log:** Round 4 CLEAN. This round audits only the changed file.
**File audited:** `prototypes/closed-loop-skill-improvement/s3-skill-row-expanded.html`
**Codebase files re-verified:** `client/src/pages/SubaccountSkillsPage.tsx` (extension target unchanged)

---

## Checks

**Grounding:**
- S3 still extends `SubaccountSkillsPage.tsx` ✅ (page heading, subtitle, table columns, tier badge classes all unchanged)
- No new dedicated page ✅
- No phantom nav items ✅ (sidebar mirrors real `sidebar.ts` workspace nav from Round 4 fix)

**New content: custom skill expanded panel**
- `"Summarise Notes"` (Subaccount/Custom tier) now expands to an Edit panel, not an amendment panel ✅
- Edit panel uses direct textarea edit + Save/Cancel — consistent with the existing `SystemSkillEditPage.tsx` edit pattern ✅
- Note reads: "Custom skills are edited directly. Automatic improvement suggestions apply only to inherited skills from the system or organisation level." — plain English, no jargon ✅
- No em-dashes in the new copy ✅
- "Save changes" and "Cancel" — no em-dashes, no jargon ✅
- The distinction between inherited (amendment panel) and custom (edit panel) is visible without extra explanation — the two expanded rows tell the story side by side ✅

**Simplicity:**
- One primary action per expanded custom row: Save ✅
- Custom panel is default-collapsed ✅
- No additional diagnostic surfaces added ✅

## 🔴 Blocking

None.

## 🟡 Should-fix

None new. The two carried-forward items from Round 4 (Stack health label in advanced expander; raw amendment IDs in composition detail) are unchanged and remain 🟡.

## 💭 Consider

- [💭] The `"Analyse Contract"` row (Org tier) is collapsed with no visual hint that clicking it would open an amendment panel rather than an edit panel. A small indicator (e.g. a subtle "improvements available" count badge inline on the row) would make the distinction more discoverable without opening the row. Not blocking — the current design is consistent, and the mockup is a prototype, not a final spec.

---

Blocking: 0 / Should-fix: 0 / Consider: 1
**Verdict:** CLEAN
```

Round 5 is CLEAN. All changes in this round (the inherited vs custom distinction in s3) pass the mockup-reviewer criteria.
