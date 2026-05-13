# Stub: Mission Control parallel-build parser support

**Trigger to activate:** When the operator next runs two concurrent build slugs and Mission Control loses fidelity tracking both.

**Scope (one paragraph).** Add parallel-build parser support to Mission Control (`tools/mission-control/`). Single tool-file extension: parse the per-build `tasks/builds/<slug>/progress.md` files in parallel, surface both slugs in the dashboard, and reconcile their HTML-comment metadata blocks without one overwriting the other. Clean scope.

**Origin:** PARALLEL-BUILD-DASHBOARD-VISIBILITY in legacy `tasks/todo.md`.
