#!/usr/bin/env bash
# Run on YOUR computer (no local docker needed). Copies the server sources to the VPS, builds the image
# there and restarts the stack. Usage:  ./server/deploy/deploy-remote.sh root@your-server
set -euo pipefail

TARGET="${1:?usage: deploy-remote.sh user@host}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "==> Uploading sources and building on the server"
tar czf - .dockerignore shared server/package.json server/package-lock.json server/tsconfig.json \
  server/tsconfig.build.json server/src server/Dockerfile \
  | ssh "$TARGET" 'rm -rf ~/build && mkdir ~/build && tar xzf - -C ~/build && cd ~/build && docker build -f server/Dockerfile -t brightspace-helper-api:latest .'

echo "==> Copying compose files and restarting"
scp -q server/deploy/docker-compose.yml server/deploy/Caddyfile server/deploy/backup.sh "$TARGET:app/"
ssh "$TARGET" 'cd ~/app && docker compose up -d && sleep 10 && docker compose ps'
echo "==> Done. Check: curl https://bshelper.duckdns.org/healthz"
