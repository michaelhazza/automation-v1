# Wave 6 Session P — knip candidate triage

Significant-class light-pipeline. Single coordinated PR (or split into 2-3 sub-PRs if the operator prefers smaller review surface). 134 files in `knip.json` ignore list need per-file decisions: delete, wire to a route/entry point, or confirm legitimate false positive.

**Paste the block below as the opening message of a fresh Claude Code session in Env P.**

---

```
Wave 6 Session P — knip candidate triage. Significant-class
light-pipeline. No spec-coordinator. Scope locked below.

CONTEXT: Wave 5 fix-loop narrowed knip.json's entry list and surfaced
134 files currently in the ignore list that are candidates for
deletion, wiring, or confirmation. Per CLAUDE.md §6 "Surface, don't
smuggle", these are routed to triage rather than silently ignored.

See tasks/todo.md "Wave 5 knip candidate triage" section (line 1867
onward) for the full list, partitioned into:
- Client: 101 candidates
- Server: 33 candidates
- Shared: 4 candidates

1. Sync and branch:
     git fetch origin main
     git checkout -b claude/wave-6-knip-candidate-triage origin/main

2. Chunk 0 — verify and partition. Run `npx knip` against current main
   to refresh the candidate list (some may have shifted post-Wave-5).
   For each candidate, classify into one of four verdicts:

   - DELETE: file has no callers, exports nothing live code references,
     not wired to any route/entry point. Safe to remove entirely.
   - WIRE: file exists and was meant to be reachable but a route/entry
     point reference is missing. Add the route/import.
   - FALSE-POSITIVE: file IS used but knip's static analysis misses
     the link (dynamic imports, build-time references, JSX implicit
     imports, etc.). Add to knip.json `entry` or `ignore` with WHY
     comment + ADR reference.
   - DEFER: not enough context for a confident decision in chunk 0.
     Mark with operator question, surface at chunk-0 close.

   Output: tasks/builds/wave-6-knip-candidate-triage/triage-verdicts.md
   listing every candidate + verdict + rationale.

3. Operator review gate after chunk 0. Operator reads triage-verdicts.md,
   confirms verdicts, resolves DEFER items, then approves the chunk
   plan. DO NOT proceed past chunk 0 without operator approval —
   accidentally deleting a file used via dynamic import is hard to
   recover from.

4. Per-verdict chunks (architect partitions during chunk-0 plan):

   - Chunk D (DELETE candidates): bulk-delete in one commit per
     subdomain (chat-components, brief-components, baseline-components,
     etc.). If a delete chunk exceeds 30 files, split. Each chunk's PR
     summary lists every file deleted + a single-line justification.
   - Chunk W (WIRE candidates): add missing route mounts / imports.
     Each WIRE chunk is small (typically 1-3 files per route).
   - Chunk F (FALSE-POSITIVE candidates): update knip.json entry/ignore
     with WHY comment. Single chunk; bulk knip.json edit.

5. Verification per chunk:
   - npm run build:server + build:client must exit 0 after every delete
     chunk. If a build break surfaces, the deleted file WAS used; revert.
   - npm run typecheck must exit 0. Any "implicit any" or "module not
     found" indicates a missed link.
   - npx knip after the WIRE + FALSE-POSITIVE chunks land. Total
     unused-file count should drop to under 10.

6. Sub-task — sweep ~80 unused exports in shared/types/* (Wave-2 audit
   item, line 296 in todo). These overlap with knip's unused-exports
   report. After the 134-file file triage lands, run `npx knip
   --reporter json | jq '.exports[]'` and produce a similar verdict
   table for the unused exports. Apply the same DELETE / KEEP-WITH-WHY
   pattern.

7. Final checks:
   - npx knip exits with < 10 unused-file flags and < 10 unused-export
     flags
   - npm run build:server / build:client / lint / typecheck all exit 0
   - tasks/todo.md "Wave 5 knip candidate triage" section marked
     [status:closed:pr:<num>] in the merge commit
   - tasks/todo.md "~80 unused exports in shared/types/*" item marked
     [status:closed:pr:<num>]

8. Run pr-reviewer. Apply blocker / strong-recommendation findings.
   PR title: "wave-6: knip candidate triage + shared/types cleanup (Session P)".

9. End-of-session report (CEO-level, < 200 words):
   - Total files deleted / wired / confirmed-false-positive / deferred
   - Surprises (any candidate that turned out to be load-bearing despite
     no static reference)
   - Final knip count vs entry-point reduction target (under 10)

DO NOT touch Session O scope (RLS migration on tenant tables). DO NOT
touch Session Q scope (cleanup batch). If a knip candidate is ALSO a
target file in O or Q (e.g., a service Session O is migrating), DEFER
that file's knip verdict to Wave 7 — let O/Q finish first.

If a DELETE candidate has even one git-history reference suggesting it
was used intentionally (e.g., recent file rename, recent comment
describing intent), DEFER the delete to operator review. Better to
keep a dead file than to delete a load-bearing one.
```

## Notes on knip.json post-Wave-5 state

The current `knip.json` (post-fix-loop on PR #335) narrows the `entry` list significantly — removed over-broad globs like `scripts/lib/*.ts`, `server/jobs/*.ts`, `server/routes/*.ts`, `server/workflows/*.ts`. Post-narrowing, knip surfaces ~45 additional candidate-unused files beyond the original 134 — including genuinely deprecated routes (`server/routes/agentTemplates.ts`, `server/routes/orgWorkspace.ts` — both removed from mount in `server/index.ts` but the source files remain). Chunk 0's `npx knip` re-run will capture these.

## File-overlap deconfliction

- **Session O (RLS residue)**: touches `server/services/*` heavily. **Limited overlap with P** — most knip candidates are dead-code paths that wouldn't have raw `db` callsites. If a knip candidate IS a service O is migrating, defer the knip verdict.
- **Session Q (cleanup)**: touches `client/src/components/*` (19 duplicate exports drop) — minor overlap with P's 101 client candidates. Q's duplicate-exports list is small + specific; chunk 0 confirms no overlap with P's delete list.
- **Session R (operator feature)**: file-overlap unknown until R's spec lands. If R uses a file P would delete, R wins (file is now live again).
