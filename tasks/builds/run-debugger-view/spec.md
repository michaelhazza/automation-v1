# Stub: Run-debugger view

**Trigger to activate:** When an operator next needs to diagnose a misbehaving run and the grep-across-services entry point becomes the bottleneck.

**Scope (one paragraph).** New admin/engineer-facing surface that unifies per-run timeline visualisation: state transitions over time (`state_transition` log lines with `guarded:true`/`false` distinguishing), artefact-chain evolution (parentArtefactId → artefactId pointer graph animated forward), decision points (every `proposeAction` audit + `decideApproval` outcome), and guard violations (`InvalidTransitionError`, `cached_context.write_missing_scope`). Reviewer (CHATGPT-PR211 round 4) explicitly framed "the next bottleneck is operability, not correctness." 2-day spike on the artefact-chain timeline first; decide log-source (structured DB events vs application-log scrape), retention window, access tier (admin-only vs engineer-only), and real-time-vs-post-hoc surface from the spike findings.

**Origin:** CHATGPT-PR211-R4-RUN-DEBUGGER-VIEW in legacy `tasks/todo.md`.
