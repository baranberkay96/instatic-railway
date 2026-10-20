#!/bin/sh
# Railway entrypoint for Instatic (community template, not affiliated with CoreBunch).
#
# Phase 1, as root (Railway mounts volumes owned by root):
#   create the storage directories, hand the volume to the image's unprivileged
#   `bun` user, then re-run this script as `bun` with setpriv.
# Phase 2, as bun:
#   run railway-bootstrap.ts (wait for the database, migrations, Owner account on
#   a fresh install) and only then exec the Instatic server. The HTTP port opens
#   after the Owner exists, so the first-run setup wizard never answers a request.
set -eu

APP_USER=bun
APP_HOME=/home/bun
BOOTSTRAP=/app/railway/railway-bootstrap.ts
DEFAULT_VOLUME=/app/storage

log() { printf '[railway-entrypoint] %s\n' "$*"; }
warn() { printf '[railway-entrypoint] WARNING: %s\n' "$*" >&2; }
fail() { printf '[railway-entrypoint] ERROR: %s\n' "$*" >&2; exit 1; }

cd /app

if [ "$#" -eq 0 ]; then
  set -- bun run server/index.ts
fi

# Directory holding the SQLite file, or nothing for Postgres / in-memory SQLite.
sqlite_dir() {
  case "${DATABASE_URL:-}" in
    sqlite::memory:) return 0 ;;
    sqlite:*) db_path=${DATABASE_URL#sqlite:} ;;
    file:*) db_path=${DATABASE_URL#file:} ;;
    *.db) db_path=$DATABASE_URL ;;
    *) return 0 ;;
  esac
  [ -n "$db_path" ] && dirname "$db_path"
  return 0
}

# True when $1 is the volume mount path or inside it.
on_volume() {
  [ -n "${RAILWAY_VOLUME_MOUNT_PATH:-}" ] || return 1
  case "$1" in
    "$RAILWAY_VOLUME_MOUNT_PATH" | "$RAILWAY_VOLUME_MOUNT_PATH"/*) return 0 ;;
    *) return 1 ;;
  esac
}

prepare_storage() {
  volume=${RAILWAY_VOLUME_MOUNT_PATH:-}
  if [ -z "$volume" ]; then
    warn "no Railway volume is attached. Media, fonts, plugins and published pages are lost on every redeploy; attach a volume at $DEFAULT_VOLUME"
  fi

  uploads=${UPLOADS_DIR:-/app/uploads}
  db_dir=$(sqlite_dir)
  for dir in "$uploads" "${RUNTIME_CACHE_DIR:-}" "$db_dir"; do
    [ -n "$dir" ] || continue
    mkdir -p "$dir"
    chown "$APP_USER:$APP_USER" "$dir"
  done

  if [ -n "$volume" ]; then
    on_volume "$uploads" || warn "UPLOADS_DIR=$uploads is outside the volume at $volume; uploads are lost on redeploy"
    if [ -n "$db_dir" ] && ! on_volume "$db_dir"; then
      warn "the SQLite database in $db_dir is outside the volume at $volume; content is lost on redeploy"
    fi
    if [ -d "$volume" ]; then
      # Only files not yet owned by bun are touched, so later boots just walk the tree.
      find "$volume" -xdev \( ! -user "$APP_USER" -o ! -group "$APP_USER" \) \
        -exec chown -h "$APP_USER:$APP_USER" {} +
    fi
  fi
}

if [ "$(id -u)" = "0" ]; then
  prepare_storage
  command -v setpriv >/dev/null 2>&1 || fail "setpriv is missing; refusing to run Instatic as root"
  exec setpriv --reuid="$APP_USER" --regid="$APP_USER" --init-groups \
    env HOME="$APP_HOME" USER="$APP_USER" "$0" "$@"
fi

[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL is empty. Use \${{Postgres.DATABASE_URL}} or sqlite:$DEFAULT_VOLUME/data/cms.db"

log "running as $(id -un); bootstrap: database, migrations, Owner account"
bun run "$BOOTSTRAP" || fail "bootstrap failed (see the [railway-bootstrap] lines above); Instatic was not started"

log "starting Instatic: $*"
exec "$@"
