# PR Review Log — Task 5.1 PendingHero component
**Slug:** clientpulse-ui-simplification / task-5-1
**Timestamp:** 2026-04-24T06-20-00Z
**Files reviewed:** `client/src/components/clientpulse/PendingHero.tsx`

---

## Blocking Issues

None.

---

## Strong Recommendations

### 1. Remove the `React.ReactElement` return type annotation and the `React` namespace import
Every other component in the folder omits `import React` when not needed for JSX emission (React 17+ automatic runtime). Drop the annotation and the import.

### 2. Guard against a stale `reviewItemId` closure when `pendingIntervention` changes mid-flight
Capture `reviewItemId` at call time inside the handler rather than from the closure, so mid-flight prop replacement doesn't silently call the wrong item.

### 3. Add spec-citation comment block to match folder convention (skipped — conflicts with CLAUDE.md rule against multi-line comment blocks)

---

## Non-Blocking

- Button font-size `text-sm` vs. folder convention `text-[12px]`/`text-[13px]`
- `aria-busy` absent on submitting buttons
- `disabled:cursor-not-allowed` missing on buttons

---

## Verdict

Clean component. No blocking issues. Two strong recommendations implemented in-session.
