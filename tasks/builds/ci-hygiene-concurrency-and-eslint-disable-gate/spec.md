# Stub: CI hygiene — concurrency guard + ESLint-disable gate

**Trigger to activate:** When rapid pushes start producing duplicate CI runs OR when `eslint-disable` comments start landing without justification.

**Scope (one paragraph).** Two CI-hygiene items that ship together: (a) add `concurrency: group: lint-typecheck-${{ github.ref }}, cancel-in-progress: true` to the `lint_and_typecheck` job to prevent duplicate runs on rapid pushes; (b) wire CGPT P2.1-R3's "CI gate that fails on new `eslint-disable` comments unless paired with a justification comment". Both are CI-only changes; no application code touched.

**Origin:** CGPT P2.1-R3 + lint-typecheck deferred concurrency in legacy `tasks/todo.md`.
