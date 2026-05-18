```mockup-review-log
## Mockup review — new-task-modal-overhaul — Round 3

**Reviewer:** mockup-reviewer (read-only, proxied via general-purpose)
**Date:** 2026-05-18
**Scope:** Scoped review — `_shared.css` and `01-default-state.html` only (drop-zone visibility fix). Screens 02 and 03 spot-checked for CSS regression.

---

### Round 3 focus points

1. **Drop-zone CSS regressions:** PASS — no Round 2 findings reopened. Border colour lift, indigo tint, icon, and button border lift are additive visual changes only. Section count unchanged at 4.
2. **New issues in changed files:** PASS — no jargon in aria/label text; icon correctly `aria-hidden`; no em-dashes in rendered copy; no complexity-budget breach; no admin leakage.
3. **Screens 02 and 03 unaffected:** PASS — `.dropzone-icon` CSS is inert on those screens (icon div not present in their HTML); border/tint changes improve rather than harm legibility.
4. **Operator concern satisfied:** YES — two contrast cues (darker dashed border + indigo tint) plus upload icon make the zone clearly discoverable without competing with Title/Instructions for visual weight.

---

### 🔴 Blocking findings

(none)

---

### 🟡 Should-fix findings

- 🟡 `01-default-state.html:34`, `02-with-attachments.html:36`, `03-advanced-expanded.html:36` — Nav bar active link label "Workspace" does not match the canonical `client/src/config/sidebar.ts` nav label "Tasks" (key: "tasks"). Carried from Round 2.
  **Why:** `mockup-reviewer.md § Axis 1 — Vocabulary matches the codebase`. Non-blocking — blurred decorative chrome, not the design subject. Fix before implementation.

---

### 💭 Consider

- 💭 `_shared.css:.dropzone` — If a live browser check shows the indigo tint plus darker border still reads as background, adding `box-shadow: inset 0 0 0 1px #c7d2fe` as a third contrast cue costs nothing structurally.
  **Why:** `docs/frontend-design-principles.md § Re-check before delivery` (discoverability).

- 💭 `02-with-attachments.html` (carried) — "What happens if an upload fails?" tooltip trigger should be a `<button type="button">` styled as a link rather than a bare `<a>` without `href`. Implementation note.

- 💭 `index.html:3` — HTML comment says "Round 1"; minor documentation drift. (Carried from Round 2.)

---

**Brief-invariant compliance:** Invariants 3, 6, 7, 8, 11 all PASS. No regressions.

Blocking: 0 / Should-fix: 1 / Consider: 3

**Verdict:** CLEAN
```
