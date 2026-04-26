#!/usr/bin/env bash
set -euo pipefail

# Validates file upload and cloud storage readiness for Automation OS

classify_and_exit() {
  local severity=$1
  local message=$2
  case $severity in
    OK|PASS) echo "$message"; echo "[GATE] file-upload-readiness: violations=0"; exit 0 ;;
    BLOCKING) echo "[BLOCKING] $message"; echo "[GATE] file-upload-readiness: violations=1"; exit 1 ;;
    WARNING|WARN) echo "[WARNING] $message"; echo "[GATE] file-upload-readiness: violations=0"; exit 2 ;;
    INFO) echo "[INFO] $message"; echo "[GATE] file-upload-readiness: violations=0"; exit 3 ;;
    *) echo "[ERROR] Unknown severity: $severity"; echo "[GATE] file-upload-readiness: violations=1"; exit 1 ;;
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
