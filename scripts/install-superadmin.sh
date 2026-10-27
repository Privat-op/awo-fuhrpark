#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Bitte mit sudo ausführen: sudo ./scripts/install-superadmin.sh"
  exit 1
fi

cd "$(dirname "$0")/.."

TARGET="${SUPERADMIN_FILE:-/etc/awo-fuhrpark/superadmin.json}"
TMP_TARGET="$(mktemp /tmp/awo-superadmin-XXXXXX.json)"
trap 'rm -f "$TMP_TARGET"' EXIT

if [ ! -f node_modules/bcryptjs/index.js ]; then
  echo "Abhängigkeiten fehlen. Bitte zuerst im Projektordner 'npm ci' ausführen."
  exit 1
fi

container_gid="$(docker exec awo-fuhrpark id -g 2>/dev/null || true)"
container_gid="${container_gid:-1000}"

if [ -f "$TARGET" ]; then
  backup="${TARGET}.bak.$(date +%Y%m%d%H%M%S)"
  cp -a "$TARGET" "$backup"
  chmod 600 "$backup"
  echo "Bestehende Datei gesichert: $backup"
fi

node scripts/superadmin-setup.js --out "$TMP_TARGET" --force

install -d -o root -g "$container_gid" -m 0750 "$(dirname "$TARGET")"
install -o root -g "$container_gid" -m 0640 "$TMP_TARGET" "$TARGET"

echo "Superadmin-Datei installiert: $TARGET"
echo "Container wird neu erstellt und geprüft ..."
./deploy-docker.sh

echo "Superadmin-Setup abgeschlossen. Healthcheck erfolgreich."
