# AutomationOS IEE — Windows Local Development Setup

This guide is the companion to `docs/iee-development-spec.md`. It is the exact, repeatable procedure for getting AutomationOS + the IEE worker running on a Windows PC. Follow it identically on every machine.

> **Audience.** Written for two readers at once:
> - **A human developer** doing first-time setup on a new Windows machine.
> - **An AI assistant (Claude Code) escorting the human through that setup.** Each step has both the command to run and the reasoning behind it, so the assistant can explain decisions to the user, recover from errors, and skip steps that have already been done.
>
> Treat the body of each step as authoritative — including the warning callouts. They exist because someone hit that exact failure mode in real setup before.

The result: two services running locally via Docker Compose — the main app and the IEE worker — connected to a **native Windows PostgreSQL** install via `host.docker.internal`. Same code that will later run against Neon + a DigitalOcean VPS.

> Why no bundled Postgres? The original draft used a `postgres` Compose service. We moved to host PostgreSQL because the real, populated dev database lives on the Windows host and importing a 200+ MB dump into a fresh container on every reset was painful. The `postgres` service has been removed from `docker-compose.yml` entirely — only `app` and `worker` remain. If you want to re-enable it, add a `postgres:` service back (image, healthcheck, named volume) and revert the `DATABASE_URL` overrides on `app` and `worker` so they point at it.

> Notable differences from the original draft (v0):
> - All work happens in **WSL2 home directory**, not Windows filesystem (hard requirement, not optional).
> - Single repository — `worker/` lives **inside** the existing repo at the project root.
> - The compose file lives at the **repo root** (`docker-compose.yml`).
> - Postgres is **not** in compose — runs natively on the Windows host. Compose connects via `host.docker.internal`.
> - Migrations are applied via the custom `npm run migrate` runner (`scripts/migrate.ts`), **not** `drizzle-kit migrate` or `drizzle-kit push`.
> - `MAX_COMMAND_TIME_MS` and concurrency variables are required (spec).
> - Playwright base image and Node version pinned to match the worker `Dockerfile`.

---

## Prerequisites

- **Disk space:** at least **15 GB free** on the WSL2 virtual disk. The Playwright base image alone is ~1.5 GB; persistent browser sessions and dev workspaces grow over time. Going below 10 GB causes silent Docker build failures.
- **RAM:** 8 GB system RAM minimum. Docker Desktop will be allocated 6 GB.
- **Node.js 20 LTS on Windows.** Required to run `npm install` and `npm run migrate` from PowerShell (the migration runner connects directly from Windows to host Postgres, not from inside a container). Install from [nodejs.org](https://nodejs.org/) or via `winget install OpenJS.NodeJS.LTS`.
- **PostgreSQL 16+ on Windows.** Required because the app and worker connect to a host-native PG instance via `host.docker.internal`. Install from [postgresql.org/download/windows](https://www.postgresql.org/download/windows/) — note the password you set for the `postgres` superuser, you'll need it in `.env`.

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
1. **Settings → Resources → Advanced**: Memory ≥ **6 GB**. CPUs ≥ 2. (On WSL2 backend you may not see sliders — limits are managed by `.wslconfig` in your Windows home directory if you need to bump them.)
2. **Settings → Resources → WSL Integration**: toggle **Ubuntu** on, click **Apply & Restart**. This is mandatory — without it, `docker` commands run inside the Ubuntu shell will fail with `Cannot connect to the Docker daemon`.

> 6 GB is a bump from the original 4 GB. Playwright + a real Node app concurrently will OOM at 4 GB on first build.

Verify in Ubuntu:

```bash
docker --version
docker compose version    # must be v2.x — note: no hyphen
```

---

## Step 3 — Clone the AutomationOS repo

**Clone into the Windows filesystem**, not WSL2 home. The canonical layout on Windows is:

```
C:\Files\Projects\automation-v1\
```

(or anywhere under `C:\` you prefer — the path is referenced from `docker-compose.yml`'s bind mount, which uses the host path Docker Desktop sees, so any Windows path works.)

From PowerShell:

```powershell
cd C:\Files\Projects
git clone https://github.com/michaelhazza/automation-v1.git
cd automation-v1
# If you need to work on a specific feature branch (e.g. when handed
# this guide on a particular Claude branch):
git checkout <branch-name>
```

> **Why Windows-side, not WSL2 home?** Docker Desktop's WSL2 backend bind-mounts the Windows checkout into the container automatically (`.:/app` in the compose file), so file watching and HMR work fine from the Windows side. You also need to run `npm install` and `npm run migrate` from PowerShell (Windows-native Node), which is awkward when the repo lives at a `\\wsl$\...` UNC path — Windows tools choke on UNC paths and silently fall back to `C:\Windows`. Old versions of this guide recommended cloning into `~/automation-os` from inside Ubuntu; that layout still *works* for `docker compose` commands but breaks the migrate step. **Pick one location, Windows-side.**

> **Do not have two clones.** If you previously cloned into both `C:\Files\Projects\automation-v1\` AND `~/automation-os` (inside WSL), you'll end up with two Compose projects (`automation-v1` and `automation-os`) fighting for ports 3000/5000. Pick the Windows-side one as canonical and `docker compose down` the WSL one.

The repo contains:
- `server/` — main app
- `client/` — React frontend
- `worker/` — IEE worker
- `docker-compose.yml` — at the repo root
- `.env.example` — **incomplete**, see Step 4 for the full required env list
- `scripts/migrate.ts` — the custom forward-only migration runner you'll use instead of `drizzle-kit migrate`

Confirm:

```bash
ls -la worker docker-compose.yml .env.example
```

---

## Step 4 — Create your `.env`

From PowerShell or any editor:

```powershell
copy .env.example .env
notepad .env
```

> **Important — `.env.example` is incomplete.** It does NOT include `TOKEN_ENCRYPTION_KEY`. You must add this line manually after copying the file, or the worker will crash-loop on boot with a Zod validation error. The block below shows everything you need; treat it as the source of truth, not `.env.example`.

Fill in any LLM provider keys you have (`ANTHROPIC_API_KEY`, etc. — see the existing `.env.example` for the full list of provider keys, all of which are optional for first boot).

Minimum required for the IEE to boot:

```env
# DATABASE_URL — uses the NATIVE Windows Postgres on the host.
# Inside containers `localhost` means the container itself, so we use
# host.docker.internal which Docker Desktop maps to the host. The compose
# file overrides this for the `app` and `worker` services so they always
# point at the host even if your local .env value drifts.
DATABASE_URL=postgresql://postgres:YOUR_HOST_PG_PASSWORD@host.docker.internal:5432/automation_os

# JWT secret — minimum 32 chars. Generate with: openssl rand -base64 32
JWT_SECRET=replace-me-with-a-real-32-plus-char-string

# Token encryption key — MUST be exactly 64 hex chars (32 bytes hex-encoded).
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Used by connectionTokenService to encrypt OAuth/web-login secrets.
# Common mistake: pasting a base64 value here. The schema rejects it and the
# worker crash-loops with a Zod error. Hex only, 64 chars.
TOKEN_ENCRYPTION_KEY=

# Email "from" address — required by env validation; placeholder is fine for dev
EMAIL_FROM=dev@localhost

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

> **Postgres host:** the value above uses `host.docker.internal` because the dev DB lives on native Windows Postgres, not in a container. Even if you set `localhost` here, the compose file overrides it for both `app` and `worker` services — see `docker-compose.yml`.

> **TOKEN_ENCRYPTION_KEY format:** must be 64 hex chars. Anything else (base64, shorter hex, missing entirely) makes the worker crash on boot with a Zod validation error against `server/lib/env.ts`.

> `.env` is in `.gitignore`. Never commit it. You must recreate it on each new machine.

---

## Step 5 — Verify `docker-compose.yml`

The file lives at the repo root. It defines **two** services — `app` and `worker`. The bundled `postgres` service is commented out at the top of the file (we use the native Windows Postgres via `host.docker.internal`). Key things to check:

```yaml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"   # Express API server
      - "5000:5000"   # Vite dev server (the frontend — open this in your browser)
    env_file: .env
    environment:
      DATABASE_URL: postgresql://postgres:YOUR_HOST_PG_PASSWORD@host.docker.internal:5432/automation_os
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
      - .:/app
      - /app/node_modules

  worker:
    build:
      context: .
      dockerfile: worker/Dockerfile
    restart: unless-stopped
    env_file: .env
    environment:
      DATABASE_URL: postgresql://postgres:YOUR_HOST_PG_PASSWORD@host.docker.internal:5432/automation_os
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
      - worker_sessions:${BROWSER_SESSION_DIR}

volumes:
  worker_sessions:
```

There must **not** be a top-level `version:` key (deprecated in Compose v2). The `extra_hosts` line is required on Linux/WSL2 — without it, `host.docker.internal` doesn't resolve inside the container and the app/worker can't reach Postgres.

> The `worker/Dockerfile` `COPY` list must include `server/services/connectionTokenService.ts` (transitively required by `worker/src/persistence/integrationConnections.ts`). If a fresh `docker compose build worker` fails inside the in-image `tsc --noEmit` step with `Cannot find module '../../../server/services/connectionTokenService.js'`, the COPY line is missing — add it next to the other `server/services/*.ts` COPYs.

---

## Step 6 — First boot

### 6.1 Verify the host Postgres is reachable and the DB exists

The compose stack expects an empty `automation_os` database to already exist on your Windows-host PostgreSQL (port 5432). PG16, 17, or 18 all work — the app schema is forward-compatible.

First confirm the Windows PG service is running. From PowerShell:

```powershell
Get-Service postgresql*
```

It should show `Status: Running`. If it's stopped, start it (`Start-Service postgresql-x64-<version>`) or open Services.msc and start it manually.

Then create the database. The cleanest way is to use the `psql` command-line client that ships with the Postgres installer (default location `C:\Program Files\PostgreSQL\<version>\bin\psql.exe` — add it to your PATH if you haven't):

```powershell
# Replace YOUR_HOST_PG_PASSWORD with the password you set when installing Postgres.
$env:PGPASSWORD = "YOUR_HOST_PG_PASSWORD"
psql -U postgres -h localhost -c "CREATE DATABASE automation_os;"
```

Expected output: `CREATE DATABASE`. If you get `ERROR: database "automation_os" already exists`, that's fine — keep going. Anything else (auth failure, "could not connect") means PG isn't running or the password is wrong; fix that before proceeding.

### 6.2 Install Windows Node deps and apply migrations against the host DB

You run migrations from the **Windows shell**, not from inside a container — the runner connects directly to Postgres via `localhost:5432`. This is also why Node.js 20 LTS is a hard prerequisite on Windows.

```powershell
# In PowerShell, from the Windows-side repo root (e.g. C:\Files\Projects\automation-v1)
npm install                                # one-time, downloads ~600 MB of node_modules
$env:DATABASE_URL = "postgresql://postgres:YOUR_HOST_PG_PASSWORD@localhost:5432/automation_os"
npm run migrate
```

You should see either `[migrate] up to date (N migrations applied)` (DB already current) or `[migrate] applying X migration(s):` followed by each filename.

> **Custom runner, not drizzle-kit.** `npm run migrate` invokes `scripts/migrate.ts`, which reads `migrations/*.sql` lexically and tracks applied files in a `schema_migrations` table. Do **not** use `drizzle-kit migrate` or `drizzle-kit push` against a populated DB — both will silently no-op for files past 0040 (drizzle journal drift) and `push` will prompt to drop columns. The legacy command is still available as `npm run migrate:drizzle-legacy` if you ever need it.

> **Bootstrapping an existing DB:** if your `automation_os` database was populated *before* the custom runner existed (e.g. restored from a dump), the runner will see zero rows in `schema_migrations` and try to re-apply every file. The first re-apply will fail on `column already exists`. Resolve by inserting the already-applied filenames manually:
> ```sql
> CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
> -- Then insert each filename you've already applied, e.g.:
> INSERT INTO schema_migrations (filename) SELECT name FROM (VALUES ('0000_wandering_firedrake.sql'),('0001_system_settings.sql'), ...) AS t(name) ON CONFLICT DO NOTHING;
> ```
> A fresh-create DB doesn't need this — `npm run migrate` will apply everything from `0000` cleanly.

### 6.3 Build and start the containers

```bash
cd ~/automation-os
docker compose up -d --build
```

First build downloads the Playwright base image (~1.5 GB). Expect 5–10 minutes on a typical connection. Subsequent starts are <30 s.

> **First-build expectations:** high CPU and RAM usage (close to your Docker Desktop allocation) is normal during the initial build. Settles within a minute.

Tail the logs:

```bash
docker compose logs -f app worker
```

You should see, in order:
1. `app` — `[SERVER] Automation OS running on port 3000 (development)` and Vite ready on `5000`
2. `worker` — `{"msg":"iee.worker.started", ...}` (single JSON line, no preceding `iee.worker.fatal` errors)

If the worker is crash-looping with a `Zod` error citing `TOKEN_ENCRYPTION_KEY`, your key is the wrong format. See Step 4.

If the worker is crash-looping with `Failed query: update "iee_runs" ...`, you missed the migrations step (Step 6.2) — the DB is missing the `iee_runs` table or columns the worker depends on.

---

## Step 7 — Verification

Run all of the following. Each must pass before you start using the environment.

### 7.0 60-second sanity check

If you only have a minute, run this one command — it confirms the worker is alive and connected:

```bash
docker compose logs worker | tail -n 50
```

You should see a JSON line containing `"msg":"iee.worker.started"`. If you do, the worker is correctly wired to Postgres and pg-boss. If you don't, jump to Troubleshooting.

### 7.1 Both containers running

```bash
docker compose ps
```

Both `app` and `worker` services show `running` (Up). There's no `postgres` service — Postgres runs natively on the Windows host.

### 7.2 Host Postgres reachable from the container

```bash
docker compose exec app sh -c 'apt-get install -y postgresql-client >/dev/null 2>&1; psql "$DATABASE_URL" -c "select 1"'
```

Returns `1`. If it errors with "could not translate host name 'host.docker.internal'", your `docker-compose.yml` is missing the `extra_hosts: - "host.docker.internal:host-gateway"` line.

### 7.3 IEE schema present

From the Windows shell (PowerShell or your DB GUI), connect to `automation_os` and verify:

```sql
\d iee_runs       -- if using psql
-- or, in any client:
SELECT to_regclass('iee_runs'), to_regclass('iee_steps'), to_regclass('iee_artifacts');
```

All three should return a non-NULL value. If any are NULL, you missed Step 6.2 — run `npm run migrate` from Windows.

> **Drift check:** to confirm the migrations table is in sync, count it:
> ```sql
> SELECT count(*) FROM schema_migrations;
> ```
> The count should match the number of `*.sql` files in `migrations/`.

### 7.4 Worker startup line

```bash
docker compose logs worker | grep iee.worker.started
```

At least one match, JSON-formatted, including `pollIntervalMs`, `browserConcurrency`, `devConcurrency`, and `databaseHost` (which should be `host.docker.internal:5432`).

### 7.5 IEE smoke tests (when worker code lands)

These scripts ship with the worker:

```bash
# Browser end-to-end
docker compose exec worker node dist/scripts/enqueue-test-browser.js

# Dev end-to-end
docker compose exec worker node dist/scripts/enqueue-test-dev.js
```

Each writes a row to `iee_runs` with `status='completed'` and `resultSummary.success=true`.

### 7.6 Idempotency

Run the browser smoke test twice in quick succession. The second run logs `deduplicated: true` and does **not** create a second `iee_runs` row. Verify the count from any Postgres client:

```sql
SELECT count(*) FROM iee_runs;
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

- **App UI (frontend):** [http://localhost:5000](http://localhost:5000) in your Windows browser. This is the Vite dev server proxied at `/api/*` to the Express server on 3000.
- **Express API directly:** [http://localhost:3000](http://localhost:3000) — usually only useful for hitting `/api/*` from a tool like `curl` or Postman.
- **Postgres from Windows tools** (TablePlus, DBeaver): host `localhost`, port `5432`, db `automation_os`, user/password from your host PG install. Useful for inspecting `iee_runs`, `iee_steps`, `iee_artifacts`, and `schema_migrations`.

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
npm run migrate              # apply any new migrations against the host DB
docker compose up --build -d # rebuild and restart containers
```

> **Always run `npm run migrate` after a `git pull`** if any files in `migrations/` changed. The runner is idempotent — it's safe to run when there's nothing pending (it just prints `up to date`).

`.env` is **not** in Git — recreate it on each machine via Step 4. The `TOKEN_ENCRYPTION_KEY` should be the **same value** on both machines if you want encrypted secrets (OAuth tokens, web-login passwords) to remain decryptable across machines.

---

## Step 10 — Day-to-day commands

```bash
# Apply any pending migrations against the host DB
npm run migrate                          # run from Windows shell, with DATABASE_URL set

# Start everything (detached)
docker compose up -d

# Stop everything (containers + worker_sessions volume preserved)
docker compose down

# Stop and wipe the worker_sessions volume too (logs you out of every site)
docker compose down -v

# Rebuild after dependency changes
docker compose up --build -d

# Tail logs for one service
docker compose logs worker -f
docker compose logs app -f

# Restart a single service (picks up env_file changes)
docker compose restart app
docker compose restart worker

# Shell into a container
docker compose exec worker bash
docker compose exec app bash

# Postgres shell — uses the HOST Postgres, not a container
psql "postgresql://postgres:YOUR_HOST_PG_PASSWORD@localhost:5432/automation_os"

# Container resource usage (watch for OOM)
docker stats
```

> Postgres data lives in the **native Windows Postgres install** under `C:\Program Files\PostgreSQL\<version>\data` (or wherever you installed it). It is **not** in any Docker volume — `docker compose down -v` will not touch it.

> **Node version note:** you don't run Node directly on Windows for this project — everything runs inside containers. The worker container's Node version is pinned by the Playwright base image (`mcr.microsoft.com/playwright:v1.44.0-jammy` → Node 20). If you want to run any worker scripts directly on the host for debugging, install Node 20 LTS via `nvm` inside WSL2 to match.

---

## How local maps to production

| Component | Local (this guide) | Production |
|---|---|---|
| App | `app` Compose service, port 3000 (API) + 5000 (Vite) | Replit |
| Postgres + pg-boss | Native Windows install via `host.docker.internal` | Neon (managed) |
| IEE worker | `worker` Compose service | DigitalOcean VPS, Docker |
| `DATABASE_URL` (inside containers) | `postgresql://postgres:...@host.docker.internal:5432/automation_os` | Neon connection string with `?sslmode=require` |
| `BROWSER_SESSION_DIR` | `worker_sessions` named volume | VPS filesystem path (`/var/browser-sessions`) |
| Migrations | `npm run migrate` from Windows shell (host DB) | `npm run migrate` from a dev machine pointed at Neon |

When promoting to production:
1. Create a Neon project. Apply the schema once via `DATABASE_URL=<neon-url> npm run migrate` from a dev machine. Bootstrap the `schema_migrations` table first if Neon was seeded from a dump (see Step 6.2 note).
2. Set `DATABASE_URL` to the Neon URL in **both** Replit Secrets and the VPS `.env`.
3. On the VPS, clone the same repo and run `docker compose -f docker-compose.vps.yml up -d --build` (worker-only Compose file — see spec §10.5).
4. Replit's app enqueues jobs. The VPS worker consumes them. No code changes between local and production — only env values.

---

## Troubleshooting

**`Cannot connect to the Docker daemon at unix:///var/run/docker.sock` from the Ubuntu shell.**
Docker Desktop's WSL Integration is not enabled for Ubuntu. Settings → Resources → WSL Integration → toggle Ubuntu **on** → Apply & Restart.

**`worker` container restarts every few seconds with a `ZodError` on `TOKEN_ENCRYPTION_KEY`.**
The key is the wrong format. It must be exactly **64 hex chars** (32 bytes hex-encoded). Common mistake: pasting a base64 value (44 chars). Generate a valid one with:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Replace the value in `.env` and `docker compose up -d --force-recreate worker` to reload env.

**`worker` crash-loops with `Failed query: update "iee_runs" ...` before `iee.worker.started` ever appears.**
The DB schema is behind the code — `iee_runs` is missing columns (or the table is missing entirely). Run `npm run migrate` from the Windows shell. If it reports `up to date` but the error persists, your `schema_migrations` table is out of sync with reality (drift from before the custom runner). See the bootstrap note in Step 6.2.

**`worker` container build fails at `RUN npx tsc -p worker/tsconfig.json --noEmit` with `Cannot find module '../../../server/services/connectionTokenService.js'`.**
The `worker/Dockerfile` is missing `COPY server/services/connectionTokenService.ts ./server/services/connectionTokenService.ts`. Add it next to the other `server/services/*.ts` COPYs and rebuild.

**`worker` container restarts every few seconds with a generic DB error.**
`docker compose logs worker` will show the cause. Most common after the host-Postgres switch: missing `extra_hosts: - "host.docker.internal:host-gateway"` in the worker service block, or the host Postgres isn't actually running, or `DATABASE_URL` inside the container still uses `localhost` (which means *the container itself*, not the host).

**`npm run migrate` fails with `ECONNREFUSED 127.0.0.1:5432` from Windows.**
Native Windows Postgres isn't running. Start the `postgresql-x64-<version>` Windows service (Services.msc) or via `pg_ctl`.

**`npm run migrate` fails on the first migration with `column already exists`.**
Your `schema_migrations` table is empty but the schema is populated (typically because you restored from a dump). Bootstrap the tracking table by inserting all already-applied filenames before running the migrator — see the note in Step 6.2.

**Drizzle complains about journal drift, or `drizzle-kit push` wants to drop columns.**
You're using the wrong tool. **Use `npm run migrate`**, not `drizzle-kit migrate` and never `drizzle-kit push`. The drizzle journal stops at migration 0040 — everything after that is hand-written SQL applied by `scripts/migrate.ts`. The legacy command is preserved as `npm run migrate:drizzle-legacy` if you ever genuinely need it.

**Playwright fails with `Host system is missing dependencies`.**
You're running the worker outside the official Playwright base image. Confirm the worker `Dockerfile` `FROM` line matches `mcr.microsoft.com/playwright:v1.44.0-jammy`.

**`node_modules` from the host clobbers the container's node_modules.**
The Compose file uses an anonymous volume on `/app/node_modules` to prevent this. If you've edited the Compose file and removed it, restore it.

**File changes on Windows aren't picked up by the container.**
The `app` service mounts the Windows checkout (`.:/app` in compose) so HMR works directly. If your repo is inside WSL2 (`~/automation-os`), use the same compose file — Docker Desktop's WSL2 backend handles either layout. Just don't mix the two clones simultaneously (you'll end up with two `automation-v1`/`automation-os` Compose projects fighting over the same ports — see the next item).

**Two compose projects ("automation-v1" and "automation-os") both shown in Docker Desktop, both fighting for ports 3000/5000.**
You have one clone on Windows (`C:\Files\...`) and another inside WSL2 (`~/automation-os`). Pick one as the canonical workspace and `docker compose down` the other. The browser will silently talk to whichever container won the port-bind race, which makes "why isn't my edit showing up" debugging extremely confusing.

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
docker volume rm automation_os_worker_sessions
docker compose up -d
```
