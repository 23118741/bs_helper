#!/usr/bin/env bash
# One command to ship: tests the server, deploys it to the VPS, checks that it is up, then builds the matching
# extension zip. Usage:  npm run deploy
# The server comes from $DEPLOY_TARGET, else from the file .deploy-target (not committed), e.g. root@1.2.3.4
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TARGET="${DEPLOY_TARGET:-$(cat .deploy-target 2>/dev/null || true)}"
TARGET="$(echo "$TARGET" | tr -d '[:space:]')"
if [ -z "$TARGET" ]; then
  echo "No server set. Put it in .deploy-target (e.g. echo root@1.2.3.4 > .deploy-target) or set DEPLOY_TARGET." >&2
  exit 1
fi
HEALTH_URL="${DEPLOY_HEALTH_URL:-https://bshelper.duckdns.org/healthz}"

echo "==> Testing the server"
(cd server && npm run typecheck && npm test)

echo "==> Deploying to $TARGET"
./server/deploy/deploy-remote.sh "$TARGET"

echo "==> Checking $HEALTH_URL"
for i in $(seq 1 12); do
  if curl -fsS --max-time 5 "$HEALTH_URL"; then
    echo
    break
  fi
  if [ "$i" -eq 12 ]; then
    echo "The server does not answer on $HEALTH_URL. Check: ssh $TARGET 'cd ~/app && docker compose logs --tail=50 api'" >&2
    exit 1
  fi
  sleep 5
done

echo "==> Building the matching extension"
./scripts/release.sh
