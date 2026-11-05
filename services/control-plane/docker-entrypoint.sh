#!/bin/sh
# Applies the migrations to the local D1 database, seeds a local developer key, then starts `wrangler dev`.
set -eu
DIR="${SHIPVO_PERSIST_DIR:-.wrangler/state}"
npx wrangler d1 migrations apply DB --local --persist-to "$DIR"
if [ -n "${SHIPVO_LOCAL_DEV_KEY:-}" ]; then
  HASH=$(printf '%s' "$SHIPVO_LOCAL_DEV_KEY" | sha256sum | cut -d' ' -f1)
  npx wrangler d1 execute DB --local --persist-to "$DIR" --command \
    "INSERT OR IGNORE INTO accounts (github_id, github_login) VALUES (0, 'local-dev'); INSERT OR IGNORE INTO api_keys (app_id, key_hash, prefix, scope, label, account_id) SELECT 'tide', '$HASH', substr('$SHIPVO_LOCAL_DEV_KEY',1,12), 'test', 'local dev key', id FROM accounts WHERE github_id = 0;"
fi
exec npx wrangler dev --local --ip 0.0.0.0 --port 8787 --persist-to "$DIR"
