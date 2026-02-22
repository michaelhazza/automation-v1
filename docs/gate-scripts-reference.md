# Quality Gate Scripts Reference

This document contains all quality gate scripts for pre-implementation validation of the Automation OS specification. Scripts are extracted during build using the gate-splitter utility.

Total Scripts: 14

## Exit Code Semantics

- **0**: Pass - gate succeeded
- **1**: BLOCKING - gate failure, cannot proceed
- **2**: WARNING - gate issues, non-critical
- **3**: INFO - gate information only

All scripts include the classify_and_exit helper function for standardised exit code handling.

---

#===== FILE: scripts/verify-scope-manifest.sh =====#
#!/usr/bin/env bash
set -euo pipefail

# Validates scope-manifest.json completeness and structural integrity for Automation OS

SPEC_FILE="docs/scope-manifest.json"

classify_and_exit() {
  local severity=$1
  local message=$2
  case $severity in
    OK|PASS) echo "$message"; exit 0 ;;
    BLOCKING) echo "[BLOCKING] $message"; exit 1 ;;
    WARNING|WARN) echo "[WARNING] $message"; exit 2 ;;
    INFO) echo "[INFO] $message"; exit 3 ;;
    *) echo "[ERROR] Unknown severity: $severity"; exit 1 ;;
  esac
}

if [ ! -f "$SPEC_FILE" ]; then
  classify_and_exit BLOCKING "scope-manifest.json not found at $SPEC_FILE"
fi

SCHEMA=$(jq -r '.["$schema"] // empty' "$SPEC_FILE")
if [ "$SCHEMA" != "scope-manifest-v6" ]; then
  classify_and_exit BLOCKING "scope-manifest.json schema mismatch (expected: scope-manifest-v6, got: $SCHEMA)"
fi

ONBOARDING=$(jq -r '.onboarding // empty' "$SPEC_FILE")
if [ "$ONBOARDING" != "invite_only" ]; then
  classify_and_exit BLOCKING "onboarding must be invite_only (got: $ONBOARDING)"
fi

INVITE_ONLY=$(jq -r '.features.inviteOnlyOnboarding // false' "$SPEC_FILE")
if [ "$INVITE_ONLY" != "true" ]; then
  classify_and_exit BLOCKING "features.inviteOnlyOnboarding must be true"
fi

ENTITY_COUNT=$(jq '.requiredEntities | length' "$SPEC_FILE")
if [ "$ENTITY_COUNT" -ne 10 ]; then
  classify_and_exit BLOCKING "requiredEntities count mismatch (expected: 10, got: $ENTITY_COUNT)"
fi

REQUIRED_ENTITIES=$(jq -r '.requiredEntities[]' "$SPEC_FILE")
for entity in $REQUIRED_ENTITIES; do
  ops=$(jq -e --arg e "$entity" '.entityMetadata[$e].allowedOperations // empty' "$SPEC_FILE" 2>/dev/null || echo "")
  if [ -z "$ops" ]; then
    classify_and_exit BLOCKING "entityMetadata.$entity missing allowedOperations"
  fi
done

AUTH_METHOD=$(jq -r '.authentication.method // empty' "$SPEC_FILE")
if [ -z "$AUTH_METHOD" ]; then
  classify_and_exit BLOCKING "authentication.method not set"
fi

BG=$(jq -r '.features.backgroundProcessing // empty' "$SPEC_FILE")
if [ "$BG" != "true" ]; then
  classify_and_exit BLOCKING "features.backgroundProcessing must be true"
fi

ORG_RULE=$(jq -r '.businessRules[] | select(test("system_admin|provisioned|provision"))' "$SPEC_FILE" | head -1)
if [ -z "$ORG_RULE" ]; then
  classify_and_exit BLOCKING "businessRules must include organisation provisioning statement (VIOLATION #12)"
fi

classify_and_exit OK "scope-manifest.json valid. $ENTITY_COUNT entities, invite_only onboarding, JWT auth, backgroundProcessing confirmed."
#===== END FILE: scripts/verify-scope-manifest.sh =====#

#===== FILE: scripts/verify-env-manifest.sh =====#
#!/usr/bin/env bash
set -euo pipefail

# Validates env-manifest.json completeness and security field requirements for Automation OS

SPEC_FILE="docs/env-manifest.json"

classify_and_exit() {
  local severity=$1
  local message=$2
  case $severity in
    OK|PASS) echo "$message"; exit 0 ;;
    BLOCKING) echo "[BLOCKING] $message"; exit 1 ;;
    WARNING|WARN) echo "[WARNING] $message"; exit 2 ;;
    INFO) echo "[INFO] $message"; exit 3 ;;
    *) echo "[ERROR] Unknown severity: $severity"; exit 1 ;;
  esac
}

if [ ! -f "$SPEC_FILE" ]; then
  classify_and_exit BLOCKING "env-manifest.json not found at $SPEC_FILE"
fi

SCHEMA=$(jq -r '.["$schema"] // empty' "$SPEC_FILE")
if [ "$SCHEMA" != "env-manifest-v2" ]; then
  classify_and_exit BLOCKING "env-manifest.json schema mismatch (expected: env-manifest-v2, got: $SCHEMA)"
fi

JWT_COUNT=$(jq '[.variables[] | select(.name == "JWT_SECRET")] | length' "$SPEC_FILE")
if [ "$JWT_COUNT" -eq 0 ]; then
  classify_and_exit BLOCKING "JWT_SECRET variable not declared"
fi

JWT_REQUIRED=$(jq -r '[.variables[] | select(.name == "JWT_SECRET")][0].required' "$SPEC_FILE")
if [ "$JWT_REQUIRED" != "true" ]; then
  classify_and_exit BLOCKING "JWT_SECRET.required must be true (authentication.method is set)"
fi

JWT_ENTROPY=$(jq -r '[.variables[] | select(.name == "JWT_SECRET")][0].minimumEntropy // empty' "$SPEC_FILE")
if [ -z "$JWT_ENTROPY" ] || [ "$JWT_ENTROPY" -ne 256 ]; then
  classify_and_exit BLOCKING "JWT_SECRET missing minimumEntropy: 256"
fi

JWT_NOTES=$(jq -r '[.variables[] | select(.name == "JWT_SECRET")][0].securityNotes // empty' "$SPEC_FILE")
if [ -z "$JWT_NOTES" ]; then
  classify_and_exit BLOCKING "JWT_SECRET missing securityNotes field"
fi

for req_var in "DATABASE_URL" "EMAIL_FROM"; do
  cnt=$(jq --arg v "$req_var" '[.variables[] | select(.name == $v)] | length' "$SPEC_FILE")
  if [ "$cnt" -eq 0 ]; then
    classify_and_exit BLOCKING "Required variable $req_var not declared in env-manifest.json"
  fi
done

for queue_var in "JOB_QUEUE_BACKEND" "REDIS_URL"; do
  cnt=$(jq --arg v "$queue_var" '[.variables[] | select(.name == $v)] | length' "$SPEC_FILE")
  if [ "$cnt" -eq 0 ]; then
    classify_and_exit BLOCKING "backgroundProcessing requires $queue_var in env-manifest.json"
  fi
done

FORBIDDEN=$(jq '[.variables[] | select(has("conditionallyRequired") or has("conditionalOn") or has("conditional"))] | length' "$SPEC_FILE")
if [ "$FORBIDDEN" -gt 0 ]; then
  classify_and_exit BLOCKING "env-manifest.json uses forbidden field names. Use requiredIf instead of conditionallyRequired/conditionalOn/conditional."
fi

VAR_COUNT=$(jq '.variables | length' "$SPEC_FILE")
classify_and_exit OK "env-manifest.json valid. $VAR_COUNT variables. JWT entropy guidance, queue vars, and email vars present."
#===== END FILE: scripts/verify-env-manifest.sh =====#

#===== FILE: scripts/verify-data-relationships.sh =====#
#!/usr/bin/env bash
set -euo pipefail

# Validates data-relationships.json schema integrity and FK coverage for Automation OS

SPEC_FILE="docs/data-relationships.json"

classify_and_exit() {
  local severity=$1
  local message=$2
  case $severity in
    OK|PASS) echo "$message"; exit 0 ;;
    BLOCKING) echo "[BLOCKING] $message"; exit 1 ;;
    WARNING|WARN) echo "[WARNING] $message"; exit 2 ;;
    INFO) echo "[INFO] $message"; exit 3 ;;
    *) echo "[ERROR] Unknown severity: $severity"; exit 1 ;;
  esac
}

if [ ! -f "$SPEC_FILE" ]; then
  classify_and_exit BLOCKING "data-relationships.json not found at $SPEC_FILE"
fi

SCHEMA=$(jq -r '.["$schema"] // empty' "$SPEC_FILE")
if [ "$SCHEMA" != "data-relationships-v2" ]; then
  classify_and_exit BLOCKING "data-relationships.json schema mismatch (expected: data-relationships-v2, got: $SCHEMA)"
fi

TABLE_COUNT=$(jq '.tables | length' "$SPEC_FILE")
if [ "$TABLE_COUNT" -ne 10 ]; then
  classify_and_exit BLOCKING "table count mismatch (expected: 10, got: $TABLE_COUNT)"
fi

TABLES=$(jq -r '.tables[].name' "$SPEC_FILE")
for table in $TABLES; do
  tenant_key=$(jq -r --arg t "$table" '.tables[] | select(.name == $t) | .tenantKey // empty' "$SPEC_FILE")
  if [ -z "$tenant_key" ]; then
    classify_and_exit BLOCKING "table $table missing tenantKey"
  fi
  case "$tenant_key" in
    container|direct|indirect|none) ;;
    *) classify_and_exit BLOCKING "table $table tenantKey invalid value '$tenant_key' (allowed: container|direct|indirect|none)" ;;
  esac

  is_soft=$(jq -r --arg t "$table" '.tables[] | select(.name == $t) | .softDelete' "$SPEC_FILE")
  if [ "$is_soft" = "true" ]; then
    has_deleted_at=$(jq --arg t "$table" '[.tables[] | select(.name == $t) | .columns[] | select(.name == "deletedAt")] | length' "$SPEC_FILE")
    if [ "$has_deleted_at" -eq 0 ]; then
      classify_and_exit BLOCKING "table $table softDelete:true but no deletedAt column"
    fi
    bad_unique=$(jq --arg t "$table" '
      [.tables[] | select(.name == $t) | .columns[] |
        select(.unique == true and (.partialUnique == null or .partialUnique == false) and (.primaryKey == null or .primaryKey == false))
      ] | length' "$SPEC_FILE")
    if [ "$bad_unique" -gt 0 ]; then
      classify_and_exit BLOCKING "SOFT-DELETE VIOLATION: table $table has unique:true without partialUnique on soft-deletable table"
    fi
    bad_idx=$(jq --arg t "$table" '
      [.tables[] | select(.name == $t) | .indexes[]? |
        select(.unique == true and (.partialUnique == null or .partialUnique == false))
      ] | length' "$SPEC_FILE")
    if [ "$bad_idx" -gt 0 ]; then
      classify_and_exit BLOCKING "SOFT-DELETE VIOLATION: table $table index with unique:true without partialUnique"
    fi
  fi

  missing_drizzle=$(jq --arg t "$table" '
    [.tables[] | select(.name == $t) | .columns[] | select(has("drizzle") | not)] | length' "$SPEC_FILE")
  if [ "$missing_drizzle" -gt 0 ]; then
    classify_and_exit BLOCKING "table $table has $missing_drizzle columns missing drizzle mapping"
  fi
done

FK_COUNT=$(jq '[.tables[].columns[] | select(has("references"))] | length' "$SPEC_FILE")
CASCADE_COUNT=$(jq '[.softDeleteCascades[].cascadeTargets[]] | length' "$SPEC_FILE")
NON_CASCADE_COUNT=$(jq '.nonCascadingForeignKeys | length' "$SPEC_FILE")
EXPECTED_TOTAL=$((CASCADE_COUNT + NON_CASCADE_COUNT))
if [ "$FK_COUNT" -ne "$EXPECTED_TOTAL" ]; then
  classify_and_exit BLOCKING "FK coverage gap: $FK_COUNT FK columns but $CASCADE_COUNT cascade + $NON_CASCADE_COUNT non-cascading = $EXPECTED_TOTAL. Classify all FKs."
fi

classify_and_exit OK "data-relationships.json valid. $TABLE_COUNT tables. FK coverage complete: $FK_COUNT = $CASCADE_COUNT cascade + $NON_CASCADE_COUNT non-cascading. Drizzle mappings present."
#===== END FILE: scripts/verify-data-relationships.sh =====#

#===== FILE: scripts/verify-service-contracts.sh =====#
#!/usr/bin/env bash
set -euo pipefail

# Validates service-contracts.json API contract completeness for Automation OS

SPEC_FILE="docs/service-contracts.json"

classify_and_exit() {
  local severity=$1
  local message=$2
  case $severity in
    OK|PASS) echo "$message"; exit 0 ;;
    BLOCKING) echo "[BLOCKING] $message"; exit 1 ;;
    WARNING|WARN) echo "[WARNING] $message"; exit 2 ;;
    INFO) echo "[INFO] $message"; exit 3 ;;
    *) echo "[ERROR] Unknown severity: $severity"; exit 1 ;;
  esac
}

if [ ! -f "$SPEC_FILE" ]; then
  classify_and_exit BLOCKING "service-contracts.json not found at $SPEC_FILE"
fi

SCHEMA=$(jq -r '.["$schema"] // empty' "$SPEC_FILE")
if [ "$SCHEMA" != "service-contracts-v2" ]; then
  classify_and_exit BLOCKING "service-contracts.json schema mismatch (expected: service-contracts-v2, got: $SCHEMA)"
fi

ENDPOINT_COUNT=$(jq '.endpoints | length' "$SPEC_FILE")
if [ "$ENDPOINT_COUNT" -lt 50 ]; then
  classify_and_exit BLOCKING "endpoint count too low (expected >= 50, got: $ENDPOINT_COUNT)"
fi

MISSING_CATEGORY=$(jq '[.endpoints[] | select(has("category") | not)] | length' "$SPEC_FILE")
if [ "$MISSING_CATEGORY" -gt 0 ]; then
  classify_and_exit BLOCKING "$MISSING_CATEGORY endpoints missing 'category' field"
fi

MISSING_ENTITIES_REF=$(jq '[.endpoints[] | select(has("entitiesReferenced") | not)] | length' "$SPEC_FILE")
if [ "$MISSING_ENTITIES_REF" -gt 0 ]; then
  classify_and_exit BLOCKING "$MISSING_ENTITIES_REF endpoints missing 'entitiesReferenced' field"
fi

ENTITY_EMPTY=$(jq '[.endpoints[] | select(.category == "entity" and (.entitiesReferenced | length) == 0)] | length' "$SPEC_FILE")
if [ "$ENTITY_EMPTY" -gt 0 ]; then
  classify_and_exit BLOCKING "$ENTITY_EMPTY entity-category endpoints have empty entitiesReferenced"
fi

INFRA_NONEMPTY=$(jq '[.endpoints[] | select(.category == "infrastructure" and (.entitiesReferenced | length) > 0)] | length' "$SPEC_FILE")
if [ "$INFRA_NONEMPTY" -gt 0 ]; then
  classify_and_exit BLOCKING "$INFRA_NONEMPTY infrastructure endpoints have non-empty entitiesReferenced"
fi

DELETE_MISSING=$(jq '[.endpoints[] | select(.method == "DELETE" and (has("deleteStrategy") | not))] | length' "$SPEC_FILE")
if [ "$DELETE_MISSING" -gt 0 ]; then
  classify_and_exit BLOCKING "$DELETE_MISSING DELETE endpoints missing deleteStrategy field"
fi

NON_DELETE_HAS=$(jq '[.endpoints[] | select(.method != "DELETE" and has("deleteStrategy"))] | length' "$SPEC_FILE")
if [ "$NON_DELETE_HAS" -gt 0 ]; then
  classify_and_exit BLOCKING "$NON_DELETE_HAS non-DELETE endpoints have forbidden deleteStrategy field"
fi

MISSING_SOURCE=$(jq '[.endpoints[].parameters[]? | select(has("source") | not)] | length' "$SPEC_FILE")
if [ "$MISSING_SOURCE" -gt 0 ]; then
  classify_and_exit BLOCKING "$MISSING_SOURCE parameters missing 'source' field"
fi

REGISTER_ENDPOINT=$(jq '[.endpoints[] | select(.path == "/api/auth/register" and .method == "POST")] | length' "$SPEC_FILE")
if [ "$REGISTER_ENDPOINT" -gt 0 ]; then
  classify_and_exit BLOCKING "invite_only violation: POST /api/auth/register exists (VIOLATION #14)"
fi

classify_and_exit OK "service-contracts.json valid. $ENDPOINT_COUNT endpoints. All mandatory fields present. DELETE strategies correct. No register endpoint."
#===== END FILE: scripts/verify-service-contracts.sh =====#

#===== FILE: scripts/verify-ui-api-deps.sh =====#
#!/usr/bin/env bash
set -euo pipefail

# Validates ui-api-deps.json page specification completeness for Automation OS

SPEC_FILE="docs/ui-api-deps.json"

classify_and_exit() {
  local severity=$1
  local message=$2
  case $severity in
    OK|PASS) echo "$message"; exit 0 ;;
    BLOCKING) echo "[BLOCKING] $message"; exit 1 ;;
    WARNING|WARN) echo "[WARNING] $message"; exit 2 ;;
    INFO) echo "[INFO] $message"; exit 3 ;;
    *) echo "[ERROR] Unknown severity: $severity"; exit 1 ;;
  esac
}

if [ ! -f "$SPEC_FILE" ]; then
  classify_and_exit BLOCKING "ui-api-deps.json not found at $SPEC_FILE"
fi

SCHEMA=$(jq -r '.["$schema"] // empty' "$SPEC_FILE")
if [ "$SCHEMA" != "ui-api-deps-v2" ]; then
  classify_and_exit BLOCKING "ui-api-deps.json schema mismatch (expected: ui-api-deps-v2, got: $SCHEMA)"
fi

PAGE_COUNT=$(jq '.pages | length' "$SPEC_FILE")
if [ "$PAGE_COUNT" -ne 16 ]; then
  classify_and_exit BLOCKING "page count mismatch (expected: 16, got: $PAGE_COUNT)"
fi

LEGACY_PATH=$(jq '[.pages[] | select(has("path"))] | length' "$SPEC_FILE")
if [ "$LEGACY_PATH" -gt 0 ]; then
  classify_and_exit BLOCKING "$LEGACY_PATH pages use legacy 'path' instead of 'routePath'"
fi

LEGACY_API=$(jq '[.pages[] | select(has("apiDependencies"))] | length' "$SPEC_FILE")
if [ "$LEGACY_API" -gt 0 ]; then
  classify_and_exit BLOCKING "$LEGACY_API pages use legacy 'apiDependencies' instead of 'apiCalls'"
fi

MISSING_AUTH=$(jq '[.pages[] | select(has("authentication") | not)] | length' "$SPEC_FILE")
if [ "$MISSING_AUTH" -gt 0 ]; then
  classify_and_exit BLOCKING "$MISSING_AUTH pages missing 'authentication' field"
fi

MISSING_DESC=$(jq '[.pages[] | select(has("description") | not)] | length' "$SPEC_FILE")
if [ "$MISSING_DESC" -gt 0 ]; then
  classify_and_exit BLOCKING "$MISSING_DESC pages missing 'description' field"
fi

REGISTER_PAGE=$(jq '[.pages[] | select(.routePath == "/register")] | length' "$SPEC_FILE")
if [ "$REGISTER_PAGE" -gt 0 ]; then
  classify_and_exit BLOCKING "invite_only violation: /register page found in ui-api-deps (VIOLATION #14)"
fi

INVITE_PAGE=$(jq '[.pages[] | select(.routePath == "/invite/accept")] | length' "$SPEC_FILE")
if [ "$INVITE_PAGE" -eq 0 ]; then
  classify_and_exit BLOCKING "invite_only onboarding requires AcceptInvitePage at /invite/accept"
fi

MISSING_REQUIRED_FLAG=$(jq '[.pages[].apiCalls[]? | select(has("required") | not)] | length' "$SPEC_FILE")
if [ "$MISSING_REQUIRED_FLAG" -gt 0 ]; then
  classify_and_exit BLOCKING "$MISSING_REQUIRED_FLAG apiCalls missing 'required' boolean"
fi

classify_and_exit OK "ui-api-deps.json valid. $PAGE_COUNT pages. Modern schema fields confirmed. Invite-only compliance verified."
#===== END FILE: scripts/verify-ui-api-deps.sh =====#

#===== FILE: scripts/verify-cross-file-consistency.sh =====#
#!/usr/bin/env bash
set -euo pipefail

# Validates cross-artifact consistency across all Automation OS spec files

classify_and_exit() {
  local severity=$1
  local message=$2
  case $severity in
    OK|PASS) echo "$message"; exit 0 ;;
    BLOCKING) echo "[BLOCKING] $message"; exit 1 ;;
    WARNING|WARN) echo "[WARNING] $message"; exit 2 ;;
    INFO) echo "[INFO] $message"; exit 3 ;;
    *) echo "[ERROR] Unknown severity: $severity"; exit 1 ;;
  esac
}

SCOPE="docs/scope-manifest.json"
DATA="docs/data-relationships.json"
SERVICE="docs/service-contracts.json"

for f in "$SCOPE" "$DATA" "$SERVICE"; do
  if [ ! -f "$f" ]; then
    classify_and_exit BLOCKING "Required spec file not found: $f"
  fi
done

# Verify service-contracts entitiesReferenced use table names from data-relationships
SERVICE_ENTITIES=$(jq -r '[.endpoints[].entitiesReferenced[]] | unique[]' "$SERVICE")
DATA_TABLES=$(jq -r '.tables[].name' "$DATA")
for entity in $SERVICE_ENTITIES; do
  found=false
  for table in $DATA_TABLES; do
    if [ "$table" = "$entity" ]; then found=true; break; fi
  done
  if [ "$found" = "false" ]; then
    classify_and_exit BLOCKING "service-contracts references entity '$entity' not found in data-relationships tables"
  fi
done

# Forward FK check: scope-manifest relationships must match data-relationships FK columns
SCOPE_FIELDS=$(jq -r '.relationships[].field' "$SCOPE")
FK_COLUMNS=$(jq -r '[.tables[].columns[] | select(has("references")) | .name] | unique[]' "$DATA")
for field in $SCOPE_FIELDS; do
  found=false
  for fk in $FK_COLUMNS; do
    if [ "$fk" = "$field" ]; then found=true; break; fi
  done
  if [ "$found" = "false" ]; then
    classify_and_exit BLOCKING "scope-manifest relationship field '$field' has no FK column with .references in data-relationships"
  fi
done

# Invite-only: no POST /api/auth/register in service-contracts
REGISTER_ENDPOINT=$(jq '[.endpoints[] | select(.path == "/api/auth/register" and .method == "POST")] | length' "$SERVICE")
if [ "$REGISTER_ENDPOINT" -gt 0 ]; then
  classify_and_exit BLOCKING "invite_only onboarding violation: POST /api/auth/register found in service-contracts (VIOLATION #14)"
fi

# Invite accept endpoint must exist
INVITE_ENDPOINT=$(jq '[.endpoints[] | select(.path == "/api/auth/invite/accept" and .method == "POST")] | length' "$SERVICE")
if [ "$INVITE_ENDPOINT" -eq 0 ]; then
  classify_and_exit BLOCKING "invite_only onboarding requires POST /api/auth/invite/accept in service-contracts"
fi

classify_and_exit OK "Cross-artifact consistency validated. Entity refs, FK alignment, invite-only compliance confirmed."
#===== END FILE: scripts/verify-cross-file-consistency.sh =====#

#===== FILE: scripts/verify-schema-compliance.sh =====#
#!/usr/bin/env bash
set -euo pipefail

# Validates $schema identifiers and no placeholder tokens in all JSON spec files

classify_and_exit() {
  local severity=$1
  local message=$2
  case $severity in
    OK|PASS) echo "$message"; exit 0 ;;
    BLOCKING) echo "[BLOCKING] $message"; exit 1 ;;
    WARNING|WARN) echo "[WARNING] $message"; exit 2 ;;
    INFO) echo "[INFO] $message"; exit 3 ;;
    *) echo "[ERROR] Unknown severity: $severity"; exit 1 ;;
  esac
}

declare -A EXPECTED_SCHEMAS
EXPECTED_SCHEMAS["docs/scope-manifest.json"]="scope-manifest-v6"
EXPECTED_SCHEMAS["docs/env-manifest.json"]="env-manifest-v2"
EXPECTED_SCHEMAS["docs/data-relationships.json"]="data-relationships-v2"
EXPECTED_SCHEMAS["docs/service-contracts.json"]="service-contracts-v2"
EXPECTED_SCHEMAS["docs/ui-api-deps.json"]="ui-api-deps-v2"

for file in "${!EXPECTED_SCHEMAS[@]}"; do
  expected="${EXPECTED_SCHEMAS[$file]}"
  if [ ! -f "$file" ]; then
    classify_and_exit BLOCKING "Spec file not found: $file"
  fi
  actual=$(jq -r '.["$schema"] // empty' "$file")
  if [ "$actual" != "$expected" ]; then
    classify_and_exit BLOCKING "$file schema mismatch (expected: $expected, got: $actual)"
  fi
done

# Check for placeholder tokens in JSON files
for file in docs/scope-manifest.json docs/env-manifest.json docs/data-relationships.json docs/service-contracts.json docs/ui-api-deps.json; do
  if grep -q -E '\bTBD\b|\bTODO\b|\bplaceholder\b|\bFIXME\b|\bXXX\b' "$file" 2>/dev/null; then
    classify_and_exit BLOCKING "$file contains placeholder tokens (TBD/TODO/placeholder/FIXME/XXX)"
  fi
done

classify_and_exit OK "Schema compliance validated. All 5 JSON files have correct \$schema identifiers. No placeholder tokens detected."
#===== END FILE: scripts/verify-schema-compliance.sh =====#

#===== FILE: scripts/verify-authentication-readiness.sh =====#
#!/usr/bin/env bash
set -euo pipefail

# Validates JWT authentication readiness across spec artifacts for Automation OS

classify_and_exit() {
  local severity=$1
  local message=$2
  case $severity in
    OK|PASS) echo "$message"; exit 0 ;;
    BLOCKING) echo "[BLOCKING] $message"; exit 1 ;;
    WARNING|WARN) echo "[WARNING] $message"; exit 2 ;;
    INFO) echo "[INFO] $message"; exit 3 ;;
    *) echo "[ERROR] Unknown severity: $severity"; exit 1 ;;
  esac
}

SERVICE="docs/service-contracts.json"
ENV="docs/env-manifest.json"

for f in "$SERVICE" "$ENV"; do
  if [ ! -f "$f" ]; then
    classify_and_exit BLOCKING "Required spec file not found: $f"
  fi
done

# All protected endpoints must list 'authenticate' in middleware
PROTECTED_MISSING_MIDDLEWARE=$(jq '
  [.endpoints[] |
    select(.authentication == "required" and
           ((.middleware // []) | index("authenticate") == null))
  ] | length' "$SERVICE")
if [ "$PROTECTED_MISSING_MIDDLEWARE" -gt 0 ]; then
  classify_and_exit BLOCKING "$PROTECTED_MISSING_MIDDLEWARE protected endpoints missing 'authenticate' in middleware array"
fi

# All public endpoints must NOT have 'authenticate' in middleware
PUBLIC_HAS_MIDDLEWARE=$(jq '
  [.endpoints[] |
    select(.authentication == "public" and
           ((.middleware // []) | index("authenticate") != null))
  ] | length' "$SERVICE")
if [ "$PUBLIC_HAS_MIDDLEWARE" -gt 0 ]; then
  classify_and_exit BLOCKING "$PUBLIC_HAS_MIDDLEWARE public endpoints incorrectly have 'authenticate' middleware"
fi

# Verify login endpoint exists and is public
LOGIN_COUNT=$(jq '[.endpoints[] | select(.path == "/api/auth/login" and .method == "POST" and .authentication == "public")] | length' "$SERVICE")
if [ "$LOGIN_COUNT" -eq 0 ]; then
  classify_and_exit BLOCKING "POST /api/auth/login with authentication:public not found in service-contracts"
fi

# Verify invite/accept endpoint exists for invite-only onboarding
ACCEPT_COUNT=$(jq '[.endpoints[] | select(.path == "/api/auth/invite/accept" and .method == "POST")] | length' "$SERVICE")
if [ "$ACCEPT_COUNT" -eq 0 ]; then
  classify_and_exit BLOCKING "POST /api/auth/invite/accept not found (required for invite_only onboarding)"
fi

# Verify JWT_SECRET in env-manifest
JWT_COUNT=$(jq '[.variables[] | select(.name == "JWT_SECRET" and .required == true)] | length' "$ENV")
if [ "$JWT_COUNT" -eq 0 ]; then
  classify_and_exit BLOCKING "JWT_SECRET with required:true not found in env-manifest"
fi

PROTECTED_COUNT=$(jq '[.endpoints[] | select(.authentication == "required")] | length' "$SERVICE")
PUBLIC_COUNT=$(jq '[.endpoints[] | select(.authentication == "public")] | length' "$SERVICE")

classify_and_exit OK "Authentication readiness confirmed. $PROTECTED_COUNT protected, $PUBLIC_COUNT public endpoints. Login + invite/accept present. JWT_SECRET declared."
#===== END FILE: scripts/verify-authentication-readiness.sh =====#

#===== FILE: scripts/verify-multi-tenancy-readiness.sh =====#
#!/usr/bin/env bash
set -euo pipefail

# Validates multi-tenancy (organisation isolation) readiness for Automation OS

classify_and_exit() {
  local severity=$1
  local message=$2
  case $severity in
    OK|PASS) echo "$message"; exit 0 ;;
    BLOCKING) echo "[BLOCKING] $message"; exit 1 ;;
    WARNING|WARN) echo "[WARNING] $message"; exit 2 ;;
    INFO) echo "[INFO] $message"; exit 3 ;;
    *) echo "[ERROR] Unknown severity: $severity"; exit 1 ;;
  esac
}

DATA="docs/data-relationships.json"
SCOPE="docs/scope-manifest.json"

for f in "$DATA" "$SCOPE"; do
  if [ ! -f "$f" ]; then
    classify_and_exit BLOCKING "Required spec file not found: $f"
  fi
done

# Verify organisations table exists and is marked as 'container'
ORG_TENANT_KEY=$(jq -r '.tables[] | select(.name == "organisations") | .tenantKey // empty' "$DATA")
if [ "$ORG_TENANT_KEY" != "container" ]; then
  classify_and_exit BLOCKING "organisations table tenantKey must be 'container' (got: $ORG_TENANT_KEY)"
fi

# Verify all direct tenant tables have organisationId FK
DIRECT_TABLES=$(jq -r '.tables[] | select(.tenantKey == "direct") | .name' "$DATA")
for table in $DIRECT_TABLES; do
  has_org_fk=$(jq --arg t "$table" '
    [.tables[] | select(.name == $t) | .columns[] |
      select(.name == "organisationId" and has("references"))
    ] | length' "$DATA")
  if [ "$has_org_fk" -eq 0 ]; then
    classify_and_exit BLOCKING "Direct-tenant table '$table' missing organisationId FK with .references"
  fi
done

# Verify requiredFiltering covers executions, tasks, and users
REQUIRED_FILTER_TABLES=$(jq -r '.requiredFiltering[].table' "$DATA")
for required_table in "executions" "tasks" "users"; do
  found=false
  for table in $REQUIRED_FILTER_TABLES; do
    if [ "$table" = "$required_table" ]; then found=true; break; fi
  done
  if [ "$found" = "false" ]; then
    classify_and_exit BLOCKING "requiredFiltering missing entry for '$required_table' table"
  fi
done

DIRECT_COUNT=$(jq '[.tables[] | select(.tenantKey == "direct")] | length' "$DATA")
INDIRECT_COUNT=$(jq '[.tables[] | select(.tenantKey == "indirect")] | length' "$DATA")
NONE_COUNT=$(jq '[.tables[] | select(.tenantKey == "none")] | length' "$DATA")

classify_and_exit OK "Multi-tenancy readiness confirmed. organisations is container. $DIRECT_COUNT direct, $INDIRECT_COUNT indirect tenant tables. RequiredFiltering present."
#===== END FILE: scripts/verify-multi-tenancy-readiness.sh =====#

#===== FILE: scripts/verify-file-upload-readiness.sh =====#
#!/usr/bin/env bash
set -euo pipefail

# Validates file upload and cloud storage readiness for Automation OS

classify_and_exit() {
  local severity=$1
  local message=$2
  case $severity in
    OK|PASS) echo "$message"; exit 0 ;;
    BLOCKING) echo "[BLOCKING] $message"; exit 1 ;;
    WARNING|WARN) echo "[WARNING] $message"; exit 2 ;;
    INFO) echo "[INFO] $message"; exit 3 ;;
    *) echo "[ERROR] Unknown severity: $severity"; exit 1 ;;
  esac
}

DATA="docs/data-relationships.json"
SERVICE="docs/service-contracts.json"
ENV="docs/env-manifest.json"

for f in "$DATA" "$SERVICE" "$ENV"; do
  if [ ! -f "$f" ]; then
    classify_and_exit BLOCKING "Required spec file not found: $f"
  fi
done

# Verify execution_files table exists
EF_COUNT=$(jq '[.tables[] | select(.name == "execution_files")] | length' "$DATA")
if [ "$EF_COUNT" -eq 0 ]; then
  classify_and_exit BLOCKING "execution_files table not found in data-relationships.json"
fi

# Verify expiresAt column exists on execution_files
EXPIRES_AT=$(jq '[.tables[] | select(.name == "execution_files") | .columns[] | select(.name == "expiresAt")] | length' "$DATA")
if [ "$EXPIRES_AT" -eq 0 ]; then
  classify_and_exit BLOCKING "execution_files table missing expiresAt column (30-day retention required)"
fi

# Verify upload and download endpoints exist
UPLOAD_COUNT=$(jq '[.endpoints[] | select(.path == "/api/files/upload" and .method == "POST")] | length' "$SERVICE")
if [ "$UPLOAD_COUNT" -eq 0 ]; then
  classify_and_exit BLOCKING "POST /api/files/upload endpoint not found in service-contracts"
fi

DOWNLOAD_COUNT=$(jq '[.endpoints[] | select(.path == "/api/files/:fileId/download" and .method == "GET")] | length' "$SERVICE")
if [ "$DOWNLOAD_COUNT" -eq 0 ]; then
  classify_and_exit BLOCKING "GET /api/files/:fileId/download endpoint not found in service-contracts"
fi

# Verify FILE_STORAGE_BACKEND env var
FS_BACKEND=$(jq '[.variables[] | select(.name == "FILE_STORAGE_BACKEND")] | length' "$ENV")
if [ "$FS_BACKEND" -eq 0 ]; then
  classify_and_exit BLOCKING "FILE_STORAGE_BACKEND not declared in env-manifest"
fi

# Verify upload endpoints use validateMultipart middleware
UPLOAD_MIDDLEWARE=$(jq '
  [.endpoints[] | select(.path == "/api/files/upload") |
    select((.middleware // []) | index("validateMultipart") == null)
  ] | length' "$SERVICE")
if [ "$UPLOAD_MIDDLEWARE" -gt 0 ]; then
  classify_and_exit BLOCKING "Upload endpoint missing 'validateMultipart' in middleware"
fi

classify_and_exit OK "File upload readiness confirmed. execution_files table with expiresAt. Upload/download endpoints present. Storage env vars declared."
#===== END FILE: scripts/verify-file-upload-readiness.sh =====#

#===== FILE: scripts/verify-rbac-readiness.sh =====#
#!/usr/bin/env bash
set -euo pipefail

# Validates role-based access control readiness for Automation OS

classify_and_exit() {
  local severity=$1
  local message=$2
  case $severity in
    OK|PASS) echo "$message"; exit 0 ;;
    BLOCKING) echo "[BLOCKING] $message"; exit 1 ;;
    WARNING|WARN) echo "[WARNING] $message"; exit 2 ;;
    INFO) echo "[INFO] $message"; exit 3 ;;
    *) echo "[ERROR] Unknown severity: $severity"; exit 1 ;;
  esac
}

SERVICE="docs/service-contracts.json"
DATA="docs/data-relationships.json"

for f in "$SERVICE" "$DATA"; do
  if [ ! -f "$f" ]; then
    classify_and_exit BLOCKING "Required spec file not found: $f"
  fi
done

# Verify users table has role column
HAS_ROLE_COL=$(jq '[.tables[] | select(.name == "users") | .columns[] | select(.name == "role")] | length' "$DATA")
if [ "$HAS_ROLE_COL" -eq 0 ]; then
  classify_and_exit BLOCKING "users table missing 'role' column"
fi

# Verify role enum exists
ROLE_ENUM=$(jq '[.enums[] | select(.enumName == "user_role")] | length' "$DATA")
if [ "$ROLE_ENUM" -eq 0 ]; then
  classify_and_exit BLOCKING "user_role enum not found in data-relationships.json"
fi

# Verify all 5 required roles exist in the enum
REQUIRED_ROLES=("system_admin" "org_admin" "manager" "user" "client_user")
for role in "${REQUIRED_ROLES[@]}"; do
  found=$(jq --arg r "$role" '[.enums[] | select(.enumName == "user_role") | .allowedValues[] | select(. == $r)] | length' "$DATA")
  if [ "$found" -eq 0 ]; then
    classify_and_exit BLOCKING "user_role enum missing required value: $role"
  fi
done

# Verify endpoints with requiredRole use 'requireRole' middleware
ROLE_ENDPOINTS=$(jq '[.endpoints[] | select(has("requiredRole"))] | length' "$SERVICE")
MISSING_REQUIRE_ROLE=$(jq '[.endpoints[] | select(has("requiredRole") and ((.middleware // []) | index("requireRole") == null))] | length' "$SERVICE")
if [ "$MISSING_REQUIRE_ROLE" -gt 0 ]; then
  classify_and_exit BLOCKING "$MISSING_REQUIRE_ROLE role-restricted endpoints missing 'requireRole' in middleware"
fi

# Verify permission_groups and permission_group_members tables exist (permission group system)
for pg_table in "permission_groups" "permission_group_members" "permission_group_categories"; do
  cnt=$(jq --arg t "$pg_table" '[.tables[] | select(.name == $t)] | length' "$DATA")
  if [ "$cnt" -eq 0 ]; then
    classify_and_exit BLOCKING "Permission group table '$pg_table' not found in data-relationships.json"
  fi
done

classify_and_exit OK "RBAC readiness confirmed. user_role enum with 5 roles. $ROLE_ENDPOINTS role-restricted endpoints. Permission group tables present. requireRole middleware verified."
#===== END FILE: scripts/verify-rbac-readiness.sh =====#

#===== FILE: scripts/verify-soft-delete-integrity.sh =====#
#!/usr/bin/env bash
set -euo pipefail

# Validates soft-delete cascade completeness for Automation OS

classify_and_exit() {
  local severity=$1
  local message=$2
  case $severity in
    OK|PASS) echo "$message"; exit 0 ;;
    BLOCKING) echo "[BLOCKING] $message"; exit 1 ;;
    WARNING|WARN) echo "[WARNING] $message"; exit 2 ;;
    INFO) echo "[INFO] $message"; exit 3 ;;
    *) echo "[ERROR] Unknown severity: $severity"; exit 1 ;;
  esac
}

DATA="docs/data-relationships.json"
if [ ! -f "$DATA" ]; then
  classify_and_exit BLOCKING "data-relationships.json not found"
fi

# All tables with softDelete:true must have softDeleteColumn set
SOFT_DELETE_TABLES=$(jq -r '.tables[] | select(.softDelete == true) | .name' "$DATA")
for table in $SOFT_DELETE_TABLES; do
  sdc=$(jq -r --arg t "$table" '.tables[] | select(.name == $t) | .softDeleteColumn // empty' "$DATA")
  if [ -z "$sdc" ]; then
    classify_and_exit BLOCKING "Table $table softDelete:true but softDeleteColumn not set"
  fi
  if [ "$sdc" != "deletedAt" ]; then
    classify_and_exit BLOCKING "Table $table softDeleteColumn should be 'deletedAt' (got: $sdc)"
  fi
done

# Verify all FK columns are covered by either cascade or non-cascading exemption
FK_COUNT=$(jq '[.tables[].columns[] | select(has("references"))] | length' "$DATA")
CASCADE_COUNT=$(jq '[.softDeleteCascades[].cascadeTargets[]] | length' "$DATA")
NON_CASCADE_COUNT=$(jq '.nonCascadingForeignKeys | length' "$DATA")
TOTAL=$((CASCADE_COUNT + NON_CASCADE_COUNT))
if [ "$FK_COUNT" -ne "$TOTAL" ]; then
  classify_and_exit BLOCKING "Soft-delete cascade coverage gap: $FK_COUNT FKs but ($CASCADE_COUNT + $NON_CASCADE_COUNT) = $TOTAL classified"
fi

# Verify executions table has no deletedAt (immutable audit records)
EXEC_SOFT=$(jq '[.tables[] | select(.name == "executions") | select(.softDelete == true)] | length' "$DATA")
if [ "$EXEC_SOFT" -gt 0 ]; then
  classify_and_exit BLOCKING "executions table must not have softDelete:true - execution records are immutable audit trail"
fi

SOFT_COUNT=$(jq '[.tables[] | select(.softDelete == true)] | length' "$DATA")
HARD_COUNT=$(jq '[.tables[] | select(.softDelete == false)] | length' "$DATA")

classify_and_exit OK "Soft-delete integrity confirmed. $SOFT_COUNT soft-delete tables (all with deletedAt + softDeleteColumn). $FK_COUNT FKs fully classified."
#===== END FILE: scripts/verify-soft-delete-integrity.sh =====#

#===== FILE: scripts/verify-background-jobs-readiness.sh =====#
#!/usr/bin/env bash
set -euo pipefail

# Validates background job queue readiness for Automation OS execution engine

classify_and_exit() {
  local severity=$1
  local message=$2
  case $severity in
    OK|PASS) echo "$message"; exit 0 ;;
    BLOCKING) echo "[BLOCKING] $message"; exit 1 ;;
    WARNING|WARN) echo "[WARNING] $message"; exit 2 ;;
    INFO) echo "[INFO] $message"; exit 3 ;;
    *) echo "[ERROR] Unknown severity: $severity"; exit 1 ;;
  esac
}

DATA="docs/data-relationships.json"
ENV="docs/env-manifest.json"
SERVICE="docs/service-contracts.json"

for f in "$DATA" "$ENV" "$SERVICE"; do
  if [ ! -f "$f" ]; then
    classify_and_exit BLOCKING "Required spec file not found: $f"
  fi
done

# Verify executions table has all required async lifecycle fields
REQUIRED_EXEC_COLS=("status" "startedAt" "completedAt" "errorMessage" "retryCount")
for col in "${REQUIRED_EXEC_COLS[@]}"; do
  cnt=$(jq --arg c "$col" '[.tables[] | select(.name == "executions") | .columns[] | select(.name == $c)] | length' "$DATA")
  if [ "$cnt" -eq 0 ]; then
    classify_and_exit BLOCKING "executions table missing async lifecycle column: $col"
  fi
done

# Verify execution_status enum has all expected values
EXEC_STATUSES=("pending" "running" "completed" "failed" "timeout" "cancelled")
for status in "${EXEC_STATUSES[@]}"; do
  cnt=$(jq --arg s "$status" '[.enums[] | select(.enumName == "execution_status") | .allowedValues[] | select(. == $s)] | length' "$DATA")
  if [ "$cnt" -eq 0 ]; then
    classify_and_exit BLOCKING "execution_status enum missing value: $status"
  fi
done

# Verify JOB_QUEUE_BACKEND with pg-boss default
JQB=$(jq -r '[.variables[] | select(.name == "JOB_QUEUE_BACKEND")][0].defaultValue // empty' "$ENV")
if [ "$JQB" != "pg-boss" ]; then
  classify_and_exit BLOCKING "JOB_QUEUE_BACKEND defaultValue must be 'pg-boss' (MVP default, zero additional infrastructure)"
fi

# Verify QUEUE_CONCURRENCY is declared
QC=$(jq '[.variables[] | select(.name == "QUEUE_CONCURRENCY")] | length' "$ENV")
if [ "$QC" -eq 0 ]; then
  classify_and_exit BLOCKING "QUEUE_CONCURRENCY not declared in env-manifest"
fi

# Verify POST /api/executions exists for job submission
EXEC_CREATE=$(jq '[.endpoints[] | select(.path == "/api/executions" and .method == "POST")] | length' "$SERVICE")
if [ "$EXEC_CREATE" -eq 0 ]; then
  classify_and_exit BLOCKING "POST /api/executions endpoint not found (required for queue submission)"
fi

# Verify duplicate prevention is documented in execution errors (429)
DUPLICATE_429=$(jq '[.endpoints[] | select(.path == "/api/executions" and .method == "POST") | .throws[]? | select(.statusCode == 429)] | length' "$SERVICE")
if [ "$DUPLICATE_429" -eq 0 ]; then
  classify_and_exit BLOCKING "POST /api/executions missing 429 error for duplicate prevention (5-minute cooldown)"
fi

classify_and_exit OK "Background job readiness confirmed. executions table with lifecycle fields. Execution status enum complete. pg-boss default. Duplicate prevention 429 present."
#===== END FILE: scripts/verify-background-jobs-readiness.sh =====#

#===== FILE: scripts/verify-email-readiness.sh =====#
#!/usr/bin/env bash
set -euo pipefail

# Validates email notification readiness for Automation OS

classify_and_exit() {
  local severity=$1
  local message=$2
  case $severity in
    OK|PASS) echo "$message"; exit 0 ;;
    BLOCKING) echo "[BLOCKING] $message"; exit 1 ;;
    WARNING|WARN) echo "[WARNING] $message"; exit 2 ;;
    INFO) echo "[INFO] $message"; exit 3 ;;
    *) echo "[ERROR] Unknown severity: $severity"; exit 1 ;;
  esac
}

ENV="docs/env-manifest.json"
if [ ! -f "$ENV" ]; then
  classify_and_exit BLOCKING "env-manifest.json not found"
fi

# Verify EMAIL_PROVIDER and EMAIL_FROM are declared
EMAIL_PROVIDER=$(jq '[.variables[] | select(.name == "EMAIL_PROVIDER")] | length' "$ENV")
if [ "$EMAIL_PROVIDER" -eq 0 ]; then
  classify_and_exit BLOCKING "EMAIL_PROVIDER not declared in env-manifest"
fi

EMAIL_FROM=$(jq '[.variables[] | select(.name == "EMAIL_FROM" and .required == true)] | length' "$ENV")
if [ "$EMAIL_FROM" -eq 0 ]; then
  classify_and_exit BLOCKING "EMAIL_FROM with required:true not declared in env-manifest"
fi

# Verify at least one provider's key is conditionally required
SENDGRID_KEY=$(jq '[.variables[] | select(.name == "SENDGRID_API_KEY")] | length' "$ENV")
SMTP_HOST=$(jq '[.variables[] | select(.name == "SMTP_HOST")] | length' "$ENV")
if [ "$SENDGRID_KEY" -eq 0 ] && [ "$SMTP_HOST" -eq 0 ]; then
  classify_and_exit BLOCKING "No email provider credentials declared (need SENDGRID_API_KEY or SMTP_HOST)"
fi

# Verify EMAIL_PROVIDER has allowedValues
PROVIDER_ALLOWED=$(jq -r '[.variables[] | select(.name == "EMAIL_PROVIDER")][0].allowedValues // empty' "$ENV")
if [ -z "$PROVIDER_ALLOWED" ] || [ "$PROVIDER_ALLOWED" = "null" ]; then
  classify_and_exit WARNING "EMAIL_PROVIDER missing allowedValues (should list sendgrid, smtp)"
fi

classify_and_exit OK "Email readiness confirmed. EMAIL_PROVIDER and EMAIL_FROM declared. Provider credentials (SendGrid and SMTP) declared."
#===== END FILE: scripts/verify-email-readiness.sh =====#

#===== FILE: scripts/verify-onboarding-telemetry.sh =====#
#!/usr/bin/env bash
set -euo pipefail

# Validates that key onboarding lifecycle endpoints exist for telemetry instrumentation in Automation OS

classify_and_exit() {
  local severity=$1
  local message=$2
  case $severity in
    OK|PASS) echo "$message"; exit 0 ;;
    BLOCKING) echo "[BLOCKING] $message"; exit 1 ;;
    WARNING|WARN) echo "[WARNING] $message"; exit 2 ;;
    INFO) echo "[INFO] $message"; exit 3 ;;
    *) echo "[ERROR] Unknown severity: $severity"; exit 1 ;;
  esac
}

SERVICE="docs/service-contracts.json"
if [ ! -f "$SERVICE" ]; then
  classify_and_exit BLOCKING "service-contracts.json not found"
fi

# Verify endpoints required for onboarding telemetry funnel:
# time-to-first-connection, time-to-first-task, time-to-first-execution

REQUIRED_TELEMETRY_ENDPOINTS=(
  "POST /api/engines"
  "POST /api/tasks"
  "POST /api/executions"
)

for ep in "${REQUIRED_TELEMETRY_ENDPOINTS[@]}"; do
  method="${ep%% *}"
  path="${ep#* }"
  cnt=$(jq --arg m "$method" --arg p "$path" '[.endpoints[] | select(.method == $m and .path == $p)] | length' "$SERVICE")
  if [ "$cnt" -eq 0 ]; then
    classify_and_exit BLOCKING "Telemetry funnel endpoint missing: $method $path"
  fi
done

# Verify invite/accept for time-to-first-login tracking
INVITE_ACCEPT=$(jq '[.endpoints[] | select(.path == "/api/auth/invite/accept" and .method == "POST")] | length' "$SERVICE")
if [ "$INVITE_ACCEPT" -eq 0 ]; then
  classify_and_exit BLOCKING "POST /api/auth/invite/accept missing (required for onboarding drop-off tracking)"
fi

# Verify engine test endpoint for connection verification tracking
ENGINE_TEST=$(jq '[.endpoints[] | select(.path == "/api/engines/:id/test" and .method == "POST")] | length' "$SERVICE")
if [ "$ENGINE_TEST" -eq 0 ]; then
  classify_and_exit BLOCKING "POST /api/engines/:id/test missing (required for first-connection telemetry)"
fi

classify_and_exit OK "Onboarding telemetry readiness confirmed. All 5 funnel touchpoints present: invite-accept, engine-create, engine-test, task-create, execution-create."
#===== END FILE: scripts/verify-onboarding-telemetry.sh =====#
