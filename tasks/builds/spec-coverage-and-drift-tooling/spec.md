# Stub: Spec coverage + drift detection meta-tooling

**Trigger to activate:** When the first reviewer asks "how much of the spec did this PR land?" OR when a confirmed drift incident shows merged code no longer matching its original spec.

**Scope (one paragraph).** Three related "meta-tooling around specs" features from PR #174 deferred items: (a) spec coverage metrics — surface % of spec requirements implemented per PR, with category breakdown (files / exports / schema / contracts / behavior); (b) drift detection over time — periodic re-verification of merged features against original specs to catch post-merge implementation drift; (c) automated plan validation — verify that `tasks/builds/<slug>/plan.md`'s chunk decomposition actually covers every REQ in the spec, before the chunked implementation starts. Reuses the REQ-extraction pass from `spec-conformance`.

**Origin:** PR #174 deferred items in legacy `tasks/todo.md`.
