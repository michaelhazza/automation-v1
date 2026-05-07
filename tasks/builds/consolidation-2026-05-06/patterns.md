# Consolidation prototype — shared interaction patterns

Canonical reference for interaction patterns used across the consolidation-2026-05-06 prototype set. Implement once, reference here.

---

## 1. Modal / dialog primitive

Defined in `_shared.css`. Use for all overlay dialogs; never invent new modal CSS per-page.

**CSS classes:**
- `.modal-overlay` — fixed full-viewport backdrop, `z-index: 200`, blur effect
- `.modal-card` — white card, max-width 720px, flex-column
- `.modal-card-large` — extends to max-width 1200px
- `.modal-card-xl` — extends to max-width 1400px (for iframe content)
- `.modal-header` — title + close button row
- `.modal-title` — 16px/600 heading
- `.modal-close` — button with &times; glyph
- `.modal-body` — scrollable content area (flex: 1)
- `.modal-footer` — action row, right-aligned

**JS helpers (inline per page, not shared):**
```js
function openModal(el)  { el.hidden = false; document.body.style.overflow = 'hidden'; }
function closeModal(el) { el.hidden = true;  document.body.style.overflow = ''; }
```

**Closing gestures:**
- Click X button in modal-header
- Click backdrop (`onclick="if(event.target===this)closeModal(this)"`)
- Escape key (handled per-page in keydown listener)

**Hidden state:** Use the `hidden` attribute on `.modal-overlay`. CSS rule `.modal-overlay[hidden] { display: none; }` handles it.

---

## 2. Activity drawer / modal pattern

Activity items are clickable rows. Clicking a row opens a modal (not a page navigation) showing:
- Description
- Subaccount (with workspace badge, clickable for org_admin)
- Actor
- Type
- Project (if applicable)
- Run link (if applicable — opens run-trace popup)
- When (timestamp)

**Applicable pages:** home.html (activity modal), activity.html (drawer)

**Row wiring:** `onclick="openActivityModal('N')"` where N is an activity data key.

**ACTIVITY_DATA shape:**
```js
{
  title: 'Human-readable title',
  description: 'Full sentence description.',
  subaccount: 'Subaccount Name',
  subStyle: 'background:#...; color:#...;',   // badge inline style
  actor: 'Person or Agent name',
  type: 'agent_run | approval | memory | ...',
  typeClass: 'tag-blue | tag-emerald | ...',
  project: 'Project Name',                    // or null
  run: { label: 'run-abc123', id: 'run-abc123' },  // or null
  when: '2 min ago',
}
```

---

## 3. Run-trace popup pattern

Run IDs are never plain text links that navigate away. They open run-trace.html in a modal with `?embedded=1`.

**Trigger:** `openRunTraceModal(runId, runLabel)` — available on home.html and activity.html.

**Implementation:**
```js
function openRunTraceModal(runId, runLabel) {
  document.getElementById('run-trace-modal-title').textContent = runLabel || ('Run ' + runId);
  document.getElementById('run-trace-iframe').src = 'run-trace.html?embedded=1&run=' + encodeURIComponent(runId);
  openModal(document.getElementById('run-trace-modal'));
}
```

**run-trace.html embedded mode:** Detects `?embedded=1` via URLSearchParams. Hides: sidebar mount, replaces-strip, topbar. Sets `.run-layout { height: 100vh }`.

**Z-index layering:** Activity modal uses default `z-index: 200`. Run-trace modal uses `z-index: 210` (inline style) so it opens on top of the activity modal.

**Modal HTML:**
```html
<div id="run-trace-modal" class="modal-overlay" hidden style="z-index:210;"
     onclick="if(event.target===this)closeModal(this)">
  <div class="modal-card modal-card-xl" style="height:calc(100vh - 48px);">
    <div class="modal-header">
      <span class="modal-title" id="run-trace-modal-title">Run trace</span>
      <button class="modal-close" onclick="closeModal(document.getElementById('run-trace-modal'))">&times;</button>
    </div>
    <div class="modal-body" style="padding:0;overflow:hidden;">
      <iframe id="run-trace-iframe" src="" style="width:100%;height:100%;border:none;"></iframe>
    </div>
  </div>
</div>
```

---

## 4. Cross-page workspace switching

Workspace/subaccount badges are clickable for org_admin profile only. Clicking switches the active subaccount and reloads the page.

**Profile check:** `window.getActiveProfile()` from `_sidebar.js`. Only wire click if profile === `'org_admin'`.

**Helper (inline per page):**
```js
function makeWorkspaceBadgeClickable(badgeEl, subaccountName) {
  if (window.getActiveProfile && window.getActiveProfile() === 'org_admin') {
    badgeEl.style.cursor = 'pointer';
    badgeEl.title = 'Click to switch to ' + subaccountName + ' workspace';
    badgeEl.addEventListener('click', function(e) {
      e.stopPropagation();
      if (window.setActiveSubaccount) window.setActiveSubaccount(subaccountName);
      location.reload();
    });
  }
}
```

**Wiring:** DOMContentLoaded iterates `document.querySelectorAll('[data-subaccount]')` or `.ws-pill` elements and calls the helper.

**Applicable pages:** home.html (activity table badges + activity modal badge), activity.html (table badges + drawer workspace field), run-trace modal (badge in iframe page content).

---

## 5. Sortable + filterable table columns

Column headers support both sorting (click the label) and filtering (click the caret button).

**Sort:** `sortByColumn(col)` toggles `sortDir` (-1/1) and calls `renderRows()`. Active column caret shows up/down arrow via `sort-arrow` span.

**Filter dropdown UX rules:**
- Dropdown stays open until user explicitly closes it (Apply, Cancel, Esc, or outside click)
- Individual checkbox changes do NOT close the dropdown
- "Select all" is a smart toggle: all checked → uncheck all; any unchecked → check all
- "Clear" unchecks all
- "Apply" commits filter and closes
- "Cancel" restores the snapshot (state at dropdown-open time) and closes
- Outside click and Esc close without applying (same as Cancel)

**Snapshot pattern:** On open, save checkbox states to `_filterSnapshot[col]`. On Cancel/outside-close, restore.

**Caret highlight:** When a column is actively filtered (fewer items checked than total), the caret button gets class `active` (indigo color).

**CSS:** `.col-filter-dropdown-footer` holds Cancel + Apply buttons side by side. `.col-filter-cancel` is the secondary button. `.col-filter-apply` is the primary button.

---

## 6. Inbox priority bands

Three collapsible sections replace the old flat list + "Earlier" toggle.

**Band structure:**
```
HIGH PRIORITY   (red left border, default expanded)
NEEDS ACTION    (amber left border, default expanded)
PREVIOUS        (slate border, default collapsed)
```

**Each item layout:**
- Actions (buttons) in top-right flex-column wrapper
- Date label at bottom-right in `font-size: 11px; color: var(--slate-500)`, format "Added: date" or "Triggered: date"
- No keyboard-hint labels (all `kb-hint` divs removed)

**Toggle function:**
```js
function toggleBand(band) {
  var body = document.getElementById('band-' + band);
  var caret = document.getElementById('caret-' + band);
  if (!body) return;
  var isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  if (caret) caret.classList.toggle('collapsed', isOpen);
}
```

**Band header:** `position: sticky; top: 0` so it stays visible as user scrolls a long band.

---

## 7. Sticky form footer

For edit pages (project-edit.html, agent-edit.html), the save/discard/delete actions live in a sticky footer strip that remains visible at the bottom of the scrollable content area.

**Approach:** `position: sticky; bottom: 0` on the footer element inside the scrolling container. Works when the scroll container has `overflow-y: auto` (not `overflow: hidden`).

**Centering:** The footer is full-width but its button group is centred to match the form column width (max-width: 720px):

```html
<div class="form-footer">
  <div class="form-footer-inner">
    <!-- buttons -->
  </div>
</div>
```

```css
.form-footer {
  position: sticky; bottom: 0;
  background: white; border-top: 1px solid var(--border);
  padding: 14px 28px; z-index: 10;
  box-shadow: 0 -2px 8px rgba(0,0,0,0.04);
}
.form-footer-inner {
  max-width: 720px; margin: 0 auto;
  display: flex; align-items: center; gap: 10px;
}
```

**Button order:** Discard (secondary) — Save (primary) — Delete (destructive, `margin-left: auto`).

**Warning:** If any ancestor of the footer has `overflow: hidden`, sticky will not work. The scroll container must be the closest scrolling ancestor of the sticky element.
