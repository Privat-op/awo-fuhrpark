# AWO Fuhrparkmanagement · Server-MVP

Serverfähige Fuhrparkverwaltung für die AWO Bremerhaven auf Basis von Node.js, SQLite und einer schlanken Web-Oberfläche. Dieses Repository enthält ausschließlich die Serverversion – ohne statische Demo. Die Anwendung startet **ohne Beispieldaten**: Beim ersten Start werden ausschließlich das Administratorkonto aus der `.env` und die Organisationsdaten angelegt.

## Funktionen

- Zentrale Anmeldung mit Sessions, CSRF-Schutz und Rate-Limits
- Rollen: **Administrator** und **Fuhrparkleitung** sowie frei anlegbare Rollen
- Feine Rechteverwaltung: Modulrechte, Objekt-Ausnahmen pro Fahrzeug, Fahrer:in, Buchung, Kostenposition und Wartung sowie persönliche Benutzer-Ausnahmen
- Benutzerverwaltung inklusive Rollen, Passwort-Reset, Deaktivierung und Anonymisierung deaktivierter Konten
- Automatische Anonymisierung deaktivierter Konten nach einer global einstellbaren Frist
- Fahrzeuge mit Bild-Upload, Standort, Kilometerstand, HU/AU und Service
- Buchungen mit serverseitiger Konfliktprüfung für Fahrzeug und Fahrer:in
- Fahrtenbuch mit Fahrtstart, Fahrtende und manueller Nachtragung
- Wartungsplan mit automatischer Kostenübernahme bei Erledigung
- Kostenverwaltung inklusive Beleg-Upload (JPG, PNG, PDF)
- Dashboard, Suche und Benachrichtigungen mit Gelesen-Status
- **Globales Erscheinungsbild:** Allgemeines AWO-Theme mit offiziellem Logo oder neutrales Theme mit eigenem Anzeigenamen, optionalem Logo, Akzentfarbe, weiteren Farben und Sidebar-Stil inklusive Live-Vorschau
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

## Updates einspielen

Wenn Änderungen im GitHub-Repository auf `main` liegen:

```bash
cd ~/awo-fuhrpark
./update.sh
```

Das Skript prüft auf lokale Änderungen, zieht den neuesten Stand, baut das Image neu und ersetzt den Container. Datenbank, Uploads und Sicherungen bleiben im Volume `awo_fuhrpark_data` erhalten.

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

## Rollen und Rechte

| Rolle | Rechte |
| --- | --- |
| Administrator | Alle Fuhrparkfunktionen, Einstellungen und Benutzerverwaltung; immer vollständig und geschützt |
| Fuhrparkleitung | Standardrolle mit allen Fuhrparkfunktionen und Einstellungen, ohne Benutzerverwaltung; Rechte und Objekt-Ausnahmen können angepasst werden |
| Eigene Rollen | Frei anlegbare Rollen mit individuellen Modul- und Objekt-Ausnahmen |

Nur Administratoren können Konten anlegen, Rollen ändern, Benutzer-Ausnahmen pflegen, Konten deaktivieren und Passwörter zurücksetzen. Jede Person kann ihr eigenes Passwort unter **Einstellungen** ändern.

### Rechte-Hierarchie

Die Rechte werden in dieser Reihenfolge aufgelöst, von der spezifischsten zur allgemeinsten Regel:

1. **Benutzer-Objekt-Ausnahme** – gilt für genau ein Objekt und einen Benutzer.
2. **Benutzer-Modul-Ausnahme** – gilt für einen Benutzer und ein Modul.
3. **Rollen-Objekt-Ausnahme** – gilt für genau ein Objekt und eine Rolle.
4. **Rollenrecht** – gilt für die gesamte Rolle.

Auf derselben Ebene gewinnt bei Konflikten die Verweigerung. Eine Objekt-Ausnahme kann ein Recht erlauben oder verweigern, auch wenn das Rollenrecht anders lautet. Die Administrator-Rolle ignoriert Benutzer-Ausnahmen und bleibt immer vollständig.

### Objekt-Ausnahmen

Unter **Rollen & Rechte → Objekt-Ausnahmen** lassen sich pro Rolle und Objekt einzelne Aktionen auf **Standard**, **Erlauben** oder **Verweigern** stellen. Unterstützt werden:

- Fahrzeuge
- Fahrer:innen
- Buchungen
- Kostenpositionen
- Wartungen

Die Einstellungen gelten serverseitig für Datenanzeige und Aktionen. Ein Benutzer sieht ein Objekt nur, wenn die effektive Berechtigung es zulässt; die gleiche Prüfung greift bei Bearbeitung, Buchung, Kosten, Wartung und Belegen.

### Benutzer-Ausnahmen

Unter **Benutzer → Benutzer-Ausnahmen** können Administrator:innen persönliche Modul- und Objekt-Ausnahmen pflegen. Diese haben Vorrang vor den Rollenrechten. Beim Wechsel in die Administrator-Rolle oder bei der Anonymisierung werden persönliche Ausnahmen entfernt.

## Benutzerkonten und Anonymisierung

Aktive Konten werden nicht gelöscht, sondern können deaktiviert werden. Deaktivierte Konten können anschließend anonymisiert werden:

- Name, E-Mail-Adresse und Passwort werden dauerhaft entfernt.
- Persönliche Rechte-Ausnahmen werden entfernt.
- Alle Sitzungen des Kontos werden beendet.
- Verknüpfte Buchungen, Kosten und Audit-Einträge bleiben erhalten.
- E-Mail-Adressen in zugehörigen Audit-Einträgen werden bereinigt.
- Das Konto bleibt deaktiviert und kann nicht reaktiviert werden.

Unter **Benutzer → Automatische Anonymisierung** lässt sich eine globale Frist in Tagen einstellen. `0` deaktiviert die Automatik. Die Prüfung läuft beim Serverstart, nach dem Speichern der Frist und anschließend regelmäßig. Nur Konten, die bereits deaktiviert und älter als die Frist sind, werden erfasst.

## Erscheinungsbild

Unter **Einstellungen → Erscheinungsbild** kann ausschließlich ein Administrator das Theme global für alle Nutzer:innen und die Anmeldeseite wählen:

- **AWO:** allgemeines AWO-Theme mit offiziellem AWO-Logo, ohne Ortsverband-Zusatz
- **Neutral:** eigenes Branding mit frei wählbarem Anzeigenamen, optionalem Logo, Akzentfarbe, weiteren Farben für Seite/Karten/Text/Rahmen, wahlweise dunkler oder heller Sidebar und Live-Vorschau

Die Einstellung wird in der Datenbank gespeichert und ist nicht pro Benutzerkonto wählbar. Andere angemeldete Nutzer sehen sie nach dem nächsten Laden der Seite.

Das AWO-Logo ist eine eingetragene Wort-/Bildmarke der Arbeiterwohlfahrt. Die Nutzung setzt eine entsprechende Berechtigung voraus. Quelle der eingebundenen Logo-Datei: Wikimedia Commons, `Awo-logo-08.svg`.

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
├─ public/             CSS, Browser-JavaScript und Branding-Dateien
├─ server/views/       HTML für Anwendung und Login
├─ Dockerfile
├─ docker-compose.yml
├─ deploy-docker.sh     Deployment ohne Compose-Plugin
├─ update.sh            GitHub-Update + Neustart
├─ .env.example
└─ README.md
```

## Betriebsgrenzen dieses MVPs

Für einen echten Produktivbetrieb sind zusätzlich einzuplanen:

- SSO/Entra ID und Mehrfaktor-Authentifizierung
- E-Mail-/Teams-Erinnerungen für TÜV und Wartungen
- zentrale Virenprüfung für hochgeladene PDF-Belege
- standortbezogene Sichtbarkeit und Freigabeprozesse
- revisionssichere Audit-Auswertung im UI
- Aufbewahrungs- und Löschkonzept nach DSGVO
- Datenschutz-Folgenabschätzung und Betriebsvereinbarung bei personenbezogenen Fahrerdaten
- externe Backups, Monitoring und Wiederherstellungstests
- Lasttests und Penetrationstest vor öffentlichem Betrieb

Die Anwendung ist für einen einzelnen Server mit einer SQLite-Instanz ausgelegt. Für horizontale Skalierung oder mehrere parallele Instanzen sollte die Datenhaltung auf PostgreSQL umgestellt werden.
