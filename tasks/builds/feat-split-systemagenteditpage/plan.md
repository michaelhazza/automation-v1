# Plan — feat-split-systemagenteditpage

Spec: `tasks/builds/feat-split-systemagenteditpage/spec.md`. Source: `client/src/pages/SystemAgentEditPage.tsx` (743 LOC).

Chunks:
1. `system-agent-edit/cron.ts` (parseCron + buildCron) + tests + `atoms.tsx` (Card, CardHeader, Field, Toggle, RoleBadge — single file).
2. Update host imports + verify.

No `.js` suffixes on relative imports.
