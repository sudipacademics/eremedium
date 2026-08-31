#!/usr/bin/env bash
#
# Populate the Swiss Ephemeris data directory.
#
# Idempotent: already-valid files are left alone, so this is safe to re-run on every deploy.
# Note the historical https://www.astro.com/ftp/swisseph/ephe/ path now returns 404; these files
# come from the upstream Swiss Ephemeris repository maintained by Astrodienst.

set -euo pipefail

BASE_URL="${EPHE_BASE_URL:-https://raw.githubusercontent.com/aloistr/swisseph/master/ephe}"
TARGET_DIR="${EPHE_TARGET_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/backend/astro-service/ephemeris}"

# Covers 1800-2399 CE: planets, high-precision moon, main asteroids.
FILES=(sepl_18.se1 semo_18.se1 seas_18.se1)

# Every genuine .se1 file starts with this marker. An HTML error page saved by a proxy will not,
# which is the failure mode that makes swe.set_ephe_path() silently fall back to the Moshier model.
MAGIC="SWISSEPH"

log() { printf '[ephe] %s\n' "$*"; }

is_valid() {
  local path="$1"
  [[ -s "$path" ]] && [[ "$(head -c 8 "$path" 2>/dev/null || true)" == "$MAGIC" ]]
}

mkdir -p "$TARGET_DIR"
cd "$TARGET_DIR"
log "target directory: $TARGET_DIR"

for file in "${FILES[@]}"; do
  if is_valid "$file"; then
    log "$file already present and valid ($(du -h "$file" | cut -f1)), skipping"
    continue
  fi

  log "downloading $file ..."
  tmp="${file}.part"
  if ! curl --fail --location --silent --show-error --retry 3 --retry-delay 2 \
            --connect-timeout 20 --max-time 300 \
            --output "$tmp" "$BASE_URL/$file"; then
    rm -f "$tmp"
    log "ERROR: download failed for $file from $BASE_URL"
    exit 1
  fi

  if ! is_valid "$tmp"; then
    rm -f "$tmp"
    log "ERROR: $file is not a Swiss Ephemeris binary (missing '$MAGIC' header)."
    log "       The URL probably returned an HTML error page. Check \$EPHE_BASE_URL."
    exit 1
  fi

  mv "$tmp" "$file"
  log "$file OK ($(du -h "$file" | cut -f1))"
done

log "all ephemeris files verified:"
ls -lh "${FILES[@]}"
