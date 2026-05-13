# Stub: External Call Safety Contract abstraction

**Trigger to activate:** When the next subsystem (payments, webhook dispatch, integration adapter, long-running agent task) re-invents intent-record / external-side-effect / single-terminal-transition / ghost-arrival-detection logic — extract before adding the third caller.

**Scope (one paragraph).** Extract the pattern currently embodied in `llmRouter.ts` — `intent-record → external-side-effect → single-terminal-transition → ghost-arrival-detection → caller-owned-retry → observable-in-flight → best-effort-history` — into a reusable platform primitive that payments, webhook dispatch, integration adapters, and long-running agent tasks can all inherit without reintroducing unsafe retry logic. The primitive surface and durable-state model need their own design pass; the existing `llmRouter` shape is the canonical reference implementation.

**Origin:** LAEL-RELATED in legacy `tasks/todo.md`; reinforced post-in-flight-tracker merge.
