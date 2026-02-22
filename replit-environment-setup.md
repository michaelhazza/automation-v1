# Replit Environment Setup - Unified Pipeline

## Version Reference
- **This Document**: replit-environment-setup-unified.md v17
- **Linked Documents**:
  - spec-generator-unified.md
  - master-build-prompt-unified.md

## VERSION HISTORY

| Version | Date | Changes |
|---------|------|---------|
| 17 | 2026-02 | **Cross-framework consistency audit (1 fix)**: (1) **`authRequired` phantom field replaced with `authentication` field**: Phase 2 Secrets section referenced `authRequired endpoints` but spec-generator produces `authentication: "required" | "optional" | "public"`. Updated to match actual schema. |
| 16 | 2026-02 | **Cross-framework consistency audit (2 fixes)**: (1) **docs/gate-splitter.sh added to REQUIRED artifact array**: Pre-flight check (Step 0.1) validated 9 artifacts but the spec-generator produces 10. docs/gate-splitter.sh (artifact #7) was absent, meaning the pre-flight check would pass even when the gate extraction utility was missing, causing a silent failure at Step 4.1. Array now checks all 10 artifacts in OUTPUT MANIFEST order. (2) **Step 4.1 gate extraction updated to use docs/gate-splitter.sh**: Previously instructed to run scripts/extract-gate-scripts.sh (a Phase 2 generated script). Now consistent with how QA scripts are extracted: invoke the pre-built splitter directly from docs/. Eliminates dependency on Phase 2 having generated an extractor.
| 15 | 2026-02 | **Production hardening clarifications**: Added npm alternatives note for test runners to align with master-build-prompt references. Added single-port mode clarification in ports configuration to prevent dual-server vs unified-server confusion. Non-functional improvements for operator clarity. |
| 14 | 2026-02 | **Simplified Replit Setup**: Reduced setup complexity. Removed spec-freeze hashing, dynamic port derivation, and prescriptive config generation. Kept a minimal, reliable Replit checklist: validate docs/ artifacts exist, install deps, create .replit and replit.nix, set Secrets, run db generate and migrate, extract scripts, run gates and QA, build and start. Designed to match master-build-prompt-unified Phase 2 defaults with minimal moving parts. |
| 13 | 2026-02 | Freeze-ready hardening and spec-driven configuration alignment. |
| 12 | 2026-02 | Unified pipeline alignment and terminology updates. |
| 11 | 2026-02 | env-manifest v2 parsing support with backward compatibility. |
| 10 | 2026-02 | Pre-build review fix for artifact prerequisites. |

---

## PURPOSE

This document is NOT part of the Claude Code build pipeline.

Run this inside Replit after you have imported the generated repository (post-GitHub import) to configure the environment and confirm the app runs.

**Execution context:** Replit AI agent (not Claude Code)  
**When to run:** After code exists in the Replit project  
**Target Environment:** React 18 + Vite, Express.js/TypeScript, PostgreSQL

---

## PRINCIPLE

Keep this simple.

The build prompt already produces a working repo with deterministic scripts. The Replit setup should only:
- confirm required specs exist
- set minimal Replit config
- set Secrets
- run install, database, gates, QA, build

---

## PHASE 0: QUICK VALIDATION

### Step 0.1: Confirm required docs/ artifacts exist

These MUST exist before you do anything else:

```bash
ls -la docs || exit 1

REQUIRED=(
  "docs/scope-manifest.json"
  "docs/env-manifest.json"
  "docs/data-relationships.json"
  "docs/service-contracts.json"
  "docs/ui-api-deps.json"
  "docs/architecture-notes.md"
  "docs/gate-scripts-reference.md"
  "docs/gate-splitter.sh"
  "docs/qa-scripts-reference.md"
  "docs/qa-splitter.sh"
)

MISSING=0
for f in "${REQUIRED[@]}"; do
  if [ -f "$f" ]; then
    echo "[OK] $f"
  else
    echo "[X] MISSING: $f"
    MISSING=$((MISSING+1))
  fi
done

if [ "$MISSING" -gt 0 ]; then
  echo "ERROR: Missing $MISSING required docs/ artifact(s)."
  exit 1
fi
```

### Step 0.2: Confirm JSON is valid

```bash
for f in docs/scope-manifest.json docs/env-manifest.json docs/data-relationships.json docs/service-contracts.json docs/ui-api-deps.json; do
  jq empty "$f" >/dev/null || { echo "ERROR: Invalid JSON in $f"; exit 1; }
done
echo "[OK] JSON validated"
```

---

## PHASE 1: MINIMAL REPLIT CONFIG

### Step 1.1: Create .replit

This uses the defaults assumed in the master build prompt:
- Dev: npm run dev
- Build: npm run build
- Start: npm start
- Backend port: 5000 unless PORT is set

```toml
run = "npm run dev"
entrypoint = "server/index.ts"

[deployment]
run = ["sh", "-c", "npm start"]
build = ["sh", "-c", "npm run build"]

[[ports]]
localPort = 5000
externalPort = 80

[[ports]]
localPort = 5173
externalPort = 8080

[env]
NODE_ENV = "development"
```

**Note:** The dual-port configuration above (5000 + 5173) supports separate Vite dev server and backend during development. Many generated apps serve both SPA and API on PORT only (typically 5000) - if yours does, the 5173 mapping won't be used. Check your vite.config.ts to confirm setup.

If your generated app uses a different backend port, set `PORT` in Replit Secrets and update `localPort` above to match.

### Step 1.2: Create replit.nix

```nix
{ pkgs }: {
  deps = [
    pkgs.nodejs_20
    pkgs.nodePackages.typescript-language-server
    pkgs.postgresql
  ];
}
```

---

## PHASE 2: SET SECRETS

Open Replit Secrets and set variables based on docs/env-manifest.json.

Minimum common set:
- DATABASE_URL
- APP_URL (use your Replit public URL)
- PORT (optional, defaults to 5000)
- Any other required variables listed in env-manifest

If your service-contracts.json includes endpoints with `"authentication": "required"`, you will also need:
- JWT_SECRET (and any other auth secrets in env-manifest)

Do not hardcode secrets in files.

---

## PHASE 3: INSTALL AND DATABASE

### Step 3.1: Install dependencies

```bash
npm install
```

### Step 3.2: Generate and run migrations

This assumes the generated repo includes scripts aligned with the build prompt.

```bash
npm run db:generate
npm run migrate
```

If your repo uses different script names, run:
```bash
cat package.json | jq '.scripts'
```
Then run the matching migrate script.

---

## PHASE 4: EXTRACT SCRIPTS AND RUN TESTS

### Step 4.1: Extract gate scripts

The gate splitter is provided as docs/gate-splitter.sh (a spec-generator artifact).

```bash
bash docs/gate-splitter.sh
```

### Step 4.2: Extract QA scripts (qa-splitter)

```bash
bash docs/qa-splitter.sh
```

### Step 4.3: Run gates and QA

```bash
bash scripts/run-all-gates.sh
bash scripts/run-all-qa-tests.sh
```

**Note:** If your generated repo wires npm scripts to these runners, you can alternatively use:
```bash
npm run test:gates
npm run test:qa
```

---

## PHASE 5: BUILD AND RUN

### Step 5.1: Build

```bash
npm run build
```

### Step 5.2: Start

```bash
npm start
```

### Step 5.3: Quick health check

```bash
curl -s http://127.0.0.1:${PORT:-5000}/health || true
```

---

## TROUBLESHOOTING (MINIMAL)

### Database connection fails
- Ensure DATABASE_URL is set in Secrets
- Ensure it matches the driver expected by the generated code
- Re-run migrations: npm run migrate

### Vite API proxy issues
- Confirm your vite.config.ts proxies /api to backend port 5000 (or your PORT)
- Confirm backend is running and /health works

### Gates fail
- Open the failing script output
- The gate scripts are authoritative for what is wrong
- Fix by regenerating from specs, not by manual edits, unless you are in a local debugging loop

---

## PROMPT HYGIENE GATE

- [OK] Version Reference block present
- [OK] No dependency version pins outside Version Reference and VERSION HISTORY
- [OK] Australian English
- [OK] ASCII only
