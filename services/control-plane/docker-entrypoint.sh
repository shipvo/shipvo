#!/bin/sh
# Applies the migrations to the local D1 database, seeds a local developer key, then starts `wrangler dev`.
# Commands: `backup <file.tgz>` and `restore <file.tgz>` (stop the server first), then the default: migrate and serve.
# SHIPVO_MIGRATE_ONLY=1 applies the migrations and the developer key, then exits (used by the upgrade test).
set -eu
DIR="${SHIPVO_PERSIST_DIR:-.wrangler/state}"
case "${1:-}" in
  backup)
    [ -n "${2:-}" ] || { echo "usage: backup <file.tgz>" >&2; exit 1; }
    [ -d "$DIR" ] || { echo "No data in $DIR to back up." >&2; exit 1; }
    tmp="$2.partial"
    tar czf "$tmp" -C "$DIR" .
    mv "$tmp" "$2"
    echo "Backed up $DIR to $2"
    exit 0
    ;;
  restore)
    [ -n "${2:-}" ] && [ -f "$2" ] || { echo "usage: restore <file.tgz> (the file must exist)" >&2; exit 1; }
    tar tzf "$2" >/dev/null || { echo "$2 is not a readable backup." >&2; exit 1; }
    if [ -d "$DIR" ] && [ -n "$(ls -A "$DIR" 2>/dev/null)" ]; then
      echo "$DIR already holds data. Restore needs an empty directory (use a new volume)." >&2
      exit 1
    fi
    mkdir -p "$DIR"
    tar xzf "$2" -C "$DIR"
    echo "Restored $2 into $DIR"
    exit 0
    ;;
esac
case "${SHIPVO_LOCAL_DEV_KEY:-}" in
  *[!A-Za-z0-9_-]*)
    echo "SHIPVO_LOCAL_DEV_KEY may only contain letters, digits, '_' and '-'." >&2
    exit 1
    ;;
esac
npx wrangler d1 migrations apply DB --local --persist-to "$DIR"
if [ -n "${SHIPVO_LOCAL_DEV_KEY:-}" ]; then
  HASH=$(printf '%s' "$SHIPVO_LOCAL_DEV_KEY" | sha256sum | cut -d' ' -f1)
  npx wrangler d1 execute DB --local --persist-to "$DIR" --command \
    "UPDATE api_keys SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE label = 'local dev key' AND revoked_at IS NULL AND key_hash != '$HASH'; INSERT OR IGNORE INTO accounts (github_id, github_login) VALUES (0, 'local-dev'); INSERT OR IGNORE INTO api_keys (app_id, key_hash, prefix, scope, label, account_id) SELECT 'tide', '$HASH', substr('$SHIPVO_LOCAL_DEV_KEY',1,12), 'test', 'local dev key', id FROM accounts WHERE github_id = 0;"
fi
[ "${SHIPVO_MIGRATE_ONLY:-}" = 1 ] && exit 0
exec npx wrangler dev --local --ip 0.0.0.0 --port 8787 --persist-to "$DIR"
