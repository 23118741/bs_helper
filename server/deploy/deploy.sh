#!/usr/bin/env bash
# Run on YOUR computer (needs docker locally). Builds the image, copies it and the config to the
# VPS over SSH and (re)starts the stack. Usage:  ./server/deploy/deploy.sh user@your-server
set -euo pipefail

TARGET="${1:?usage: deploy.sh user@host}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REMOTE_DIR="app"

echo "==> Building image"
docker build -f "$ROOT/server/Dockerfile" -t brightspace-helper-api:latest "$ROOT"

echo "==> Copying files"
ssh "$TARGET" "mkdir -p $REMOTE_DIR/data"
scp "$ROOT/server/deploy/docker-compose.yml" "$ROOT/server/deploy/Caddyfile" \
  "$ROOT/server/deploy/.env.example" "$ROOT/server/deploy/backup.sh" "$TARGET:$REMOTE_DIR/"

echo "==> Uploading image"
docker save brightspace-helper-api:latest | gzip | ssh "$TARGET" "gunzip | docker load"

echo "==> Starting"
ssh "$TARGET" "cd $REMOTE_DIR && test -f .env || { echo 'Missing ~/app/.env: copy .env.example to .env, fill it in (nano .env), chmod 600 .env, then run this script again.'; exit 1; }; \
  chown 1000:1000 data && docker compose up -d && sleep 5 && docker compose ps"

echo "==> Done. Check: curl https://\$DOMAIN/healthz"
