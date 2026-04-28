# Mission Control

Read-only "What's In Flight" dashboard. Surfaces every active build slug with its branch, phase, latest review verdict, PR state, and CI status — stitched from local files (`tasks/builds/`, `tasks/review-logs/`, `tasks/current-focus.md`) and the GitHub API.

**Read-only by design.** Does not trigger reviews, merge PRs, or deploy. See the spec at `docs/superpowers/specs/2026-04-28-dev-mission-control-spec.md` § A2 for rationale.

---

## Run it

```bash
cd tools/mission-control
npm install
npm run dev
```

The dev script starts the Express server (default `http://127.0.0.1:5050`) and the Vite client (default `http://127.0.0.1:5051`) concurrently. Open the client URL in a browser.

For a one-off check without the client, hit the API directly:

```bash
npm run dev:server
curl -s http://127.0.0.1:5050/api/in-flight | jq .
```

## Configuration

All paths and credentials are env vars. Copy `.env.example` to `.env` (next to this README) and edit:

| Variable | Default | Purpose |
|---|---|---|
| `MISSION_CONTROL_REPO_ROOT` | `process.cwd()` | Filesystem root the dashboard reads logs and build progress from |
| `MISSION_CONTROL_PORT` | `5050` | Port the dashboard server binds to (`127.0.0.1` only) |
| `MISSION_CONTROL_CLIENT_PORT` | `5051` | Vite client dev-server port |
| `MISSION_CONTROL_GITHUB_REPO` | inferred from `git remote get-url origin` | GitHub repo for PR + CI lookups; format `<owner>/<name>` |
| `GITHUB_TOKEN` | unset | Optional read-only PAT (PR + actions read scopes). Without it the dashboard falls back to public-rate-limited GitHub access (60 req/hr). |

## What it reads

The dashboard never writes. It composes data from:

1. **`tasks/builds/<slug>/`** — every directory here is a build slug. `progress.md` (if present) is parsed for `**Last updated:**` and checkbox completion (`[x]` vs `[ ]`).
2. **`tasks/review-logs/`** — the most recent review log per slug is read, and the `**Verdict:** <ENUM>` line within the first 30 lines is extracted. Filename shapes accepted:
   - `<agent>-log-<slug>-<timestamp>.md` (the README convention)
   - `spec-review-final-<slug>-<timestamp>.md` (spec-reviewer's final report)
   - `chatgpt-(pr|spec)-review-<slug>-<timestamp>.md` (chatgpt agents — historical, no `-log-` infix)
3. **`tasks/current-focus.md`** — the `<!-- mission-control ... -->` HTML comment block at the top is parsed for `build_slug`, `branch`, `status`, `last_updated`. The block mirrors the prose; if absent, falls back to scraping `**Active build slug:** ...` from the prose.
4. **GitHub API** — for the active branch only: most recent PR + check-run status. Cached in-memory for 60s.

## Verdict header convention

The dashboard relies on every review-agent log having a parseable `**Verdict:**` line. See `tasks/review-logs/README.md § Verdict header convention` for the regex and the per-agent enum table. If a log has no verdict, the dashboard treats it as "review in progress."

## Portability — drop into another repo

The directory is self-contained. To use it on a different project:

```bash
cp -r tools/mission-control /path/to/other-project/tools/
cd /path/to/other-project/tools/mission-control
npm install
# Configure env vars in .env or your shell:
#   MISSION_CONTROL_GITHUB_REPO=other-org/other-repo
#   GITHUB_TOKEN=<pat>
npm run dev
```

The dashboard expects the target project to follow the same `tasks/builds/` + `tasks/review-logs/` + `tasks/current-focus.md` conventions. If yours doesn't, the dashboard renders nothing useful — the conventions are documented in the parent repo's `tasks/review-logs/README.md` and `CLAUDE.md`.

## Endpoints

| Endpoint | Returns |
|---|---|
| `GET /api/health` | `{ ok, repoRoot, githubRepo, hasGithubToken }` |
| `GET /api/in-flight` | `{ items: InFlightItem[], isPartial: boolean }` — the dashboard's primary feed. `isPartial` is true when at least one item's `dataPartial` is true (one or more underlying GitHub fetches errored). |
| `GET /api/builds` | `{ slugs: string[] }` |
| `GET /api/current-focus` | `{ block, fallback, exists, mismatch }` — `mismatch` is `{ block, prose }` when the machine block disagrees with the prose body's `**Active build slug:**` (spec § C3 keeps prose canonical), otherwise `null`. |
| `GET /api/review-logs` | `{ logs: ReviewLogMeta[] }` (sorted newest first) |

The `InFlightItem` contract (including `dataPartial: boolean`, `pr.ci_updated_at: string \| null`, and the three-state phase resolution) is pinned in the spec at `docs/superpowers/specs/2026-04-28-dev-mission-control-spec.md` § C4.

## Tests

```bash
cd tools/mission-control
npm test                                                          # logParsers (22 tests)
npx tsx server/__tests__/inFlight.test.ts                         # phase derivation (11 tests)
npx tsx server/__tests__/github.test.ts                           # CI status + ts helpers (12 tests)
```

Total **45 dashboard tests** (plus 23 for the chatgpt-review CLI under `scripts/__tests__/`). The Express server, GitHub fetch, and React UI are not unit-tested — manual verification via `npm run dev` is the expected pre-merge check, per the spec § 9 testing posture.

## What it deliberately doesn't do

- **No coordination.** No "trigger review", "merge PR", or "deploy" buttons. If you want those, they belong in a separate spec with auth.
- **No KPIs / charts / aggregations.** One screen, one purpose: see what's in flight. Per `docs/frontend-design-principles.md`.
- **No persistence.** Reads files and GitHub on every request; no DB.
- **No auth.** Binds to `127.0.0.1` only and assumes local-machine trust. If that ever changes, add auth before exposing.
- **No mutation of findings.** No manual override, no editing in the UI, no "acknowledge and hide". The dashboard is a deterministic projection of what the underlying logs and APIs say. Spec § A2 locks this constraint — change it via a new spec, not a quick edit.

## Partial-data signal

When a GitHub fetch errors (rate-limit, network blip, auth failure), the affected `InFlightItem` carries `dataPartial: true` and the response carries `isPartial: true`. The UI shows:

- A top-level amber banner explaining that some data is incomplete.
- A small amber "partial" pill on each affected card.

This avoids the "false confidence" failure mode where a silent fetch error makes a card render "all clear" when it's actually missing data. Errors auto-clear on the next successful poll (5s error-cache TTL vs 60s/120s success).
