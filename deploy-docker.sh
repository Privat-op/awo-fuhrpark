#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "Fehlende .env. Bitte zuerst .env.example nach .env kopieren und ausfüllen."
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker ist nicht installiert."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  if [ "$(id -u)" -ne 0 ]; then
    echo "Docker ist für diesen Benutzer nicht erreichbar. Bitte dieses Skript mit sudo ausführen:"
    echo "  sudo ./deploy-docker.sh"
    exit 1
  fi
fi

HOST_PORT="$(awk -F= '/^APP_PORT=/{print $2}' .env 2>/dev/null | tail -n 1)"
HOST_PORT="${HOST_PORT:-3000}"

echo "Baue Image awo-fuhrpark:0.5.0 ..."
docker build -t awo-fuhrpark:0.5.0 .

echo "Erstelle persistentes Daten-Volume ..."
docker volume create awo_fuhrpark_data >/dev/null

if docker container inspect awo-fuhrpark >/dev/null 2>&1; then
  echo "Entferne vorherigen Container ..."
  docker rm -f awo-fuhrpark >/dev/null
fi

echo "Starte Container ..."
docker run -d \
  --name awo-fuhrpark \
  --init \
  --restart unless-stopped \
  --security-opt no-new-privileges:true \
  --env-file .env \
  -e NODE_ENV=production \
  -e DATA_DIR=/app/data \
  -p "${HOST_PORT}:3000" \
  -v awo_fuhrpark_data:/app/data \
  awo-fuhrpark:0.5.0 >/dev/null

echo "Warte auf Anwendung ..."
for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${HOST_PORT}/healthz" >/dev/null 2>&1; then
    echo "Anwendung läuft auf http://SERVER-IP:${HOST_PORT}"
    exit 0
  fi
  sleep 2
done

echo "Anwendung antwortet nicht. Letzte Logzeilen:"
docker logs --tail=100 awo-fuhrpark
exit 1
