## Summary

<!-- 1–3 bullets: what changed and why. -->

## Spec Conformance

- [ ] **Spec reference:** `<path/to/spec.md>` or `ad-hoc, no spec`
- [ ] **`spec-conformance` log:** `tasks/review-logs/spec-conformance-log-<slug>-<timestamp>.md` (or `n/a — ad-hoc`)
- [ ] **`pr-reviewer` log:** `tasks/review-logs/pr-review-log-<slug>-<timestamp>.md`
- [ ] **Log quality:**
  - [ ] Both logs have a clear verdict (`CONFORMANT` / `CONFORMANT_AFTER_FIXES` for spec-conformance; `Verdict: <one line>` for pr-reviewer).
  - [ ] All blocking findings are addressed in this PR or deferred to `tasks/todo.md` with an `[origin:<agent>:<slug>:<timestamp>]` tag and `[status:open]`.
  - [ ] Deferred items reference back to the source log via the `origin:` tag.
- [ ] Architectural / RLS / migration / schema changes — `DEVELOPMENT_GUIDELINES.md` checklist (§9) cleared
- [ ] **Allow-list bypass annotations** — if this PR touches a query against an RLS-not-applicable allowlist table (see `scripts/rls-not-applicable-allowlist.txt`), paste `grep -nE "@rls-allowlist-bypass" <file>` output below for each touched file:

```
<paste here, or "n/a — no allowlist-table queries touched">
```

## Test plan

<!-- Bulleted markdown checklist of TODOs for verifying the PR. -->

- [ ]

### RLS allow-list query touches (if applicable)

If this PR touches a query against an RLS-not-applicable allow-list table,
paste `grep -nE "@rls-allowlist-bypass" <each touched file>` output here:

```
(paste output, or write `n/a — no allow-list table queries touched`)
```

## new-task-modal-overhaul manual gates (remove after merge)

- [ ] Lifecycle notice copy reviewed: "Attachments are uploaded as context to help your agent understand your request. They are not guaranteed to be processed in every workflow step." (or approved alternative)
- [ ] Instructions field label reviewed: matches "Instructions" (not "Description" or "Brief")
- [ ] Advanced section toggle copy reviewed: "Advanced" label is clear for non-technical operators
- [ ] Portal cards RLS policy name noted: policy is `portal_cards_org_isolation` on the `portal_cards` table (renamed from `portal_briefs_org_isolation` in migration 0376)
- [ ] Migration F pre-production-only caveat acknowledged
- [ ] `verify-brief-rename.sh` passes (exit 0) on this PR's diff
