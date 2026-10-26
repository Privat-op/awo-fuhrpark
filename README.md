# AWO Fuhrparkmanagement · Server-MVP

Serverfähige Fuhrparkverwaltung für die AWO Bremerhaven auf Basis von Node.js, SQLite und einer schlanken Web-Oberfläche. Dieses Repository enthält ausschließlich die Serverversion – ohne statische Demo. Die Anwendung startet **ohne Beispieldaten**: Beim ersten Start werden ausschließlich das Administratorkonto aus der `.env` und die Organisationsdaten angelegt.

## Funktionen

- Zentrale Anmeldung mit Sessions, CSRF-Schutz und Rate-Limits
- Rollen: **Administrator** und **Fuhrparkleitung**
- Benutzerverwaltung inklusive Passwort-Reset und eigener Passwortänderung
- Fahrzeuge mit Bild-Upload, Standort, Kilometerstand, HU/AU und Service
- Buchungen mit serverseitiger Konfliktprüfung für Fahrzeug und Fahrer:in
- Fahrtenbuch mit Fahrtstart, Fahrtende und manueller Nachtragung
- Wartungsplan mit automatischer Kostenübernahme bei Erledigung
- Kostenverwaltung inklusive Beleg-Upload (JPG, PNG, PDF)
- Dashboard, Suche und Benachrichtigungen mit Gelesen-Status
- DATEV-unabhängiger JSON-Export; CSV-Export des Fahrtenbuchs
- SQLite-Datenbank, Dateispeicher und Sicherungsskript
- Docker- und Reverse-Proxy-fähig

## Schnellstart mit Docker

Voraussetzungen: Linux-Server mit Docker und Docker Compose, optional eine Domain mit HTTPS.

```bash
cp .env.example .env
# .env öffnen und SESSION_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD sowie Organisationsdaten setzen.
# SESSION_SECRET erzeugen: openssl rand -hex 32

docker compose up -d --build
```

Falls das Docker-Compose-Plugin auf dem Server fehlt, kann die Anwendung auch direkt gebaut und gestartet werden:

```bash
chmod +x deploy-docker.sh
sudo ./deploy-docker.sh
```

Das Skript baut das Image, legt das persistente Daten-Volume an und startet den Container `awo-fuhrpark`. Bei einem erneuten Aufruf wird der bestehende Container ersetzt; das Daten-Volume bleibt erhalten.

Danach `http://SERVER-IP:3000` öffnen und mit dem in `.env` hinterlegten Administratorkonto anmelden. Das Passwort sollte anschließend unter **Einstellungen → Passwort ändern** geändert werden.

### Wichtig beim ersten Start

- `ADMIN_EMAIL` und `ADMIN_PASSWORD` werden nur benötigt, solange die Benutzertabelle leer ist.
- Das Passwort muss mindestens 10 Zeichen haben.
- `SESSION_SECRET` muss mindestens 32 Zeichen lang sein.
- Es werden **keine Demo-Fahrzeuge, Demo-Fahrer:innen oder Demo-Buchungen** angelegt.

## Lokale Entwicklung ohne Docker

Voraussetzungen: Node.js 22 oder neuer.

```bash
cp .env.example .env
# Werte in .env eintragen
npm ci
npm start
```

Die Anwendung läuft anschließend unter `http://127.0.0.1:3000`. Datenbank und Uploads landen standardmäßig im Verzeichnis `data/`.

## HTTPS und Reverse Proxy

Für den Produktivbetrieb ist HTTPS verpflichtend. Beispiel mit Caddy:

```caddyfile
fuhrpark.example.org {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}
```

In `.env` anschließend setzen:

```dotenv
COOKIE_SECURE=true
TRUST_PROXY=1
```

Danach den Container neu starten. Der Server sollte nicht ungeschützt direkt aus dem Internet auf Port 3000 erreichbar sein.

## Rollen

| Rolle | Rechte |
| --- | --- |
| Administrator | Alle Fuhrparkfunktionen, Einstellungen und Benutzerverwaltung |
| Fuhrparkleitung | Alle Fuhrparkfunktionen und Einstellungen, keine Benutzerverwaltung |

Nur Administratoren können weitere Konten anlegen, Rollen ändern, Konten deaktivieren und Passwörter zurücksetzen. Jede Person kann ihr eigenes Passwort unter **Einstellungen** ändern.

## Datenhaltung und Sicherung

Dauerhafte Daten liegen im Docker-Volume `awo_fuhrpark_data` unter `/app/data`:

- `awo-fuhrpark.sqlite` – zentrale Datenbank
- `uploads/vehicles/` – Fahrzeugbilder
- `uploads/receipts/` – Kostenbelege
- `backups/` – lokale Sicherungen

Konsistente Sicherung anstoßen:

```bash
docker compose exec app npm run backup
docker compose cp app:/app/data/backups ./backups
```

Die Sicherung anschließend auf ein externes Medium oder ein Backup-System kopieren. Uploads und Datenbank gehören zusammen und müssen gemeinsam gesichert werden.

## Konfiguration

| Variable | Bedeutung |
| --- | --- |
| `SESSION_SECRET` | Pflicht, mindestens 32 Zeichen |
| `ADMIN_NAME` | Anzeigename des ersten Administrators |
| `ADMIN_EMAIL` | E-Mail des ersten Administrators |
| `ADMIN_PASSWORD` | Startpasswort, nur bei leerer Benutzertabelle nötig |
| `ORG_NAME`, `ORG_LOCATION`, `ORG_EMAIL`, `ORG_PHONE` | Erstinstallation der Organisationsdaten |
| `COOKIE_SECURE` | `true` hinter HTTPS |
| `TRUST_PROXY` | `1`, wenn ein Reverse Proxy davorsteht |
| `APP_PORT` | Host-Port für Docker Compose, Standard `3000` |
| `DATA_DIR` | Datenverzeichnis im Container, Standard `/app/data` |

## Dateien

```text
.
├─ server/             Express-Anwendung, API, Schema, Bootstrap und Backup
├─ public/             CSS und Browser-JavaScript
├─ server/views/       HTML für Anwendung und Login
├─ Dockerfile
├─ docker-compose.yml
├─ deploy-docker.sh     Deployment ohne Compose-Plugin
├─ .env.example
└─ README.md
```

## Betriebsgrenzen dieses MVPs

Für einen echten Produktivbetrieb sind zusätzlich einzuplanen:

- SSO/Entra ID und Mehrfaktor-Authentifizierung
- E-Mail-/Teams-Erinnerungen für TÜV und Wartungen
- zentrale Virenprüfung für hochgeladene PDF-Belege
- feinere Rechte- und Standorttrennung
- revisionssichere Audit-Auswertung im UI
- Aufbewahrungs- und Löschkonzept nach DSGVO
- Datenschutz-Folgenabschätzung und Betriebsvereinbarung bei personenbezogenen Fahrerdaten
- externe Backups, Monitoring und Wiederherstellungstests
- Lasttests und Penetrationstest vor öffentlichem Betrieb

Die Anwendung ist für einen einzelnen Server mit einer SQLite-Instanz ausgelegt. Für horizontale Skalierung oder mehrere parallele Instanzen sollte die Datenhaltung auf PostgreSQL umgestellt werden.
