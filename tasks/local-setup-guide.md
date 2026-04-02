# Local Development Setup Guide — VS Code + Claude Code

This guide walks you through setting up AutomationOS on your local Windows machine with VS Code and Claude Code, so you can run agents from within the app using your Claude Max plan.

---

## Prerequisites

You need these installed on your Windows machine:

| Tool | Purpose | Install |
|------|---------|---------|
| **Node.js 20+** | Runtime | https://nodejs.org (LTS version) |
| **PostgreSQL 15+** | Database | https://www.postgresql.org/download/windows/ |
| **Git** | Version control | https://git-scm.com/download/win |
| **VS Code** | Editor | https://code.visualstudio.com |

---

## Step 1 — Install VS Code

1. Download from https://code.visualstudio.com
2. Run the installer — accept all defaults
3. On the "Select Additional Tasks" screen, tick **"Add to PATH"**
4. Open VS Code after install

---

## Step 2 — Install Claude Code Extension

1. Open VS Code
2. Click the **Extensions** icon in the left sidebar (or press `Ctrl+Shift+X`)
3. Search for **"Claude Code"** by Anthropic
4. Click **Install**
5. After install, you'll see a Claude icon in the left sidebar
6. Click it and sign in with your **Claude Max plan** account
7. Follow the OAuth prompts in your browser

> This authenticates both the extension AND the `claude` CLI on your machine.

### Verify CLI is working

Open a new terminal in VS Code (`Ctrl+`\`) and run:

```bash
claude --version
```

You should see something like `2.1.89 (Claude Code)`. If not, you may need to restart VS Code.

---

## Step 3 — Install PostgreSQL

1. Download from https://www.postgresql.org/download/windows/
2. Run the installer — set a password for the `postgres` user (remember this!)
3. Keep the default port `5432`
4. After install, open **pgAdmin** (installed with PostgreSQL) or use the terminal
5. Create the database:

```bash
# Open a terminal in VS Code and run:
psql -U postgres
```

```sql
CREATE DATABASE automation_os;
\q
```

---

## Step 4 — Clone the Repository

In VS Code terminal:

```bash
cd C:\Users\YourName\Projects
git clone https://github.com/michaelhazza/automation-v1.git
cd automation-v1
```

Then open the folder in VS Code: **File → Open Folder → select `automation-v1`**

---

## Step 5 — Install Dependencies

```bash
npm install
```

This installs all Node.js packages (React, Express, Drizzle, etc.)

---

## Step 6 — Configure Environment

1. Copy the example env file:

```bash
cp .env.example .env
```

2. Open `.env` in VS Code and fill in the **required** values:

```env
# REQUIRED — your PostgreSQL connection
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/automation_os

# REQUIRED — generate a secret (run this in terminal):
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
JWT_SECRET=paste-the-output-here

# REQUIRED — can be any email for local dev
EMAIL_FROM=dev@localhost

# Optional but recommended for local dev
PORT=3000
NODE_ENV=development
```

Everything else is optional for local development. Email sending, file storage, etc. will gracefully degrade.

---

## Step 7 — Run Database Migrations

```bash
npm run migrate
```

This creates all the tables in your PostgreSQL database.

---

## Step 8 — Seed the System Agents

```bash
npx tsx scripts/seed-local.ts
```

This loads:
- The system organisation
- Your admin user
- The 4 system agents (Orchestrator, BA, Dev, QA)
- Skills and team template

**Safe to re-run** — it skips existing records and updates agents.

---

## Step 9 — Start the App

```bash
npm run dev
```

This starts both the backend (port 3000) and frontend (port 5173) concurrently.

Open your browser to: **http://localhost:5173**

Log in with the credentials from the seed script output.

---

## Step 10 — Configure Your Subaccount for Agent Execution

Once logged in:

### 10a. Set up Dev Execution Context

1. Navigate to your subaccount (e.g. Synthetos)
2. Click **Manage** in the left nav
3. Go to the **Admin** tab
4. Scroll down to **Dev Execution Context**
5. Fill in:

| Field | Value |
|-------|-------|
| Project Root | `C:\Users\YourName\Projects\automation-v1` (or wherever you cloned it) |
| Test Command | `npm test` |
| Build Command | `npm run build` |
| Runtime | `node@20` |
| Package Manager | `npm` |
| Repo Owner | `michaelhazza` |
| Repo Name | `automation-v1` |
| Default Branch | `main` |

6. Click **Save Dev Context**

### 10b. Link Agents

1. Go to the **Agents** tab
2. Click **Load Team Template** → Apply the "Product Development" template
3. Or manually click **+ Link Agent** to link individual agents

### 10c. Run an Agent

1. On the **Agents** tab, find a linked agent (e.g. QA)
2. Click **Run (Claude Code)** — this uses your Max plan, zero API cost
3. The agent runs, and results appear in the run history
4. Click any run to see the full summary, tokens used, and duration

---

## How It Works

```
You click "Run (Claude Code)" in the app
        ↓
Backend spawns: claude -p "[agent system prompt + task]" --output-format json
        ↓
Claude Code CLI runs on your machine using your Max plan
        ↓
It explores the codebase, writes tests, runs commands
        ↓
JSON result captured by backend → stored in agent_runs table
        ↓
Results shown in the Agents tab run history
```

The **Run (API)** button uses the Anthropic API instead (costs money). Use **Run (Claude Code)** for development.

---

## Troubleshooting

### "Claude Code Not Found" badge on Agents tab

The `claude` CLI isn't on your PATH. Fix:

```bash
# Check if it's installed
claude --version

# If not, install it globally
npm install -g @anthropic-ai/claude-code

# Then sign in
claude auth login
```

Restart VS Code after installing.

### Database connection error

Check your `.env` file — make sure `DATABASE_URL` matches your PostgreSQL setup:

```
DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/automation_os
```

### Port already in use

Change the port in `.env`:

```
PORT=3001
```

### Migrations fail

Make sure PostgreSQL is running:

```bash
# Windows — check if the service is running
pg_isready
```

### Agent run hangs

Check the Claude Code timeout in Dev Execution Context. Default is 10 minutes. For long-running QA tasks, increase it.

---

## What's Next

- **Create tasks on your board** — agents can pick up and work on them
- **Iterate on agent prompts** — edit `companies/automation-os/agents/*/AGENTS.md` and re-run seed
- **When ready for production** — swap `claudeCodeRunner.ts` for Docker-based execution
- **View run traces** — navigate to `/admin/subaccounts/:id/runs/:runId` for detailed execution logs
