# IEE Worker Boot Timing — Runbook

Agent-facing. Loaded by Claude when the operator says **"check IEE worker timing breakdown"** (or any close paraphrase).

## Trigger phrases

- "check IEE worker timing breakdown"
- "check worker boot timing"
- "is worker startup slow"

When you see one of these, follow this runbook end-to-end and produce a CEO-level recommendation (per-phase summary + recommendation + tradeoff) — not a raw log dump.

## What gets measured

Single structured log line emitted at the end of [worker/src/bootstrap.ts](../worker/src/bootstrap.ts):

```
msg: "iee.worker.boot_timing"
fields:
  nodeBootMs          // process start → bootstrap() entry. Captures Node + tsx + module-graph load.
  bossStartMs         // pg-boss start() — schema check, queue tables, listen channels.
  playwrightCheckMs   // version + binary smoke check.
  dbCompatCheckMs     // SELECT version() round-trip.
  bootstrapTotalMs    // elapsed bootstrap duration covering the measured phases (tBootstrapStart → tAfterDbCompatCheck). Includes any small gaps between probes and any future logic inserted between them, so it is NOT strictly the arithmetic sum of the three phase fields.
  processToReadyMs    // nodeBootMs + bootstrapTotalMs — the figure that matters end-to-end.
```

### Numerical invariants

- All `*Ms` fields are rounded with `Math.round(...)`. As a result, `bossStartMs + playwrightCheckMs + dbCompatCheckMs` may differ from `bootstrapTotalMs` by ±1-2ms even before accounting for inter-phase gaps. Treat any sub-5ms discrepancy as rounding noise, not a measurement bug.
- Exactly one `iee.worker.boot_timing` log line MUST be emitted per successful worker bootstrap. If you ever see two (or zero) for a single boot, that is a regression — bootstrap was retried internally, partially re-run, or skipped its tail. Investigate `worker/src/bootstrap.ts` rather than re-tuning thresholds.

## What is NOT captured here

- **Image pull time** — happens outside the process. Get it from the orchestrator (Replit / Docker host), not from the log.
- **Container create / start overhead** — same. Outside the process.
- **First job pickup latency** — gap between `iee.worker.boot_timing` and the first job log. Read from log timestamps.

If `processToReadyMs` looks fine but jobs still feel slow, the bottleneck is one of those three external phases.

## How to capture timings

Local single run:

```bash
docker compose up worker
# or, if running directly:
npx tsx worker/src/index.ts
```

Grep the JSON line:

```bash
docker compose logs worker | grep iee.worker.boot_timing
```

For multiple cold starts, restart the container N times and aggregate. A few samples is enough — this is rough optimisation, not a benchmark.

## Interpretation guide

Use this when producing the recommendation. Numbers are rough order-of-magnitude expectations — adjust to what the operator's environment shows.

| Phase | Normal range | If much higher | Likely cause | Actionable lever |
|-------|--------------|----------------|--------------|------------------|
| `nodeBootMs` | 1500-4000ms | > 6000ms | tsx compiling the full server cone on every boot; large import graph | Pre-compile to JS (medium effort, see CLAUDE.md notes — not trivial because of extensionless ESM imports). Or trim worker import graph. |
| `bossStartMs` | 200-1500ms | > 3000ms | pg-boss schema bootstrap on a DB it hasn't seen; high network RTT to Postgres; Postgres under load | Run pg-boss schema install once at deploy time, not per-worker. Check DB region/RTT. |
| `playwrightCheckMs` | < 50ms | > 200ms | fs access on slow disk; Playwright package re-resolution | Probably not worth optimising; it's a one-off boot check. |
| `dbCompatCheckMs` | 20-200ms | > 500ms | DB RTT or pool warmup | Same as `bossStartMs` — usually a network/region issue, not code. |
| `processToReadyMs` | 2-6s | > 10s | combination of above | Tackle the largest contributor first. |

## Levers ranked by ROI

When recommending, lean on this ordering. CLAUDE.md already documents that #2 and #3 are not as cheap as they look; do not pitch them as quick wins unless the timing data clearly points at the relevant phase.

1. **Worker pool / pre-warm** — the only lever that fundamentally hides cold-start cost. Highest ROI for "feels instant" UX, but operationally heavier (idle workers cost money, lifecycle management). Pitch only if the operator cares about p50 job pickup.
2. **Move pg-boss schema install out of per-worker boot** — if `bossStartMs` is consistently high. Low risk, one-time win.
3. **Pre-compile TypeScript** — only if `nodeBootMs` dominates. Real engineering work; see the Dockerfile comment at [worker/Dockerfile:57-60](../worker/Dockerfile#L57-L60) for why it was deferred.
4. **Multi-stage Dockerfile / image slim** — only meaningful if image pull is the dominant external cost. Base image (Playwright Jammy ~2GB) caps the gain.
5. **Trim worker import graph** — reduces `nodeBootMs` without the tsx → node migration. Worth checking which server modules are pulled in via [worker/tsconfig.json](../worker/tsconfig.json) bundled cone.

## Output shape — what the operator gets back

When you finish the analysis, produce **at most**:

- One short paragraph naming the dominant phase and the headline number.
- A 3-5 row table mapping the captured phases to expected ranges, flagging anything outside normal.
- One recommendation with the main tradeoff. Per CLAUDE.md exploratory-question rule.
- A clear ask ("want me to implement X?").

Do NOT paste raw log JSON, do NOT produce a multi-section technical report. Operator is non-technical (per CLAUDE.md User Preferences).

## When operator has not run a worker yet

The instrumentation is dormant until a worker actually boots. If asked for a timing breakdown with no boot log available, say so plainly and offer to: (a) walk them through running the worker once, or (b) infer expected ranges from the current code path without measurement (lower confidence, mark as such).
