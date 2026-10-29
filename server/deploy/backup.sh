#!/usr/bin/env bash
# Nightly backup of the SQLite database (run on the VPS from cron, see server/README.md).
# Requires: sqlite3, age (apt install sqlite3 age). Set AGE_RECIPIENT to your age public key,
# and optionally OFFSITE_CMD (e.g. "rclone copy {} remote:backups") to copy the file off the server.
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/app}"
OUT_DIR="${OUT_DIR:-$APP_DIR/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
: "${AGE_RECIPIENT:?set AGE_RECIPIENT to your age public key (age-keygen -o key.txt)}"

mkdir -p "$OUT_DIR"
STAMP="$(date +%F-%H%M)"
RAW="$OUT_DIR/app-$STAMP.db"
sqlite3 "$APP_DIR/data/app.db" ".backup '$RAW'"
age -r "$AGE_RECIPIENT" -o "$RAW.age" "$RAW"
rm -f "$RAW"
find "$OUT_DIR" -name 'app-*.db.age' -mtime +"$KEEP_DAYS" -delete

if [ -n "${OFFSITE_CMD:-}" ]; then
  ${OFFSITE_CMD//\{\}/$RAW.age}
fi
echo "backup ok: $RAW.age"
