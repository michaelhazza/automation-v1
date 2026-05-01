# Spec Review Log — Iteration 1

- **Spec:** `docs/superpowers/specs/2026-05-02-pr-249-followups-spec.md`
- **Iteration:** 1 of 5
- **Spec commit at start:** `c70d694fbdd3254e7320e8df24989968cb1c5648`
- **Codex version:** v0.118.0

---

## Findings

### FINDING #1 — Wrong route in Dashboard NavItem snippet (Task 4.1)

- **Source:** Codex
- **Section:** Task 4.1, lines 96-108
- **Description:** Spec instructs implementer to find Dashboard nav by `to="/"` + `Icons.dashboard` and re-introduce the snippet using `to="/"`. Actual code at `Layout.tsx:848` uses `to="/clientpulse" exact`. The `/` route is the Home/Inbox nav item — following the spec literally would either add the badge to Home or break Dashboard's route.
- **Codex's suggested fix:** Update Task 4.1 to target the existing ClientPulse Dashboard nav (`<NavItem to="/clientpulse" exact icon={<Icons.dashboard />} label="Dashboard" />`).
- **Classification:** mechanical
- **Reasoning:** Stale path / wrong file reference. Doesn't change scope or framing — corrects a factual reference.
- **Disposition:** auto-apply

### FINDING #2 — Missing prerequisite about `hasSidebarItem('clientpulse')` gate (Task 4.1/4.3)

- **Source:** Codex
- **Section:** Task 4.1 line 114, Task 4.3 lines 127-131
- **Description:** Dashboard nav is gated by `hasOrgContext && hasSidebarItem('clientpulse')` at `Layout.tsx:845`. Spec at line 114 hand-waves this with "If the Dashboard nav is gated behind a permission" — a verifier in a non-ClientPulse org could conclude the badge is broken when the entire nav section is hidden.
- **Codex's suggested fix:** Add an explicit prerequisite that verification must use an org/subaccount with the ClientPulse module enabled.
- **Classification:** mechanical
- **Reasoning:** Tightens an existing partial reference (line 114 already gestures at this). Doesn't change scope or framing.
- **Disposition:** auto-apply

### FINDING #3 — File inventory drift: `await await` count in `canonicalDataService.principalContext.test.ts` (Task 2)

- **Source:** Codex
- **Section:** Task 2, line 64
- **Description:** Spec says "(one occurrence — grep for `await await` to locate)" but actual file has 5 occurrences (lines 170, 178, 191, 196, 204). Misleads the implementer; the zero-match grep would catch it but the description is wrong.
- **Codex's suggested fix:** Replace "one occurrence" with "multiple occurrences — remove all matches" and rely on the grep as source of truth.
- **Classification:** mechanical
- **Reasoning:** File-inventory drift — the rubric class Codex caught.
- **Disposition:** auto-apply

### FINDING #4 — F6 inventory missing `worker/` (Task 6.1)

- **Source:** Codex
- **Section:** Task 6.1, line 178
- **Description:** Goal of Task 6 is "review each callsite," but F6 inventory only searches `server/ client/ shared/ scripts/`. `worker/` has 10 `Record<string, unknown>` occurrences. F4 inventory at line 145 correctly includes `worker/ tools/`; F6 inventory does not — internal inconsistency.
- **Codex's suggested fix:** Expand F6 inventory scope to include `worker/` (and `tools/` for symmetry with F4).
- **Classification:** mechanical
- **Reasoning:** Inventory drift / scope inconsistency between F4 and F6. Surgical fix.
- **Disposition:** auto-apply

### FINDING #5 — PowerShell vs Unix shell command style

- **Source:** Codex
- **Section:** Task 1, Task 2, Task 5, Verification
- **Description:** Codex flags `grep -c`, `grep -rn`, `2>/dev/null`, `$(git ls-files ...)` as Unix-style commands "not implementation-ready" on a Windows/PowerShell environment.
- **Codex's suggested fix:** Rewrite in PowerShell or use `rg` consistently.
- **Classification:** mechanical → **reject**
- **Reasoning:** Codex misread the environment. Repo CLAUDE.md states: `Shell: bash (use Unix shell syntax, not Windows — e.g., /dev/null not NUL, forward slashes in paths). PowerShell is also available via the PowerShell tool.` Bash is the canonical shell on this repo regardless of the underlying OS. The bash-style commands are correct and consistent with the rest of the repo's documentation. Codex saw PowerShell because that's the OS shell on the reviewer machine, not the project's working shell.
- **Disposition:** reject (cite CLAUDE.md `Shell: bash` convention)

---

## Rubric pass (my own findings)

| Rubric category | Result |
|---|---|
| Contradictions between sections | None found beyond Codex's findings |
| Stale retired language | None |
| Load-bearing claims without contracts | None — this is a cleanup spec; no new contracts |
| File inventory drift | Caught by Codex Findings #3 and #4 |
| Schema overlaps | N/A |
| Sequencing ordering bugs | None — all 7 tasks are independent cleanup items |
| Invariants stated but not enforced elsewhere | N/A |
| Missing per-item verdicts | All 7 tasks have explicit goals + success conditions; "Out of scope" section explicitly lists deferrals |
| Unnamed new primitives | None — no new primitives proposed |
| Spec-authoring checklist compliance | Section 0 (verify deferred items): N/A (review logs are 1 day old); Section 10 (execution-safety): N/A (no new state machines or write paths). All applicable sections satisfied. |
| Test-gate violations (CI-only rule) | None — only `npm run lint` and `npm run typecheck` invoked, which are explicitly allowed per CLAUDE.md |
| Spec/mockup divergence | None: spec acknowledges the mockup's "recommended Option B" annotation and explicitly cites the operator's override (line 91-92) to restore (Option A). Spec's "● 3 live" copy matches mockup Option A line 90. |

No additional rubric findings beyond Codex's.

---

## Adjudication and implementation

### [ACCEPT] Task 4.1 — Wrong route in NavItem snippet
Fix applied: replace `to="/"` with `to="/clientpulse" exact` in the snippet; update the locator narrative to point at the ClientPulse Dashboard nav (and remove the misleading "search for `to="/"` and `Icons.dashboard` together — there are also `Home`/`Inbox` nav items routing to `/`" framing, which becomes incorrect).

### [ACCEPT] Task 4 — Missing `hasSidebarItem('clientpulse')` prerequisite
Fix applied: add a one-line prerequisite to Task 4 stating the verification org/subaccount must have the ClientPulse module enabled, and clarify that "badge invisible" is expected when `hasSidebarItem('clientpulse')` is false (because the entire ClientPulse section is hidden, not just the badge).

### [ACCEPT] Task 2 — `canonicalDataService.principalContext.test.ts` count
Fix applied: replace "one occurrence" with "multiple occurrences" and let the zero-match grep serve as the verification source of truth.

### [ACCEPT] Task 6.1 — F6 inventory scope
Fix applied: expand the inventory grep to include `worker/` (and `tools/` for symmetry with F4 inventory at line 145).

### [REJECT] PowerShell command style
Reason: CLAUDE.md explicitly establishes bash as the project's working shell. The bash-style commands match repo convention.

---

## Iteration 1 Summary

- Mechanical findings accepted:  4
- Mechanical findings rejected:  1
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0
  - AUTO-REJECT (framing):    0
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED:             0
- Spec commit after iteration:   <to be filled after edits>
