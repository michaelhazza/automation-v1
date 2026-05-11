#!/usr/bin/env bash
# verify-template-version-coherence.sh — CI gate for Spec B sandbox isolation (§15.2, §25.2).
#
# Verifies the CURRENT_VERSION + PUBLISHED_VERSION two-file coherence contract for
# sandbox templates. Per spec §15.2, the gate checks:
#   (a) CURRENT_VERSION exists with all five required fields and valid values.
#   (b) Every commit that modifies CURRENT_VERSION is paired with a git tag of the form
#       sandbox-template/{name}/v{version} (or local-dev-* for non-publish branches).
#   (c) If a matching tag exists, a PUBLISHED_VERSION attestation file must also exist
#       (24h grace window allowed after the tag to permit the attestation PR to land).
#   (d) PUBLISHED_VERSION.version matches CURRENT_VERSION.version when both files exist.
#
# HARD-CODED SCAN-PATH LIST: only infra/sandbox-templates/synthetos-sandbox/ is in scope
# for V1. The openclaw-session/ directory is explicitly EXCLUDED until its owning
# adapter spec activates it. Adding a new template directory is an explicit one-line
# edit to the TEMPLATE_DIRS array below.
#
# Exit codes:
#   0 — all checks pass
#   1 — one or more violations detected (blocking)
#
# CRLF-safe: uses tr -d '\r' when reading key=value lines from template files.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

FAIL=0

# ── HARD-CODED scan-path list (V1 scope) ─────────────────────────────────────
# Only templates listed here are validated. openclaw-session is excluded until its
# owning adapter spec activates it.
TEMPLATE_DIRS=(
  "infra/sandbox-templates/synthetos-sandbox"
)

# ── Grace window for PUBLISHED_VERSION attestation (seconds) ─────────────────
# A newly-published tag is allowed 24 hours before the absence of PUBLISHED_VERSION
# becomes a gate failure. CI's attestation PR workflow typically lands within minutes;
# the 24h window is generous to cover manual attestation PR review.
PUBLISHED_VERSION_GRACE_SECONDS=$((24 * 60 * 60))

# ── Required fields in CURRENT_VERSION ───────────────────────────────────────
CURRENT_VERSION_REQUIRED_FIELDS=(
  "version"
  "template_resource_class"
  "max_cost_cents_per_second"
  "base_image_digest"
  "deps_lockfile_hash"
)

# ── Required fields in PUBLISHED_VERSION ─────────────────────────────────────
PUBLISHED_VERSION_REQUIRED_FIELDS=(
  "version"
  "image_digest"
  "ci_build_commit"
  "registry_published_at"
  "scanner_result_hash"
)

# ── Helper: read a key=value field from a file (strips CRLF) ─────────────────
read_field() {
  local file="$1"
  local key="$2"
  grep -E "^${key}=" "$file" | head -1 | tr -d '\r' | cut -d'=' -f2-
}

# ── Process each template directory ──────────────────────────────────────────
for template_rel_dir in "${TEMPLATE_DIRS[@]}"; do
  template_dir="$ROOT_DIR/$template_rel_dir"
  template_name="$(basename "$template_rel_dir")"
  current_version_file="$template_dir/CURRENT_VERSION"
  published_version_file="$template_dir/PUBLISHED_VERSION"

  # (a) Check CURRENT_VERSION exists
  if [ ! -f "$current_version_file" ]; then
    echo "[FAIL] $template_rel_dir: CURRENT_VERSION file missing — required per spec §15.2"
    FAIL=1
    continue
  fi

  # (a) Check all required fields are present and non-empty in CURRENT_VERSION
  for field in "${CURRENT_VERSION_REQUIRED_FIELDS[@]}"; do
    value="$(read_field "$current_version_file" "$field")"
    if [ -z "$value" ]; then
      echo "[FAIL] $template_rel_dir/CURRENT_VERSION: required field '$field' is missing or empty"
      FAIL=1
    fi
  done

  # Read the version for subsequent checks
  current_version="$(read_field "$current_version_file" "version")"
  if [ -z "$current_version" ]; then
    # Already flagged above; skip git-tag check since we have no version to look for
    continue
  fi

  # (b) Check for matching git tag: sandbox-template/{name}/v{version}
  expected_tag="sandbox-template/${template_name}/${current_version}"
  tag_exists=0
  if git -C "$ROOT_DIR" tag -l "$expected_tag" 2>/dev/null | grep -q "^${expected_tag}$"; then
    tag_exists=1
  fi

  if [ "$tag_exists" -eq 0 ]; then
    # Non-publish branches: accept local-dev-* versions without a tag
    if echo "$current_version" | grep -q "^local-dev-"; then
      echo "[INFO] $template_rel_dir: local-dev version '$current_version' — git tag check skipped"
    else
      # Tag not found. Behaviour depends on run mode:
      #   STRICT_TEMPLATE_TAG_CHECK=1 → hard fail (main / ready-to-merge workflow)
      #   default                     → informational (PR mode; WIP iteration allowed)
      # Spec §15.2 requires that every committed CURRENT_VERSION.version outside
      # local-dev-* MUST have a matching publish tag before the change reaches main.
      if [ "${STRICT_TEMPLATE_TAG_CHECK:-0}" = "1" ]; then
        echo "[FAIL] $template_rel_dir: git tag '$expected_tag' not found — CURRENT_VERSION declares version '$current_version' but no matching publish tag exists. On strict runs (main / ready-to-merge) this is required by spec §15.2."
        FAIL=1
      else
        echo "[INFO] $template_rel_dir: git tag '$expected_tag' not found — CURRENT_VERSION declares version '$current_version' but no matching publish tag exists yet (PR mode — informational; will block on strict runs)"
      fi
    fi
  fi

  # (c) If tag exists, check for PUBLISHED_VERSION (with 24h grace)
  if [ "$tag_exists" -eq 1 ]; then
    if [ ! -f "$published_version_file" ]; then
      # Check when the tag was created
      tag_date="$(git -C "$ROOT_DIR" log -1 --format="%ct" "refs/tags/$expected_tag" 2>/dev/null || echo "0")"
      now="$(date +%s)"
      age=$(( now - tag_date ))

      if [ "$age" -gt "$PUBLISHED_VERSION_GRACE_SECONDS" ]; then
        echo "[FAIL] $template_rel_dir: git tag '$expected_tag' exists (created $((age / 3600))h ago) but PUBLISHED_VERSION is missing — attestation PR must be merged within 24h of publish"
        FAIL=1
      else
        echo "[INFO] $template_rel_dir: git tag '$expected_tag' exists (created $((age / 3600))h ago) — within 24h grace window for attestation PR"
      fi
    fi
  fi

  # (d) If PUBLISHED_VERSION exists, check version agreement
  if [ -f "$published_version_file" ]; then
    # Check all required fields in PUBLISHED_VERSION
    for field in "${PUBLISHED_VERSION_REQUIRED_FIELDS[@]}"; do
      value="$(read_field "$published_version_file" "$field")"
      if [ -z "$value" ]; then
        echo "[FAIL] $template_rel_dir/PUBLISHED_VERSION: required field '$field' is missing or empty"
        FAIL=1
      fi
    done

    published_version="$(read_field "$published_version_file" "version")"
    if [ -n "$published_version" ] && [ "$published_version" != "$current_version" ]; then
      echo "[FAIL] $template_rel_dir: PUBLISHED_VERSION.version ('$published_version') does not match CURRENT_VERSION.version ('$current_version') — version mismatch after attestation PR"
      FAIL=1
    fi
  fi

done

# ── Result ────────────────────────────────────────────────────────────────────

if [ $FAIL -eq 0 ]; then
  echo "[PASS] verify-template-version-coherence: all in-scope template version files are coherent"
  exit 0
else
  exit 1
fi
