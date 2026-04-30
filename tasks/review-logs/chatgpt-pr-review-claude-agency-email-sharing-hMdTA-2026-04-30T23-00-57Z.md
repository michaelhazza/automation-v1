# ChatGPT PR Review Session — claude-agency-email-sharing-hMdTA — 2026-04-30T23-00-57Z

## Session Info
- Branch: claude/agency-email-sharing-hMdTA
- PR: #242 — https://github.com/michaelhazza/automation-v1/pull/242
- Mode: manual
- Started: 2026-04-30T23:00:57Z
- Status: IN_PROGRESS
- Verdict: —

### Context
Previous attempt (2026-04-30T21-14-17Z) was ABORTED — full diff (~7.68M tokens) exceeded gpt-4.1 rate limit.
Three rounds of manual ChatGPT feedback were applied informally in the prior session (findings D-GPT-1 through D-GPT-5 deferred, others applied or rejected).
This session uses corrected diff base (`origin/main`, not local `main`) → 460KB / 59 files.

---

## Decisions Log

| Round | Finding | Title | Triage | Recommendation | Decision | Action |
|-------|---------|-------|--------|----------------|----------|--------|
| 1 | F1 | Em-dashes in docs | technical | reject | rejected | Rule scoped to UI copy/labels; docs/capabilities.md and DEVELOPMENT_GUIDELINES.md are agent-facing docs |
| 1 | F2 | Picker reopens on rerender | technical | implement | implemented | `handlePick` wrapped in `useCallback` in TaskModal.tsx:384 |
| 1 | F3 | DataSourceManager wrong connections endpoint | technical | implement | implemented | Changed to `/subaccounts/:id/connections` (subaccount-scoped); filters by `google_drive` client-side |
| 1 | F4 | Failure policy not hydrated | technical | implement | implemented | GET returns `{ refs, fetchFailurePolicy }`; `loadDriveRefs` calls `setFetchFailurePolicy` |
| 1 | F5 | Rebind skips access verification | technical | defer | deferred | Server validates on POST; routed to tasks/todo.md |
| 1 | F6 | Squash migrations 0262+0263 | technical | reject | rejected | 0263 is a documented corrective migration; squashing is bad practice |
| 1 | F7 | Unique index too broad | technical | reject | rejected | Index is on `reference_documents`; multi-bundle sharing via `document_bundle_members` (many-to-many) |

### Round 1 commit
`3a8632e6` — fix(external-doc-refs): ChatGPT round-1 — picker reopen, connection scope, failure policy hydration

| 2 | F1 | Picker re-open — onClose still inline | technical | implement | implemented | `handleClosePicker = useCallback(...)` extracted; passed as `onClose` to DriveFilePicker |
| 2 | F2 | Connection scope inconsistency | technical | reject | rejected | Agent scope is dead code (no callsite); all live paths fixed in R1 |
| 2 | F3 | Failure policy not hydrated | technical | reject | rejected | Fixed in R1; ChatGPT reviewed pre-fix code |
| 2 | F4 | Rebind skips access validation | technical | implement | implemented | `ExternalDocumentRebindModal` calls `verifyAccess()` on connection select; blocks confirm on failure |
| 2 | F5 | Squash migrations | technical | reject | rejected | Corrective migration pattern is correct |
| 2 | F6 | Unique index too broad | technical | reject | rejected | Misread: multi-bundle via `document_bundle_members` |

### Round 2 commit
`3fde398e` — fix(external-doc-refs): ChatGPT round-2 — memoize onClose, rebind access verification

---
