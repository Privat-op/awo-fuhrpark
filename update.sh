#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [ "$(id -u)" -eq 0 ]; then
  echo "Bitte als normaler Benutzer ausführen. Das Skript nutzt sudo nur für Docker."
  exit 1
fi

if [ ! -f .env ]; then
  echo "Fehlende .env. Bitte zuerst .env.example nach .env kopieren und ausfüllen."
  exit 1
fi

if [ ! -d .git ]; then
  echo "Dieses Verzeichnis ist kein Git-Checkout."
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Es gibt lokale Änderungen im Arbeitsverzeichnis. Bitte zuerst committen oder verwerfen."
  git status --short
  exit 1
fi

echo "Aktueller Commit: $(git rev-parse --short HEAD)"
git pull --ff-only
echo "Neuer Commit:     $(git rev-parse --short HEAD)"

echo "Baue und starte die neue Version. Das Daten-Volume bleibt erhalten."
sudo ./deploy-docker.sh
