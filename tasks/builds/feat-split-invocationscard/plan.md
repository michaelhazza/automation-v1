# Plan — feat-split-invocationscard

Spec: `tasks/builds/feat-split-invocationscard/spec.md`. Source: `client/src/components/InvocationsCard.tsx` (661 LOC).

Single chunk: extract HeartbeatTimeline + AccordionRow as named exports. Update host imports.

No `.js` suffixes on relative imports.
