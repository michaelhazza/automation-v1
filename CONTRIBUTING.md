# Contributing

This document captures conventions that the codebase enforces but the linter alone cannot. For full architecture, build discipline, and per-domain rules, read [`CLAUDE.md`](./CLAUDE.md), [`architecture.md`](./architecture.md), and [`DEVELOPMENT_GUIDELINES.md`](./DEVELOPMENT_GUIDELINES.md) first.

---

## Lint suppression policy

ESLint is the canonical style and correctness gate. Disabling a rule is a deliberate act, not a shortcut. Every suppression must be:

1. **Scoped to the smallest unit possible.** Use `eslint-disable-next-line` (single line) or `eslint-disable` / `eslint-enable` around the smallest contiguous block that needs it. Never disable at file scope unless the whole file is the unit (e.g. generated code, third-party shim).
2. **Specific to one rule.** Disable `@typescript-eslint/no-explicit-any`, not the whole linter. Listing multiple rules in one disable is fine when they all apply to the same line.
3. **Accompanied by a `// reason:` comment on the preceding line.** The reason must describe *why* the rule does not apply to this site, not *what* the rule does. Acceptable reasons:
   - A documented constraint the rule cannot see (cross-block usage, module augmentation requirement, dynamic-import shape).
   - A test stub that intentionally violates type safety to exercise an error path.
   - A framework escape hatch where the rule's correct application would create a worse bug (callback-prop closures, stable refs).

### Format

```ts
// reason: Express module augmentation requires the `namespace` keyword; no alternative syntax exists in TypeScript.
// eslint-disable-next-line @typescript-eslint/no-namespace
namespace Express { ... }
```

The `// reason:` comment goes immediately above the `// eslint-disable-*` directive on the line directly above the suppressed code. One reason per disable.

### Forbidden reasons

- "fixing this would be a refactor" — the refactor is the work; either do it or open a tracked task.
- "the rule is wrong" — if the rule is wrong for this codebase, change the rule in `eslint.config.js` instead of disabling it everywhere.
- "temporary" with no follow-up — temporary suppressions accumulate as permanent. Either fix it now or open a `tasks/todo.md` entry referencing the suppression.
- Generic phrasing like "needed for tests", "required by framework", "library limitation" without naming the specific constraint.

### Common acceptable patterns in this codebase

| Rule disabled | Acceptable site | Required `// reason:` form |
|---------------|-----------------|----------------------------|
| `react-hooks/exhaustive-deps` | `useEffect` whose body closes over inline async functions or callback props that intentionally do not retrigger | "`<symbol>` is an inline async function that closes over state setters; only `<dep>` is the intended trigger." |
| `@typescript-eslint/no-explicit-any` | Test stub for a third-party module surface, or dynamic-import default-export workaround | "Test stub: stand-in for `<symbol>` to exercise the error path." or "Dynamic import: `<package>` ships both ESM and CJS shapes; no clean type exists." |
| `@typescript-eslint/no-namespace` | Express module augmentation in `server/types/*.d.ts` | "Express module augmentation requires the `namespace` keyword; no alternative syntax exists in TypeScript." |
| `no-useless-assignment` | A variable consumed by a `finally` or `catch` block that the analyzer cannot see across blocks | "`<symbol>` is consumed by `clearTimeout` in the finally block; ESLint cannot see cross-block usage." |

If you find yourself wanting to disable a rule and none of the acceptable reasons fit, treat it as a signal that the underlying code wants a different shape, not a different lint config.

### Auditing

`grep -rn "eslint-disable"` is the canonical audit. Every match should have a `// reason:` comment on the preceding line. A suppression without a reason is a finding in any code review.
