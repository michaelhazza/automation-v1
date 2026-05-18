# Mockup Log — new-task-modal-overhaul

## Round 1 — 2026-05-18 initial draft

**Operator feedback:** initial draft

---

**Codebase grounding (Step 0a) — PER SCREEN (mandatory):**

- `01-default-state.html`: extends `client/src/components/layout/modals/NewBriefModal.tsx` (the global "+ New Task" modal, invoked at `Layout.tsx` line 187). Also references `client/src/components/task-modal/AttachmentTypeIcon.tsx` and `client/src/components/task-modal/format.ts` for attachment icon pattern. Agent picker is plain `<select>` matching `client/src/pages/WorkspaceBoardPage.tsx` lines 300-306 ("Assign Agent" select pattern).

- `02-with-attachments.html`: same extends chain as Screen 01. Additionally demonstrates the attachment lifecycle from `client/src/components/TaskModal.tsx` attachments tab (lines 565-718): `AttachmentTypeIcon` icon badges, `formatBytes` size display, upload progress styling. Lifecycle notice pattern (Product invariant 3 + 11) is new to the creation surface.

- `03-advanced-expanded.html`: same extends chain as Screen 01. Advanced section open, showing all four secondary fields. Org override with "Org admin only" pill per `frontend-design-principles.md` § Admin-only controls (pill present only in admin view, absent for non-admins in production). Due Date shape (date input, no time component) matches `client/src/components/TaskModal.tsx` line 475 (`dueDate.slice(0,10)`).

---

**Codebase grounding — round-wide:**

All files read:
- `client/src/components/layout/modals/NewBriefModal.tsx` (the target component — layout, field set, class names)
- `client/src/components/review-queue/NewBriefModal.tsx` (fixed-default-agent pattern with amber pill)
- `client/src/components/TaskModal.tsx` (attachment upload, `AttachmentTypeIcon`, `formatBytes`, `dueDate` field shape, agent checkbox list)
- `client/src/components/task-modal/AttachmentTypeIcon.tsx` (icon component: img/pdf/txt/file labels, colour classes)
- `client/src/components/task-modal/format.ts` (`formatBytes`, `attachmentIcon`, `plainEnglishFailureReason`)
- `client/src/components/Layout.tsx` lines 1-197 (modal invocation, `showNewBrief` flag, overlay conventions)
- `client/src/pages/WorkspaceBoardPage.tsx` lines 280-320 (plain `<select>` agent picker pattern)
- `prototypes/operator-confidence-layer/_shared.css` (visual conventions to inherit)
- `prototypes/operator-confidence-layer/01-task-creation.html` (modal shell, field classes, toggle patterns)

Vocabulary / conventions inherited (quoted from codebase):
- Modal shell class: `bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4` (NewBriefModal.tsx line 114)
- Label class: `block text-[13px] font-medium text-slate-700 mb-1.5` (NewBriefModal.tsx lines 121, 125, 129)
- Input class: `w-full px-3 py-2.5 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500` (NewBriefModal.tsx line 122)
- Header: `flex items-center justify-between px-6 py-4 border-b border-slate-200` (NewBriefModal.tsx line 115)
- Form body: `p-6 flex flex-col gap-4` (NewBriefModal.tsx line 119)
- Footer: `flex gap-2 justify-end pt-1` (NewBriefModal.tsx line 187)
- Button labels: `btn btn-secondary` / `btn btn-primary` (NewBriefModal.tsx line 188-189)
- Primary button label: `Create Task` (already the current display label per NewBriefModal.tsx line 189)
- Priority options: `low / normal / high / urgent` (NewBriefModal.tsx lines 131-135)
- Agent picker: plain `<select>` with label `Assign Agent` (WorkspaceBoardPage.tsx line 301)
- Attachment icon colour classes: `bg-emerald-100 text-emerald-700` (img), `bg-red-100 text-red-700` (pdf), `bg-sky-100 text-sky-700` (txt) (AttachmentTypeIcon.tsx lines 5-13)
- Due date: `dueDate.slice(0,10)` — date-only ISO string, no time component (TaskModal.tsx line 194)
- Modal max-height: 92vh with overflow-y scroll (prior prototype convention)
- Indigo-500 / indigo-600 for primary actions (consistent across all prototypes)

New dedicated pages proposed: none. All screens are states of the same modal overlay (extending `NewBriefModal.tsx`).

---

**Changes made:**
- Created `prototypes/new-task-modal-overhaul/` directory with `_shared.css` and four HTML files
- `_shared.css`: all tokens inlined, inheriting from `operator-confidence-layer/_shared.css` conventions. Added drop-zone styles, attachment-list styles, upload-progress styles, lifecycle-notice styles, advanced-expander styles
- `01-default-state.html`: modal just opened — empty title, empty instructions, agent picker, empty drop-zone with always-visible fallback button, collapsed Advanced section. Create Task button disabled until title filled (JS)
- `02-with-attachments.html`: filled title + instructions + agent; two attachment rows (one uploaded, one mid-upload with animated progress bar); compact drop-zone with fallback; lifecycle notice explaining separate operations; animated progress to 100% via JS to demonstrate the state transition
- `03-advanced-expanded.html`: filled fields, one attachment, Advanced section open showing Due Date + Priority (two-column) + Subaccount override + Org override (with admin-only pill)
- `index.html`: links all three screens with colour-coded index cards and a grounding summary

---

**Frontend-design-principles checks:**

- Start with primary task: YES. Every screen is structured around "set up a task that can run". Title, Instructions, and Agent are always at the top. Advanced fields (Due Date, Priority, overrides) are behind the expander. The operator can complete the primary task (fill title, write instructions, pick agent, submit) without touching Advanced.
- Default to hidden: YES. Advanced section collapsed in Screens 01 and 02; only open in Screen 03 to demonstrate the state. No KPI tiles. No dashboards.
- One primary action: YES. "Create Task" is the only primary action on every screen. Cancel is always present as a secondary action (one primary + one secondary = compliant per the rules).
- Inline state: YES. Upload progress, uploaded-file confirmation, and the lifecycle notice all appear inline within the modal body. No separate progress modal, no separate status page.
- Re-check passed: YES. A non-technical operator can scan Screen 01, understand the three primary fields (Title, Instructions, Agent), and hit Create Task without needing to open Advanced. The drop-zone label and fallback button are self-explanatory. The lifecycle notice on Screen 02 is one short sentence.
- Extends existing surface: YES. All screens extend `client/src/components/layout/modals/NewBriefModal.tsx`. No new routes, no new pages, no new nav entries.

**Rule violations flagged:** none

**Product invariants reflected:**
- Invariant 3: Attachment lifecycle notice on Screen 02 makes clear that task creation and uploads are separate operations
- Invariant 6: Non-drag fallback button ("Browse files") always visible on all three screens; drop-zone has `role="button" tabindex="0"` with keyboard handler (`Enter`/`Space` opens file picker); `aria-label` announces the affordance
- Invariant 7: Title, Instructions, Agent always visible at the top of all three screens; never hidden behind disclosure
- Invariant 8: Field is labelled "Instructions" (canonical name) on all screens; no "Description" label anywhere in the prototypes
- Invariant 11: Screen 02 lifecycle notice includes "the task auto-promotes after a short timeout" phrasing
- Mockup constraint: no scheduling fields, no recurring toggle, no Preview option, no status/column picker

**Files modified:**
- `prototypes/new-task-modal-overhaul/_shared.css` (created)
- `prototypes/new-task-modal-overhaul/01-default-state.html` (created)
- `prototypes/new-task-modal-overhaul/02-with-attachments.html` (created)
- `prototypes/new-task-modal-overhaul/03-advanced-expanded.html` (created)
- `prototypes/new-task-modal-overhaul/index.html` (created)
- `tasks/builds/new-task-modal-overhaul/mockup-log.md` (created)

---

## Round 2 — 2026-05-18

**Operator feedback:** 11 reviewer findings from Round 1 (6 should-fix, 5 consider) — all must be addressed.

---

**Codebase grounding (Step 0a) — PER SCREEN (mandatory):**

- `01-default-state.html`: extends `client/src/components/layout/modals/NewBriefModal.tsx`. Round 2 changes: applied SF-2 (label "Assign Agent"), SF-3 ("Unassigned"), SF-4 (removed agent-hint div), C-1 (placeholder "What should the agent do?"), C-2 (removed "(optional)" from Instructions label), C-4 (agent select moved into compact inline row below Instructions textarea, grouped within the same form div). No new pages or components.

- `02-with-attachments.html`: extends `client/src/components/layout/modals/NewBriefModal.tsx` + `client/src/components/TaskModal.tsx` (attachment list). Round 2 changes: SF-1/SF-6 (lifecycle notice rewritten to two short plain-English sentences + tooltip link for failure detail), SF-2, SF-3, SF-5 (mid-upload action changed from bare × to "Cancel" text-label button with distinct `.att-cancel-upload` class; JS animation swaps Cancel back to × Remove on completion), C-2, C-3 (footer counter removed), C-4. No new pages or components.

- `03-advanced-expanded.html`: extends `client/src/components/layout/modals/NewBriefModal.tsx`. Round 2 changes: SF-2, SF-3, C-2, C-4, C-5 (HTML comment added near Subaccount field documenting the `NewBriefModal.tsx:166` conditional gate). No new pages or components.

---

**Codebase grounding — round-wide:**

All files read this round:
- `prototypes/new-task-modal-overhaul/01-default-state.html` (Round 1 artifact — read before editing)
- `prototypes/new-task-modal-overhaul/02-with-attachments.html` (Round 1 artifact — read before editing)
- `prototypes/new-task-modal-overhaul/03-advanced-expanded.html` (Round 1 artifact — read before editing)
- `prototypes/new-task-modal-overhaul/_shared.css` (Round 1 artifact — read before editing)
- `tasks/builds/new-task-modal-overhaul/mockup-review-log-round-1-2026-05-18T01-44-37Z.md`
- `docs/frontend-design-principles.md`

Vocabulary / conventions inherited (unchanged from Round 1):
- Agent picker label: `Assign Agent` (WorkspaceBoardPage.tsx:301)
- Agent default option: `Unassigned` (WorkspaceBoardPage.tsx:303)
- Subaccount conditional gate: `subaccounts.length > 0` (NewBriefModal.tsx:166)

New dedicated pages proposed: none. All changes are within the existing modal prototype states.

---

**Changes made:**

SF-1 / SF-6 (`02-with-attachments.html`):
- Lifecycle notice rewritten to two sentences: "You can create the task now. Uploads will finish in the background."
- Failure-mode detail ("auto-promotes", "settle") removed from always-visible text; collapsed into a dismissable `lifecycle-tooltip` on a "What happens if an upload fails?" link
- CSS added: `.lifecycle-notice a`, `.lifecycle-tooltip-wrap`, `.lifecycle-tooltip` (hover/focus shows tooltip)

SF-2 (all 3 screens):
- "Assigned Agent" changed to "Assign Agent" on all three screens (matches WorkspaceBoardPage.tsx:301)

SF-3 (all 3 screens):
- "Auto-assign (recommended)" changed to "Unassigned" on all three screens (matches WorkspaceBoardPage.tsx:303 empty-option)

SF-4 (all 3 screens):
- `.agent-hint` info row removed from Screen 01 (Screens 02 and 03 did not have it in Round 1)
- `.agent-hint` and `.agent-hint-icon` CSS removed from `_shared.css`

SF-5 (`02-with-attachments.html`):
- Mid-upload row action button changed from `att-remove` (bare ×) to `att-cancel-upload` ("Cancel" text label)
- New `.att-cancel-upload` CSS class: small bordered text button, hover turns red — visually distinct from the × on settled rows
- JS animation updated: on upload completion, "Cancel" button is replaced with a proper × "Remove" button (`att-remove` class, correct aria-label)
- Settled-file rows retain bare × with `aria-label="Remove {filename}"`

SF-6: verified — lifecycle notice at first paint is exactly 2 sentences (one assertion; confirmed by reading the rendered HTML output). Failure detail is behind tooltip only.

C-1 (`01-default-state.html`):
- Instructions placeholder changed from "Describe what the agent should do. The more context you give here, the less back-and-forth later." to "What should the agent do?"
- Screens 02 and 03 have filled content so placeholder not applicable

C-2 (all 3 screens):
- `(optional)` parenthetical removed from Instructions label on all three screens

C-3 (`02-with-attachments.html`):
- Footer left-side counter "1 upload in progress" removed; row-level progress bar carries the signal

C-4 (all 3 screens):
- Agent select moved from a separate form section into a compact `.agent-inline-row` div nested below the Instructions textarea
- Layout: `display: flex; align-items: center; gap: 10px; margin-top: 8px;` with label on left (`agent-inline-label`) and select flex:1 on right
- Reduces perceived section count from 5 to 4 (Title / Instructions+Agent / Attachments / Advanced); fits naturally within `max-w-lg` (512px) width
- New CSS classes: `.agent-inline-row`, `.agent-inline-label`, `.agent-inline-select`

C-5 (`03-advanced-expanded.html`):
- HTML comment added immediately above Subaccount field noting the `NewBriefModal.tsx:166` conditional gate (`subaccounts.length > 0`) and documenting that this mockup renders the multi-subaccount state

---

**Frontend-design-principles checks:**

- Start with primary task: YES. Title, Instructions, and Agent remain the top three always-visible fields. Grouping Agent below Instructions (C-4) reinforces the "who runs these instructions" relationship without adding a new section.
- Default to hidden: YES. Advanced collapsed on Screens 01 and 02; lifecycle failure detail behind tooltip (not always-on). No KPI tiles, no dashboards.
- One primary action: YES. "Create Task" is the sole primary action on all three screens.
- Inline state: YES. Upload progress, completed-file state, and the lifecycle notice are all inline within the modal body. Tooltip is inline on the lifecycle notice row.
- Re-check passed: YES. Screen 01 now has four clear sections (Title, Instructions+Agent, Attachments, Advanced toggle). A non-technical operator can complete the primary task (fill title, write instructions, pick agent, hit Create Task) without touching Advanced. Lifecycle notice on Screen 02 is two short sentences at first glance.
- Extends existing surface: YES. All changes are within the three prototype screens extending `NewBriefModal.tsx`. No new routes, pages, or nav entries.

**Rule violations flagged:** none

**C-4 layout decision documented:** Compact inline row (label + select on one line below textarea) reads naturally at 512px max-width. Section count drops from 5 to 4. Chosen over the "restore separate field" fallback because the layout does not fight the modal width and the semantic grouping ("who runs these instructions?") is improved.

**Files modified:**
- `prototypes/new-task-modal-overhaul/_shared.css`
- `prototypes/new-task-modal-overhaul/01-default-state.html`
- `prototypes/new-task-modal-overhaul/02-with-attachments.html`
- `prototypes/new-task-modal-overhaul/03-advanced-expanded.html`
- `tasks/builds/new-task-modal-overhaul/mockup-log.md`

---

## Round 3 — 2026-05-18

**Operator feedback:** Drop-zone is visually invisible on Screen 01. `.dropzone` uses `border: 1.5px dashed #cbd5e1` on `background: #fafbfc` inside a white modal — near-invisible. "Browse files" button border `#d1d5db` is similarly invisible. Operator cannot find the attachment affordance. Fix: make the drop-zone clearly visible without making it the dominant element.

---

**Codebase grounding (Step 0a) — PER SCREEN (mandatory):**

- `01-default-state.html`: extends `client/src/components/layout/modals/NewBriefModal.tsx` (unchanged from Round 2). Drop-zone icon added to the HTML body; CSS fixes in `_shared.css` improve visibility without affecting other screens.

Screens `02-with-attachments.html` and `03-advanced-expanded.html` were not edited. The `.dropzone` CSS change (darker border, faint indigo background) applies but those screens already have files listed or drag-over context that makes the zone legible — the change improves them marginally, not harmfully.

---

**Codebase grounding — round-wide:**

All files read this round:
- `prototypes/new-task-modal-overhaul/_shared.css` (prior round artifact — read before editing)
- `prototypes/new-task-modal-overhaul/01-default-state.html` (prior round artifact — read before editing)
- `tasks/builds/new-task-modal-overhaul/mockup-log.md` (prior round artifact — read before appending)
- `docs/frontend-design-principles.md`
- `tasks/builds/new-task-modal-overhaul/brief.md`

Vocabulary / conventions inherited (unchanged from Round 2):
- Drop-zone hover/drag-over state: `border-color: #6366f1; background: #f5f3ff;` — unchanged, already correct
- Modal white `background: white` — the contrast target the drop-zone must read against

New dedicated pages proposed: none.

---

**Changes made:**

`_shared.css` — `.dropzone`:
- Border: `#cbd5e1` (slate-300, ~invisible on white) changed to `#94a3b8` (slate-400, clearly visible but not dominant)
- Background: `#fafbfc` (near-white) changed to `#f5f7ff` (faint indigo tint, 3-4% hue shift) — adds a second contrast cue so the zone reads as a distinct interactive region against the white modal body

`_shared.css` — `.dropzone-browse`:
- Border: `#d1d5db` (gray-300, ~invisible) changed to `#94a3b8` (slate-400) — "Browse files" button now reads as a real affordance
- Hover border: `#9ca3af` → `#6366f1` (indigo) — matches the drop-zone hover behaviour for consistency

`_shared.css` — `.dropzone-icon` (new class):
- Added `.dropzone-icon` container: `display:flex; align-items:center; justify-content:center; margin-bottom:8px; color:#94a3b8;` — positions the 20px SVG icon above the label text

`01-default-state.html` — drop-zone inner HTML:
- Added a 20px upload SVG icon (arrow-up-from-tray, `aria-hidden="true"`) inside a `.dropzone-icon` div, immediately above "Drop files here" label
- Icon signals "upload zone" at a glance without adding text. Colour inherits `#94a3b8` from the CSS class.

---

**Frontend-design-principles checks:**

- Start with primary task: YES. Title and Instructions still lead. Drop-zone fix does not change the visual hierarchy — it only makes the attachment section discoverable rather than invisible.
- Default to hidden: YES. Drop-zone is "always visible but secondary" per the brief's visual hierarchy declaration. The fix makes it secondary and visible, not prominent.
- One primary action: YES. "Create Task" is still the only primary action.
- Inline state: YES. No new panels or dashboard elements introduced.
- Re-check passed: YES. Operator can now see the drop-zone without searching. The zone reads as secondary to Title/Instructions (lighter indigo tint, not a bold block), so the primary task is not displaced.
- Extends existing surface: YES. Only `_shared.css` and `01-default-state.html` touched.

**Rule violations flagged:** none

**Files modified:**
- `prototypes/new-task-modal-overhaul/_shared.css`
- `prototypes/new-task-modal-overhaul/01-default-state.html`
- `tasks/builds/new-task-modal-overhaul/mockup-log.md`


---

## Completion

```yaml
---
status: complete
mockup_rounds_complete: true
final_round: 3
completed_at: 2026-05-18T01:50:00Z
---
```

## Final state — 2026-05-18

**Final prototype paths:**
- `prototypes/new-task-modal-overhaul/index.html`
- `prototypes/new-task-modal-overhaul/01-default-state.html`
- `prototypes/new-task-modal-overhaul/02-with-attachments.html`
- `prototypes/new-task-modal-overhaul/03-advanced-expanded.html`
- `prototypes/new-task-modal-overhaul/_shared.css`

**Total rounds:** 3 designer + reviewer pairs

**Round history:**
- Round 1: Initial draft. Reviewer CLEAN (0 blocking, 6 should-fix, 5 consider).
- Round 2: All 11 Round 1 findings applied. Reviewer CLEAN (0 blocking, 1 should-fix, 2 consider).
- Round 3: Drop-zone visibility fix (operator could not find attachment affordance on default state). Reviewer CLEAN (0 blocking, 1 should-fix, 3 consider).

**Pre-implementation fixes noted (not mockup-iteration blockers):**
- Nav bar active link label "Workspace" → "Tasks" (matches sidebar.ts:139) across all three screens
- "What happens if an upload fails?" tooltip trigger: use `<button type="button">` styled as link rather than bare `<a>` without href
- Update `index.html` comment from "Round 1" to "Round 3"

**Open spec-author decisions surfaced during mockup work:**
- Whether Instructions is required or optional at task creation (currently shown as optional; brief is silent on this)
