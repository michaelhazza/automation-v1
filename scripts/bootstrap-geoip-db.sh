#!/usr/bin/env bash
# bootstrap-geoip-db.sh
#
# Downloads the GeoLite2-City database from MaxMind at deploy time.
# Idempotent: skips if the file is present and less than 7 days old.
#
# Exit codes:
#   0 — success (downloaded or already fresh)
#   1 — download/network failure
#   2 — GEOIP_LICENCE_KEY is not set (warning; server still boots without GeoIP)

set -euo pipefail

RUNTIME_DIR="${GEOIP_RUNTIME_DIR:-/var/lib/synthetos/geoip}"
DB_FILE="${RUNTIME_DIR}/geolite2-city.mmdb"
LICENCE_KEY="${GEOIP_LICENCE_KEY:-}"
MAX_AGE_DAYS=7

if [[ -z "$LICENCE_KEY" ]]; then
  echo "WARNING: GEOIP_LICENCE_KEY is not set. Proxy alignment will skip locale/timezone resolution." >&2
  exit 2
fi

mkdir -p "$RUNTIME_DIR"

# Skip if file exists and is fresh
if [[ -f "$DB_FILE" ]]; then
  AGE_DAYS=$(( ( $(date +%s) - $(date -r "$DB_FILE" +%s 2>/dev/null || echo 0) ) / 86400 ))
  if [[ "$AGE_DAYS" -lt "$MAX_AGE_DAYS" ]]; then
    echo "GeoIP database is fresh (${AGE_DAYS} days old). Skipping download."
    exit 0
  fi
fi

DOWNLOAD_URL="https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-City&license_key=${LICENCE_KEY}&suffix=tar.gz"
TMP_FILE=$(mktemp "${RUNTIME_DIR}/geolite2-city.XXXXXX.tar.gz")
TMP_EXTRACT=$(mktemp -d "${RUNTIME_DIR}/extract.XXXXXX")

cleanup() {
  rm -f "$TMP_FILE"
  rm -rf "$TMP_EXTRACT"
}
trap cleanup EXIT

echo "Downloading GeoLite2-City database..."
if ! curl -sSL --fail -o "$TMP_FILE" "$DOWNLOAD_URL"; then
  echo "ERROR: Failed to download GeoLite2-City database." >&2
  exit 1
fi

echo "Extracting..."
tar -xzf "$TMP_FILE" -C "$TMP_EXTRACT" --strip-components=1

MMDB_FILE=$(find "$TMP_EXTRACT" -name "*.mmdb" | head -1)
if [[ -z "$MMDB_FILE" ]]; then
  echo "ERROR: No .mmdb file found in downloaded archive." >&2
  exit 1
fi

# Atomic swap: write to .new, then rename
NEW_FILE="${DB_FILE}.new"
cp "$MMDB_FILE" "$NEW_FILE"
mv "$NEW_FILE" "$DB_FILE"

echo "GeoLite2-City database updated successfully: $DB_FILE"
exit 0
