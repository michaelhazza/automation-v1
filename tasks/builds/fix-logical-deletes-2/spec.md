# Stub: Soft-delete join gaps follow-up

**Trigger to activate:** Before any production data appears that could be filtered out by missing `deletedAt` joins OR when an audit surfaces a join site that returns soft-deleted rows.

**Scope (one paragraph).** Close the 24 explicit join sites still missing `deletedAt` filters from the post-PR #264 soft-delete sweep. The full inventory is already enumerated in the source location (`fix-logical-deletes-2` reference at line 1523 of the legacy `tasks/todo.md`); each site needs an `isActive(table)` join condition or an explicit `assertActive()` runtime guard at the read boundary.

**Origin:** fix-logical-deletes-2 in legacy `tasks/todo.md`.
