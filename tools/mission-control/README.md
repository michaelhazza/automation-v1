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
| `GET /api/in-flight` | `{ items: InFlightItem[] }` — the dashboard's primary feed |
| `GET /api/builds` | `{ slugs: string[] }` |
| `GET /api/current-focus` | `{ block, fallback, exists }` |
| `GET /api/review-logs` | `{ logs: ReviewLogMeta[] }` (sorted newest first) |

The `InFlightItem` contract is pinned in the spec at `docs/superpowers/specs/2026-04-28-dev-mission-control-spec.md` § C4.

## Tests

```bash
cd tools/mission-control
npm test
```

Runs the tsx unit tests for the pure log parsers (19 tests covering filename shapes, verdict extraction, current-focus block parsing, progress.md counting, latest-log selection). The Express server, GitHub fetch, and React UI are not unit-tested — manual verification via `npm run dev` is the expected pre-merge check, per the spec § 9 testing posture.

## What it deliberately doesn't do

- **No coordination.** No "trigger review", "merge PR", or "deploy" buttons. If you want those, they belong in a separate spec with auth.
- **No KPIs / charts / aggregations.** One screen, one purpose: see what's in flight. Per `docs/frontend-design-principles.md`.
- **No persistence.** Reads files and GitHub on every request; no DB.
- **No auth.** Binds to `127.0.0.1` only and assumes local-machine trust. If that ever changes, add auth before exposing.
