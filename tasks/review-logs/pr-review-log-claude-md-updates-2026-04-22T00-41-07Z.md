# PR Review Log

**Branch:** `claude-md-updates` vs `main`
**Files reviewed:**
- `CLAUDE.md`
- `architecture.md` (§ Key files per domain, § Architecture Rules — appended)
- `docs/capabilities.md` (§ Non-goals — appended)
- `tasks/current-focus.md` (new file)
- `.claude/agents/feature-coordinator.md`
- `.claude/agents/chatgpt-spec-review.md`
- Cross-checked: `docs/spec-authoring-checklist.md`, `KNOWLEDGE.md`

**Timestamp:** 2026-04-22T00:41:07Z

---

## Blocking Issues

### 1. `chatgpt-spec-review.md` — stale "In-flight spec" location

The agent fallback reads: "If none: read the 'In-flight spec' pointer from CLAUDE.md". The "In-flight spec" content was extracted from CLAUDE.md to `tasks/current-focus.md` by this PR. The agent will grep CLAUDE.md and find nothing.

**Fix:** Update the fallback to read `tasks/current-focus.md` instead of CLAUDE.md.

### 2. `docs/spec-authoring-checklist.md` — stale pointer to CLAUDE.md

The checklist reads: "`CLAUDE.md` → 'Key files per domain' table." This section no longer exists in CLAUDE.md — it moved to `architecture.md § Key files per domain`.

**Fix:** Update to reference `architecture.md`.

### 3. `KNOWLEDGE.md` — stale section reference

An entry reads: "This is enforced via CLAUDE.md 'Key files per domain' table." The table is now in `architecture.md`.

**Fix:** Append a correction entry (append-only convention). Do not edit in place.

---

## Strong Recommendations

### 4. CLAUDE.md Plan gate table — wrong actor named

The "Model guidance per phase" table says "`architect` presents the plan and stops." Per `feature-coordinator.md § B.5`, it is the **feature-coordinator** that stops — the architect only writes the plan. A developer invoking `architect` directly will expect it to stop them; it will not.

**Fix:** Update the plan gate row to name `feature-coordinator` as the actor.

### 5. Historical build artifacts reference stale CLAUDE.md sections

Files in `tasks/builds/clientpulse/` and several spec files reference "Update CLAUDE.md §'Key files per domain'" and "CLAUDE.md §'Current focus'" as update destinations. These are historical records — add a migration note to `tasks/current-focus.md` redirecting both.

---

## Non-Blocking

### 6. Compact protocol missing the `tasks/current-focus.md` fallback

The pre-break protocol mentions the fallback correctly; the compact protocol block does not. Add "(or `tasks/current-focus.md` if not under a build slug)" to the compact step.

### 7. Content migrations verified — no action needed

All moved sections are correct and complete: `architecture.md § Key files per domain` description adapted correctly, `docs/capabilities.md § Non-goals` self-reference adapted correctly, `feature-coordinator.md § B.5` gate logic is sound, no content dropped.

---

**Verdict:** Three blocking (stale references in living docs), one strong recommendation (wrong actor in table). All are one-line or append-only fixes. Core content migration is correct and complete.
