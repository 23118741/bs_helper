#!/usr/bin/env bash
# Builds the online extension (type check + production build) and zips it as release/brightspace-helper-<version>.zip,
# with the version from src/manifest.json. Usage:  npm run release
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./src/manifest.json').version")"
ZIP="release/bs-helper-$VERSION.zip"

echo "==> Building the online extension ($VERSION)"
npm run build

echo "==> Zipping dist-online"
mkdir -p release
rm -f "$ZIP"
(cd dist-online && zip -qr "../$ZIP" .)
echo "==> Done: $ZIP"
