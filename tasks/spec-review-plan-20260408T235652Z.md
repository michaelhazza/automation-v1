# Spec Review Plan

- Spec: `docs/improvements-roadmap-spec.md`
- Spec commit at start: fd04f52568d0664d10410c468b286d31fd39c3b6 (file last touched)
- HEAD commit: 6a8e48b33d88c1218cac7a694f746ffc8c011abd
- Spec-context commit: 7cc51443210f4dab6a7b407f7605a151980d2efc
- Iteration cap: 5
- Stopping heuristic: two consecutive mechanical-only rounds
- Codex CLI resolved: `codex` in PATH, login status = Logged in via ChatGPT
- Codex invocation strategy: `codex exec` with a prompt instructing review of the spec file (the spec-reviewer.md `codex review --file` pattern does not match the actual CLI — `codex review` only works on code diffs/commits/branches; `codex exec` is the non-interactive equivalent for arbitrary prompts including "review this markdown file").

## Pre-loop context check

- `docs/spec-context.md` exists and is current (dated 2026-04-08).
- Spec's framing (lines 12-30) explicitly matches spec-context: pre-production, no live users, dependency-order sequencing, no feature flags except shadow-mode, prefer-existing-primitives, static-gates-primary. No mismatch detected.
- Spec was updated at 2026-04-08 23:01; spec-context at 2026-04-08 23:23. Context is newer than spec; no drift window.
- Loop may proceed to iteration 1.
