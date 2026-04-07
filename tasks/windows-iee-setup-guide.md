# AutomationOS IEE — Windows Local Development Setup

This guide is the companion to `docs/iee-development-spec.md`. It is the exact, repeatable procedure for getting the IEE working on a Windows PC and laptop. Follow it identically on both machines.

The result: three services running locally via Docker Compose — main app, IEE worker, Postgres — using the **same code** that will later run against Neon + a DigitalOcean VPS.

> Notable differences from the original draft (v0):
> - All work happens in **WSL2 home directory**, not Windows filesystem (hard requirement, not optional).
> - Single repository — `worker/` lives **inside** the existing repo, not as a sibling. The brief assumes a single Git repo, and the spec puts `worker/` at the project root.
> - The compose file lives at the **repo root** (`docker-compose.yml`), not in a parent folder.
> - `.env` uses one consistent `DATABASE_URL` for both app and worker (same Postgres, no separate `WORKER_DATABASE_URL`).
> - `MAX_COMMAND_TIME_MS` and concurrency variables are added (the spec requires them).
> - Playwright base image and Node version pinned to match the worker `Dockerfile` in the spec.
> - Verification steps include the IEE-specific smoke tests from the spec §10.3.

---

## Prerequisites

- **Disk space:** at least **15 GB free** on the WSL2 virtual disk. The Playwright base image alone is ~1.5 GB; persistent browser sessions, Postgres data, and dev workspaces grow over time. Going below 10 GB causes silent Docker build failures.
- **RAM:** 8 GB system RAM minimum. Docker Desktop will be allocated 6 GB.

---

## Step 1 — Enable WSL2 + Ubuntu

Open **PowerShell as Administrator** and run:

```powershell
wsl --install -d Ubuntu
```

Restart when prompted. Open the **Ubuntu** app from Start, complete first-run setup (create a Linux username/password). Verify:

```bash
uname -r          # should print a kernel version
wsl.exe -l -v     # run from PowerShell — Ubuntu must show VERSION 2
```

If Ubuntu shows VERSION 1, run `wsl --set-version Ubuntu 2` from PowerShell.

---

## Step 2 — Install Docker Desktop

Download from [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop). During install:
- ✅ Use WSL2 based engine
- ✅ Enable WSL2 integration

After install, open Docker Desktop:
1. **Settings → Resources → Advanced**: Memory ≥ **6 GB** (Playwright + Postgres + app). CPUs ≥ 2.
2. **Settings → Resources → WSL Integration**: toggle Ubuntu **on**.

> 6 GB is a bump from the original 4 GB. Playwright + a real Node app + Postgres concurrently will OOM at 4 GB on first build.

Verify in Ubuntu:

```bash
docker --version
docker compose version    # must be v2.x — note: no hyphen
```

---

## Step 3 — Clone the AutomationOS repo into WSL2

**Critical:** clone into the WSL2 home directory (`~`), **never** into `/mnt/c/...`. Filesystem performance on `/mnt/c` is an order of magnitude worse and will break Playwright timing.

```bash
cd ~
git clone https://github.com/michaelhazza/automation-v1.git automation-os
cd automation-os
git checkout claude/automate-video-transcript-workflow-NXXVf
```

The repo already contains:
- `server/` — main app
- `client/` — React frontend
- `worker/` — IEE worker (added by this branch)
- `docker-compose.yml` — at the repo root
- `.env.example` — copy this to `.env`

Confirm:

```bash
ls -la worker docker-compose.yml .env.example
```

---

## Step 4 — Create your `.env`

```bash
cp .env.example .env
nano .env
```

Fill in any LLM provider keys you have (`ANTHROPIC_API_KEY`, etc. — see the existing `.env.example` for the full list). The IEE-specific defaults below are pre-set in `.env.example`; adjust only if you have a reason.

Minimum required for the IEE to boot:

```env
# Postgres (local Docker)
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=automation_os

# Single connection string used by both app and worker
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/automation_os

# App
PORT=3000

# IEE worker
BROWSER_SESSION_DIR=/var/browser-sessions
WORKSPACE_BASE_DIR=/tmp/workspaces
MAX_STEPS_PER_EXECUTION=25
MAX_EXECUTION_TIME_MS=300000
MAX_COMMAND_TIME_MS=30000
MAX_RETRIES=3
WORKER_POLL_INTERVAL_MS=1000
IEE_BROWSER_CONCURRENCY=1
IEE_DEV_CONCURRENCY=2
LLM_ROUTER_MODE=shared
NODE_ENV=development
```

> The hostname `postgres` resolves to the Postgres container automatically inside the Compose network. Do **not** use `localhost` here.

> `.env` is in `.gitignore`. Never commit it. You must recreate it on each new machine.

---

## Step 5 — Verify `docker-compose.yml`

The file lives at the repo root. It should already define three services: `postgres`, `app`, `worker`. Key things to check:

```yaml
services:
  postgres:
    image: postgres:15
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
      interval: 5s
      timeout: 5s
      retries: 5
    # ...

  app:
    depends_on:
      postgres:
        condition: service_healthy

  worker:
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    volumes:
      - worker_sessions:${BROWSER_SESSION_DIR}

volumes:
  postgres_data:
  worker_sessions:
```

If any of those are missing, fix them before proceeding — the spec requires the health check, the restart policy, and the named volume. There must **not** be a top-level `version:` key (deprecated in Compose v2).

---

## Step 6 — First boot

```bash
docker compose up --build
```

First build downloads the Playwright base image (~1.5 GB). Expect 5–10 minutes on a typical connection. Subsequent starts are <30 s.

> **First-build expectations:** high CPU and RAM usage (close to your Docker Desktop allocation) is normal during the initial build and the first Postgres init. Don't panic if your laptop fan spins up. It settles within a minute of `iee.worker.started` appearing in the logs.

You should see, in order:
1. `postgres` — `database system is ready to accept connections`
2. `app` — your existing app startup logs
3. `worker` — `{"msg":"iee.worker.started", ...}` (single JSON line)

Once happy, restart in detached mode:

```bash
docker compose down
docker compose up -d
```

---

## Step 7 — Verification

Run all of the following. Each must pass before you start using the environment.

### 7.0 60-second sanity check

If you only have a minute, run this one command — it confirms the worker is alive and connected:

```bash
docker compose logs worker | tail -n 50
```

You should see a JSON line containing `"msg":"iee.worker.started"`. If you do, the worker is correctly wired to Postgres and pg-boss. If you don't, jump to Troubleshooting.

### 7.1 All containers running

```bash
docker compose ps
```

All three services show `running` and `healthy` (postgres) / `running` (app, worker).

### 7.2 Postgres reachable

```bash
docker compose exec postgres pg_isready -U postgres
```

Returns `accepting connections`.

### 7.3 IEE schema present

```bash
docker compose exec postgres psql -U postgres -d automation_os -c '\d execution_runs'
```

Shows the `execution_runs` table. If it doesn't, the migrations have not run — execute `npm run db:push` from inside the app container:

```bash
docker compose exec app npm run db:push
```

### 7.4 Worker startup line

```bash
docker compose logs worker | grep iee.worker.started
```

Exactly one match, JSON-formatted, including `pollIntervalMs` and `concurrency`.

### 7.5 IEE smoke tests (when worker code lands)

These scripts ship with the worker:

```bash
# Browser end-to-end
docker compose exec worker node dist/scripts/enqueue-test-browser.js

# Dev end-to-end
docker compose exec worker node dist/scripts/enqueue-test-dev.js
```

Each writes a row to `execution_runs` with `status='completed'` and `resultSummary.success=true`. Tail logs while they run:

```bash
docker compose logs worker -f
```

### 7.6 Idempotency

Run the browser smoke test twice in quick succession. The second run logs `deduplicated: true` and does **not** create a second `execution_runs` row.

```bash
docker compose exec postgres psql -U postgres -d automation_os -c "select count(*) from execution_runs;"
```

### 7.7 Crash survival

```bash
docker compose kill worker
docker compose start worker
docker compose logs worker -f
```

The worker comes back online, redelivers any in-flight job, and either resumes (if `pending`) or aborts cleanly (if `running` from the prior attempt). No corrupted rows.

---

## Step 8 — Accessing the app

- **App UI:** [http://localhost:3000](http://localhost:3000) in your Windows browser.
- **Postgres from Windows tools** (TablePlus, DBeaver): host `localhost`, port `5432`, db `automation_os`, user/password from `.env`. Useful for inspecting `execution_runs` and `execution_steps`.

---

## Step 9 — Second machine

Repeat Steps 1–8 on the laptop. Only difference: at Step 3, you're cloning the same repo, just into the laptop's WSL2 home dir.

Workflow between the two machines:

```bash
# On machine A
git add -A
git commit -m "your message"
git push

# On machine B
git pull
docker compose up --build -d
```

`.env` is **not** in Git — recreate it on each machine via Step 4.

---

## Step 10 — Day-to-day commands

```bash
# Start everything (detached)
docker compose up -d

# Stop everything (keeps data)
docker compose down

# Wipe everything including the Postgres volume
docker compose down -v

# Rebuild after dependency changes
docker compose up --build -d

# Tail logs for one service
docker compose logs worker -f
docker compose logs app -f
docker compose logs postgres -f

# Shell into a container
docker compose exec worker bash
docker compose exec app bash

# Postgres shell
docker compose exec postgres psql -U postgres -d automation_os

# Container resource usage (watch for OOM)
docker stats

# Full reset (wipes Postgres + sessions + workspaces, rebuilds everything)
docker compose down -v && docker compose up --build -d
```

> **Node version note:** you don't run Node directly on Windows for this project — everything runs inside containers. The worker container's Node version is pinned by the Playwright base image (`mcr.microsoft.com/playwright:v1.44.0-jammy` → Node 20). If you want to run any worker scripts directly on the host for debugging, install Node 20 LTS via `nvm` inside WSL2 to match.

---

## How local maps to production

| Component | Local (this guide) | Production |
|---|---|---|
| App | `app` Compose service, port 3000 | Replit |
| Postgres + pg-boss | `postgres` Compose service | Neon (managed) |
| IEE worker | `worker` Compose service | DigitalOcean VPS, Docker |
| `DATABASE_URL` | `postgresql://postgres:postgres@postgres:5432/automation_os` | Neon connection string with `?sslmode=require` |
| `BROWSER_SESSION_DIR` | `worker_sessions` named volume | VPS filesystem path (`/var/browser-sessions`) |

When promoting to production:
1. Create a Neon project. Apply the schema once via `npm run db:push` from a dev machine pointed at the Neon URL.
2. Set `DATABASE_URL` to the Neon URL in **both** Replit Secrets and the VPS `.env`.
3. On the VPS, clone the same repo and run `docker compose -f docker-compose.vps.yml up -d --build` (worker-only Compose file — see spec §10.5).
4. Replit's app enqueues jobs. The VPS worker consumes them. No code changes between local and production — only env values.

---

## Troubleshooting

**`docker compose up` hangs on `postgres` health check.**
Increase Docker Desktop memory to 6 GB+ in Settings → Resources. Postgres OOMs on first init at 2 GB.

**`worker` container restarts every few seconds.**
`docker compose logs worker` will show the cause. Most common: `DATABASE_URL` wrong (using `localhost` instead of `postgres`), or `pg_boss` schema version mismatch (worker pinned to a different `pg-boss` major than the app — pin both to the root `package.json` version).

**Playwright fails with `Host system is missing dependencies`.**
You're running the worker outside the official Playwright base image. Confirm the worker `Dockerfile` `FROM` line matches `mcr.microsoft.com/playwright:v1.44.0-jammy`.

**`node_modules` from the host clobbers the container's node_modules.**
The Compose file uses an anonymous volume on `/app/node_modules` to prevent this. If you've edited the Compose file and removed it, restore it.

**File changes on Windows aren't picked up by the container.**
You're working on `/mnt/c/...` instead of `~/automation-os`. Move the repo into WSL2 home (Step 3).

**`docker compose exec app npm run db:push` fails with auth error.**
Your `.env` `DATABASE_URL` doesn't match the `POSTGRES_USER` / `POSTGRES_PASSWORD` you set. They have to be consistent.

---

## Disk hygiene

The IEE worker creates ephemeral workspaces under `WORKSPACE_BASE_DIR` and writes downloads under `${WORKSPACE_BASE_DIR}/${runId}/downloads`. Workspaces are deleted on job completion, but crashes can leave orphans.

A scheduled cleanup job (`iee-cleanup-orphans`) runs every 6 hours inside the worker and removes orphaned workspaces older than 1 hour. You don't need to do anything for this — it ships with the worker. Spec reference: §12.3.

If you want to manually purge everything between dev sessions:

```bash
docker compose exec worker rm -rf /tmp/workspaces/*
```

Browser sessions in the `worker_sessions` named volume are **not** auto-deleted (losing them logs you out of every authenticated site). To wipe them deliberately:

```bash
docker compose down
docker volume rm automation-os_worker_sessions
docker compose up -d
```
