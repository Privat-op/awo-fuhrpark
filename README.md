# AWO Fuhrparkmanagement · Server-MVP

Serverfähige Fuhrparkverwaltung für die AWO Bremerhaven auf Basis von Node.js, SQLite und einer schlanken Web-Oberfläche. Dieses Repository enthält ausschließlich die Serverversion – ohne statische Demo. Die Anwendung startet **ohne Beispieldaten**: Beim ersten Start werden ausschließlich das Administratorkonto aus der `.env` und die Organisationsdaten angelegt.

## Funktionen

- Zentrale Anmeldung mit Sessions, CSRF-Schutz und Rate-Limits
- **Passwort vergessen:** Self-Service-Link mit 60-Minuten-Token, Einmalverwendung, generischer Antwort und Invalidierung aller Sitzungen
- **Optionale MFA:** TOTP über Authenticator-App plus 10 einmalige Recovery-Codes, freiwillig pro Konto aktivierbar; kein Zwang, kein Step-up
- **Optionale Passkeys:** WebAuthn/Passkey als zweiter Faktor nach dem Passwort, mehrere Geräte pro Konto, Fallback auf TOTP/Recovery; kein passwordless Login
- **Optionales SSO:** generischer OIDC-Authorization-Code-Flow mit PKCE, State und Nonce, Entra-ID-Gruppenmapping, optionalem JIT-Provisioning; lokaler Login bleibt Fallback
- **Optionale Standorte:** Stammdaten, Benutzer-/Fahrzeugzuordnung, standortbezogene Sichtbarkeit und Freigaberouting; standardmäßig aus (`LOCATIONS_ENABLED=false`)
- **Integrationsseite:** SSO, Teams, ClamAV, WebAuthn, Retention und Standorte zentral unter **Einstellungen → Integrationen**; ENV-Variablen bleiben Override, Secrets werden AES-256-GCM verschlüsselt
- **Erweitert:** APP_BASE_URL, Scheduler-Parameter und Read-only-Systemstatus unter **Einstellungen → Erweitert**; Scheduler starten nach dem Speichern ohne Prozessneustart neu
- Rollen: **Administrator**, **Fuhrparkleitung**, **Standardbenutzer** sowie frei anlegbare Rollen
- Feine Rechteverwaltung: Modulrechte, Objekt-Ausnahmen pro Fahrzeug, Fahrer:in, Buchung, Kostenposition und Wartung sowie persönliche Benutzer-Ausnahmen
- Delegierbare Benutzer- und Rollenverwaltung mit Rangfolge, Grant Ceiling, Passwort-Reset, Deaktivierung und Anonymisierung deaktivierter Konten
- Automatische Anonymisierung deaktivierter Konten nach einer global einstellbaren Frist
- Fahrzeuge mit Bild-Upload, Standort, Eigentum/Leasing, Kilometerstand, HU/AU, Service und erweiterten Statuswerten (Defekt, Veräußert, Nicht fahrbereit)
- Leasingüberwachung mit Laufzeit, Gesamt-Kilometerlimit, Warnschwellen 80/90/100 % und Erinnerungen 90/30 Tage vor Leasingende
- Optionaler E-Mail-Versand an Fuhrparkleitung und Administration bei Leasing-Schwellen, Buchungsanfragen sowie Wartungs-/TÜV-Erinnerungen; SMTP-Konfiguration ausschließlich für Administrator:innen
- **Optionaler Teams-Webhook:** MessageCards für Leasing, Buchungsanfragen/-entscheidungen und Wartungs-/TÜV-Erinnerungen; ohne Graph/App-Registration, ohne URL in Logs
- **Allgemeine Webhooks:** mehrere Endpunkte mit Format (generisch/Teams/Discord/Slack), Event-Abos, HMAC, SSRF-Schutz, Retry und Dedupe
- **DEV-Logging:** zentraler Logger mit Request-IDs, Redaction, separatem `mail.log` und Rotation; Produktion bleibt bei `info` ohne Request-Logs
- **Optionale ClamAV-Prüfung:** Uploads (PDF-Belege und Bilder) per clamd INSTREAM vor dem Speichern, Fail-Closed und Audit `upload_blocked` ohne Dateiinhalte
- **DSGVO-Retention (technisch):** konfigurierbare Aufbewahrung für Audit, Sessions, Reset-Tokens und Benachrichtigungs-Deliveries inklusive Dry-Run; keine automatische Löschung von Buchungen/Kosten/Fahrtenbuch
- Dauerhafte Fahrzeug-Sperre mit Begründung, Audit und serverseitiger 409-Sperre für neue Buchungen und Anfragen
- Buchungen mit serverseitiger Konfliktprüfung für Fahrzeug und Fahrer:in
- Eigene Fahrten: verknüpfte Fahrer:innen sehen ausschließlich ihre eigenen Buchungen und können Buchungsanfragen stellen
- Buchungsanfragen mit Rang- und Rollen-Policy, transaktionaler Genehmigung und Audit
- Fahrtenbuch mit Fahrtstart, Fahrtende und manueller Nachtragung
- Wartungsplan mit automatischer Kostenübernahme bei Erledigung
- Kostenverwaltung inklusive Beleg-Upload (JPG, PNG, PDF)
- Kostenstellen als Stammdatum je Gesellschaft mit Zuordnung zu Fahrzeugen, Fahrer:innen und Benutzerkonten, Default-Übernahme in Buchungen/Kosten, Filtern, Summen und Export
- Dashboard, Suche und Benachrichtigungen mit Gelesen-Status
- **Auto-Refresh:** Übersichten aktualisieren den Server-State alle 60 Sekunden, nur bei sichtbarem Tab und pausiert bei Modals, Formularfokus und verstecktem Tab
- **Globales Erscheinungsbild:** Allgemeines AWO-Theme mit offiziellem Logo oder neutrales Theme mit eigenem Anzeigenamen, optionalem Logo, Akzentfarbe, weiteren Farben und Sidebar-Stil inklusive Live-Vorschau
- **Farbschema:** Hell, Dunkel oder Automatik pro Nutzerkonto, globaler Default durch die Administration, konsistente Dark-Mode-Tokens für AWO und neutral, Login und Druckansicht
- DATEV-unabhängiger JSON-Export und CSV-Export des Fahrtenbuchs; beide serverseitig berechtigungsgeprüft und audit-protokolliert
- **Audit-Log für alle angemeldeten Nutzer:** serverseitig begrenzte Sicht (eigene Aktionen, Rangbereich oder alle Aktivitäten), Suche/Filter, Maskierung, Meta-Audit und Pagination
- SQLite-Datenbank, Dateispeicher und Sicherungsskript
- Docker- und Reverse-Proxy-fähig

## Release v0.11.0 (Optionale Passkeys)

v0.11.0 ergänzt WebAuthn/Passkeys als optionalen zweiten Faktor nach dem Passwort. Kein passwordless Login, kein Enforcement, kein Step-up; TOTP/Recovery bleiben Fallback.

- **Registrierung:** Passkey unter **Einstellungen → Sicherheit** mit Passwortbestätigung hinzufügen; mehrere Geräte pro Konto, Umbenennen und Entfernen.
- **Login:** Nach dem Passwort kann neben TOTP/Recovery ein hinterlegter Passkey verwendet werden; die Session wird nach erfolgreicher Assertion regeneriert.
- **Sicherheit:** Origin/RP-ID/Challenge/Signatur strikt geprüft, `userVerification: required`, Counter-Rückschritt entfernt den Passkey, 5 Fehlversuche/15 Minuten Lockout, CSRF auf allen Änderungen.
- **Admin-Reset:** löscht Passkeys zusammen mit TOTP/Recovery und beendet Ziel-Sitzungen; Audit `passkey_reset` ohne Credential-Daten.
- **Migration:** `user_version = 10` (`user_passkeys`, `passkey_attempts`).

Details: [Feature-Doku v0.11.0 Passkeys](FEATURE_DOKU_v0.11.0_Passkeys.md).

## Release v0.10.0 (Optionale MFA)

v0.10.0 ergänzt eine freiwillige Zwei-Faktor-Authentifizierung mit TOTP und Recovery-Codes. Es gibt keine Rollenpflicht, keine Fristen, kein Enforcement und keinen Step-up; Passkeys/WebAuthn bleiben Phase B.

- **Self-Service:** Jede:r kann unter **Einstellungen → Sicherheit** TOTP aktivieren, deaktivieren und Recovery-Codes neu ausgeben.
- **Login:** Nur bei aktivierter MFA wird nach dem Passwort ein zusätzlicher Schritt `/login/mfa` verlangt; ohne MFA bleibt der Login unverändert.
- **Sicherheit:** TOTP-Secret AES-256-GCM-verschlüsselt, Recovery-Codes nur als HMAC-Hash, 5 Fehlversuche/15 Minuten mit 15-Minuten-Sperre, Replay-Schutz.
- **Support:** Administrator:innen können MFA von Konten mit strikt niedrigerem Rang zurücksetzen, der Superadmin von jedem Konto; Ziel-Sitzungen werden beendet.
- **Migration:** `user_version = 8` (`user_mfa`, `mfa_recovery_codes`).

Details: [Feature-Doku v0.10.0 MFA](FEATURE_DOKU_v0.10.0_MFA.md). Das Design liegt extern unter `C:\awo-fuhrpark-docs\v0.10.0_MFA_Passkey_Design.md`.

## Release v0.9.1

UI- und Rechte-Fix: Fokusring-Kontrast (QS-012) behoben, dunkle Custom-Akzentfarben werden im Dark Mode aufgehellt, und Fahrzeuge mit Objekt-Deny `vehicles_view` erscheinen weder im Buchungsanfrage-Dropdown noch können sie per API angefragt werden. Keine Migration (`user_version = 7`).

## Release v0.9.0 (Paket 3)

Paket 3 führt den Dark Mode ein. Der Stand ist **QS-freigegeben (54 Checks, Freigabe JA; ein niedriges Finding QS-012 im Backlog)** und wird als v0.9.0 deployed.

- **Drei Modi:** `light`, `dark` und `auto` pro Nutzerkonto; `NULL` folgt dem globalen Default `light`.
- **Globaler Default:** in den Einstellungen durch `settings_manage` änderbar; die Loginseite nutzt ausschließlich diesen Default.
- **Kein Flackern:** serverseitiges `data-color-mode` und ein Inline-Bootstrap nur für `auto` vor dem Stylesheet; Media-Query-Listener aktualisiert ohne Reload.
- **Darstellung:** semantische Light-/Dark-Tokens für AWO und neutral, Tabellen, Karten, Formulare, Modale, Charts, Toasts, Leerzustände und Login; Fokusringe und `prefers-reduced-motion` bleiben erhalten.
- **Kompakter Header:** einzelner Hell/Dunkel-Umschalter; Automatik bleibt in den Einstellungen. Der Header nutzt eigene Tokens und bleibt im Dark Mode dunkel.
- **Druck:** Druck/PDF erzwingt immer das helle Farbschema.
- **Migration:** `user_version = 7`.

Details: [Feature-Doku v0.9.0 Paket 3](FEATURE_DOKU_v0.9.0_Paket3.md).

## Release v0.8.0 (Paket 2)

Paket 2 führt Kostenstellen ein. Der Stand ist **QS-freigegeben (54/54 dynamische Checks + 9/9 Migrationstests, keine Findings)** und wird als v0.8.0 deployed.

- **Stammdaten:** Code (normalisiert, eindeutig), Bezeichnung, Beschreibung, Aktivstatus und Nutzungszähler.
- **Zuordnung:** Fahrzeuge, Fahrer:innen und Benutzerkonten können eine Kostenstelle als Default tragen.
- **Defaults:** Buchung/Anfrage: explizit > Fahrer:in > Fahrzeug > Benutzerkonto > NULL. Kosten: explizit > Fahrzeug > Benutzerkonto > NULL. Bestehende Buchungen/Kosten bleiben als Snapshot unverändert.
- **Rechte:** `cost_centers_view` und `cost_centers_manage`; die Fuhrparkleitung erhält beide per Migration, Administrator automatisch. SMTP bleibt davon unberührt.
- **Löschen:** nur ohne Referenzen; sonst 409 mit Hinweis auf Deaktivieren.
- **Export:** JSON mit Kostenstellen-IDs/Code/Name; CSV-Fahrtenbuch mit Spalte `Kostenstelle` am Ende und optionalem Filter.
- **Migration:** `user_version = 6`.

Details: [Feature-Doku v0.8.0 Paket 2](FEATURE_DOKU_v0.8.0_Paket2.md).

## Release v0.7.1

UI-Fix: Der Info-Banner „Superadmin ist datei-verwaltet“ auf der Seite **Rollen & Rechte** wurde entfernt. Rollenverwaltung, Rechte, Objekt-Ausnahmen und der Systemschutz des Superadmins bleiben unverändert.

## Release v0.7.0 (Paket 1)

Paket 1 führt die Leasingüberwachung und den E-Mail-Versand ein. Der Stand ist **QS-freigegeben (51/51 Checks, keine Findings)** und wird als v0.7.0 deployed. Paket 2 (Kostenstellen) und Paket 3 (Dark Mode) liegen ausschließlich als Design/Estimate vor.

- **Leasing:** Start/Ende, Startkilometer und Gesamt-Kilometerlimit pro Fahrzeug; Bestandsfahrzeuge ohne Leasing bleiben unverändert.
- **Warnungen:** 80/90/100 % Kilometerverbrauch und 90/30 Tage vor Leasingende in Fahrzeugliste, Fahrzeugdetails, Dashboard/Benachrichtigungen und bei Buchungen – als Hinweis, ohne Blockade.
- **E-Mail:** SMTP-Konfiguration nur für Administrator:innen; Versand an aktive Fuhrparkleitung und Administration; Dedupe pro Fahrzeug/Schwelle/Leasingzeitraum; Fehlversuche mit begrenztem Retry.
- **Sicherheit:** SMTP-Passwort ausschließlich in `smtp-secret.json` im Datenverzeichnis (0600), nie in State, Export, Audit oder Logs.
- **Migration:** `user_version = 5`.

Details: [Feature-Doku v0.7.0 Paket 1](FEATURE_DOKU_v0.7.0_Paket1.md).

## Release v0.6.0

v0.6.0 bündelt Etappe 2 (Own Trips, Buchungsanfragen, dauerhafte Fahrzeug-Sperre) und das Audit-Paket. Beide Pakete sind QS-verifiziert; der integrierte Stand `4a18ec2` ist die Release-Basis.

- **Own Trips:** 1:1-Verknüpfung von Fahrer:innen und Benutzerkonten, schlanke Ansicht „Meine Fahrten“, Default-Rechte über `own_trips_access`.
- **Buchungsanfragen:** `booking_requests_manage`, Rollen-Policy und Rang-Gate, keine Selbstgenehmigung, transaktionale Genehmigung mit Doppelbelegungscheck.
- **Fahrzeug-Sperre:** dauerhaft gesperrte Fahrzeuge verursachen 409 bei neuen Buchungen und Buchungsanfragen; bestehende Buchungen bleiben unverändert.
- **Audit-Log:** Self-only ohne Audit-Recht, Rangbereich mit `audit_view`, alle Einträge mit `audit_view_all` – ohne Switch; Suche/Filter, Maskierung, Meta-Audit und Pagination.
- **Oberfläche:** Zahnrad als zentraler Settings-Einstieg; Sidebar-Fix `d69755b`.

Details, Migration und bekannte Einschränkungen: [Release Notes v0.6.0](RELEASE_NOTES_v0.6.0.md).

## Release v0.6.1

v0.6.1 ergänzt Own-Trip-Actions, Superadmin (Etappe 3) und den UI-Berechtigungs-Fix inklusive Admin-Self-Driver-Link. QS-Freigabe: JA, keine Findings; DEV-Basis `506b9f0`.

- **Own-Trip-Actions:** `own_trips_execute`; eigene geplante Fahrten starten, aktive beenden; Fremd-/Unverknüpft-Kontexte 403.
- **Superadmin:** dateibasiert über `SUPERADMIN_FILE`, bcrypt-Hash, Rank 2.000.000, systemgeschützt und in der UI vollständig ausgeblendet; Admin-Verwaltung nur durch Superadmin; fehlende/ungültige Datei sperrt nur den Superadmin-Login.
- **UI-Fix:** Sidebar ohne Flash unerlaubter Einträge; Settings nur mit erlaubten Karten; Admin kann ausschließlich sein eigenes Fahrerprofil verknüpfen.
- **Migration:** `user_version = 4`.

Details: [Release Notes v0.6.1](RELEASE_NOTES_v0.6.1.md) · [Feature-Doku v0.6.1](FEATURE_DOKU_v0.6.1.md).

## Release v0.6.2

v0.6.2 ist ein UI-/Text-Patch: doppelt kodierte UTF-8-Texte in Frontend, README und ausgewählten Hilfsskripten wurden verlustfrei repariert. Keine Rechte-, Datenbank- oder API-Änderung.

Details: [Release Notes v0.6.2](RELEASE_NOTES_v0.6.2.md).

> **Hinweis zum Fahrtenbuch:** Historische Nachtragungen dürfen einen Startkilometer unter dem aktuellen Fahrzeugstand haben. Die Oberfläche zeigt in diesem Fall einen Hinweis, blockiert das Speichern aber nicht; der Fahrzeugstand wird nur angehoben, wenn der eingetragene Endkilometer höher liegt.

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

### Tests

Die Integrationstests laufen mit einer temporären SQLite-Datenbank und einem zufälligen Loopback-Port; Produktivdaten und echte Zugangsdaten werden nicht verwendet:

```bash
node --test
```

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
| Superadmin | Sonderrolle mit Rang 2.000.000, systemgeschützt, ausschließlich über die Superadmin-Datei konfiguriert; nicht über UI/API anlegbar, zuweisbar, änderbar oder löschbar |
| Administrator | Alle Fuhrparkfunktionen, Einstellungen sowie Benutzer- und Rollenverwaltung; immer vollständig, systemgeschützt und nicht über die Benutzerverwaltung vergebbar |
| Fuhrparkleitung | Standardrolle mit allen Fuhrparkfunktionen, Einstellungen, den delegierten Rechten `users_manage`/`roles_manage` sowie `audit_view` (ohne `audit_view_all`); Rechte, Rang und Objekt-Ausnahmen können angepasst werden |
| Standardbenutzer | Minimale Rolle für eigene Fahrten (`own_trips_view/request/execute`); systemgeschützt, Rang 10.000, für JIT-SSO-Konten mit automatisch verknüpftem Fahrerprofil |
| Eigene Rollen | Frei anlegbare Rollen mit individuellem Rang, Modulrechten und Objekt-Ausnahmen |

Konten mit `users_manage` können Benutzer anlegen, bearbeiten, deaktivieren, anonymisieren, Benutzer-Ausnahmen pflegen und Fahrer-Konten verknüpfen. Konten mit `roles_manage` verwalten Rollen, Ränge, Objekt-Ausnahmen und die Buchungsanfrage-Policy. Beide Rechte sind getrennt vergebbar. Die Fuhrparkleitung erhält zusätzlich `booking_requests_manage`. Jede Person kann ihr eigenes Passwort unter **Einstellungen** ändern – ausgenommen der Superadmin, dessen Passwort ausschließlich aus der Datei stammt.

### Superadmin

Der Superadmin ist die oberste Verwaltungsinstanz. Er kann Administratorkonten anlegen, bearbeiten, deaktivieren, herabstufen, Passwörter zurücksetzen und nach der Deaktivierung anonymisieren, aber niemals sich selbst, einen zweiten Superadmin oder die Superadmin-Rolle verwalten. Eine Löschroute für Konten gibt es nicht; mindestens ein aktives Administratorkonto bleibt geschützt. Der Superadmin zählt nicht als „letzter aktiver Admin“.

- **Datei:** Pfad über `SUPERADMIN_FILE`. Docker-Default ist `/run/secrets/awo-superadmin.json`, außerhalb von Docker `/etc/awo-fuhrpark/superadmin.json`. Die Datei muss außerhalb von Repository, persistentem Daten-Volume und Backup liegen und sollte `root:root` mit `0600` gehören.
- **Format:** JSON mit den Pflichtfeldern `email`, `name` und `passwordHash`. `passwordHash` ist ein bcrypt-Hash mit Cost 12; Klartextpasswörter werden nicht unterstützt. Der Hash wird offline erzeugt und niemals in Logs, Audit, Chat oder Dokumentation ausgegeben.
- **Bootstrap:** Beim Start wird nach Schema-/Rollenmigration ein Konto mit fester ID `superadmin`, der Rolle `superadmin` und `active=1` idempotent angelegt oder aktualisiert. Fehlt die Datei oder ist sie ungültig, wird nur gewarnt, ein vorhandenes Konto wird `active=0` gesetzt und der Superadmin-Login ist gesperrt; das System läuft normal weiter. Es gibt keinen Fallback auf einen alten Hash und keine Löschung oder Anonymisierung.
- **Rotation/Recovery:** Datei ersetzen und Dienst bzw. Container neu starten. Änderungen an E-Mail oder Hash sowie eine Reaktivierung invalidieren alle Superadmin-Sessions. Jede Änderung wird als `superadmin_update` ohne Secret auditiert; eine Sperrung als `superadmin_disabled`.
- **Schutz:** Keine UI-/API-Route zum Anlegen, Ändern oder Löschen des Superadmins. Das Konto ist in Benutzerliste und Datenexport vollständig ausgeblendet; die Rolle erscheint im Rollenbaum systemgeschützt mit Schloss. Superadmin-Ereignisse bleiben für berechtigte `audit_view_all`- und Administrator-Konten im Audit sichtbar.
- **MFA und Passkeys:** optional für alle Konten einschließlich Superadmin. Der Superadmin richtet TOTP und Passkeys wie jede andere Person selbst ein; bei Totalverlust greift der dokumentierte Betriebsweg über Superadmin-Datei/DB. Passkeys sind ein zweiter Faktor, kein passwordless Login.

Beispiel für die Dateistruktur (Werte ersetzen; kein echter Hash im Repository):

```json
{
  "email": "superadmin@example.org",
  "name": "Superadmin",
  "passwordHash": "<bcrypt-Hash mit Cost 12>"
}
```

Für Docker die Datei read-only unter dem Default-Pfad einbinden, zum Beispiel:

```yaml
services:
  app:
    volumes:
      - /etc/awo-fuhrpark/superadmin.json:/run/secrets/awo-superadmin.json:ro
```

Das Verzeichnis muss für den Anwendungsbenutzer lesbar sein, ohne dass Klartext oder Hashes in Logs gelangen. Bei unsicheren Datei-/Verzeichnisrechten oder einem Pfad innerhalb von Repository/Volume warnt der Start, bricht aber nicht ab. Der Container läuft als Benutzer `node`; die Datei muss daher entweder für diesen Benutzer lesbar sein oder der Betrieb muss die Eigentümer-/Gruppenrechte entsprechend kontrolliert setzen.

### Delegierte Verwaltung und Rangfolge

- Jede Rolle hat einen ganzzahligen Rang; höher bedeutet mächtiger. Gleichstände (Ties) sind erlaubt, aber Rollen und Konten gleichen Rangs können sich gegenseitig nicht verwalten.
- Superadmin (Rang 2.000.000, ausschließlich datei-verwaltet), Administrator (Rang 1.000.000) und Fuhrparkleitung (Rang 900.000) sind vorbelegt. Bestehende eigene Rollen starten bei 100.000 + Index, also unterhalb der Fuhrparkleitung.
- Nicht-Administratoren sehen nur die eigene sowie strikt niedrigere Ränge. Die eigene Rolle und das eigene Konto sind nicht über die Verwaltung bearbeitbar; das eigene Passwort bleibt unter **Einstellungen** änderbar.
- Neue Rollen und Rangänderungen müssen strikt unterhalb des eigenen Rangs liegen. Die Untergrenze für neu vergebene Ränge ist **1**; Rang 0 ist kein gültiger neuer Rollenrang. Rollen mit zugewiesenen Konten oder Systemrollen können nicht gelöscht werden.
- **Grant Ceiling:** Nicht-Administratoren können nur Rechte weitergeben, die sie selbst effektiv global besitzen. Rollen mit Admin-only-Rechten (z. B. `branding_manage`) bleiben für sie gesperrt. Objektbezogene Sonderrechte zählen nicht als Grundlage für die Weitergabe.
- Die Weitergabe von `users_manage` und `roles_manage` an strikt niedrigere Rollen ist erlaubt; jede Delegationsstufe bleibt an Rang und Grant Ceiling gebunden.
- Der Widerruf ist **isoliert**: Entzieht eine übergeordnete Rolle ihre Verwaltungsrechte, bleiben bereits an untere Rollen vergebene Rechte bestehen. Der obere Rang kann sie bei Bedarf direkt bei den unteren Rollen entziehen; eine automatische Kaskade gibt es nicht.
- Administratorkonten und die Administrator-Rolle sind geschützt. Administratoren können keine anderen Administratoren bearbeiten, deaktivieren oder zu Administratoren befördern. Nur der Superadmin verwaltet Administratorkonten; er kann sie herabstufen, deaktivieren und nach der Deaktivierung anonymisieren. Eine Löschroute gibt es nicht. Mindestens ein aktives Administratorkonto bleibt geschützt; das Superadmin-Konto ist von der Anonymisierung ausgenommen.
- Änderungen an Rollen und Konten werden transaktional ausgeführt und auditiert.

### Fahrtenbuch-Rechte

- `logbook_view` und `logbook_export` öffnen ausschließlich das Fahrtenbuch mit abgeschlossenen Fahrten. Sie geben keinen Zugriff auf die allgemeine Buchungsverwaltung oder die vollständigen Fahrzeug-/Fahrer-Stammdatenseiten.
- Fahrzeug- und Fahrername werden im Fahrtenbuch als minimale Referenz mitgeliefert, damit die Tabelle und der CSV-Export lesbar bleiben.
- `logbook_manage` (Fahrten nachtragen) setzt zusätzlich die Fahrzeug- und Fahreransicht voraus, damit eine Fahrt ausgewählt werden kann.
- Historische Nachträge dürfen unter dem aktuellen Fahrzeugkilometerstand liegen; die UI zeigt einen Hinweis, blockiert aber nicht.

### Rechte-Hierarchie

Die Rechte werden in dieser Reihenfolge aufgelöst, von der spezifischsten zur allgemeinsten Regel:

1. **Benutzer-Objekt-Ausnahme** – gilt für genau ein Objekt und einen Benutzer.
2. **Benutzer-Modul-Ausnahme** – gilt für einen Benutzer und ein Modul.
3. **Rollen-Objekt-Ausnahme** – gilt für genau ein Objekt und eine Rolle.
4. **Rollenrecht** – gilt für die gesamte Rolle.

Auf derselben Ebene gewinnt bei Konflikten die Verweigerung. Eine Objekt-Ausnahme kann ein Recht erlauben oder verweigern, auch wenn das Rollenrecht anders lautet. Die Administrator-Rolle ignoriert Benutzer-Ausnahmen und bleibt immer vollständig.

Für `own_trips_view` und `own_trips_request` gibt es eine zusätzliche unterste Ebene: den Fahrer-Default bei aktiver Konto-Verknüpfung und `own_trips_access=1`. Er greift nur, wenn keine explizite Benutzer- oder Rollenregel entscheidet. Die Reihenfolge lautet daher: Benutzer-Objekt → Benutzer global → Rollen-Objekt → Rollenrecht → Fahrer-Default.

### Objekt-Ausnahmen

Unter **Rollen & Rechte → Objekt-Ausnahmen** lassen sich pro Rolle und Objekt einzelne Aktionen auf **Standard**, **Erlauben** oder **Verweigern** stellen. Unterstützt werden:

- Fahrzeuge
- Fahrer:innen
- Buchungen
- Kostenpositionen
- Wartungen

Die Einstellungen gelten serverseitig für Datenanzeige und Aktionen. Ein Benutzer sieht ein Objekt nur, wenn die effektive Berechtigung es zulässt; die gleiche Prüfung greift bei Bearbeitung, Buchung, Kosten, Wartung und Belegen.

### Benutzer-Ausnahmen

Unter **Benutzer → Benutzer-Ausnahmen** können Personen mit `users_manage` persönliche Modul- und Objekt-Ausnahmen pflegen, soweit Rang und Grant Ceiling dies zulassen. Diese haben Vorrang vor den Rollenrechten. Beim Wechsel in die Administrator-Rolle oder bei der Anonymisierung werden persönliche Ausnahmen entfernt.

### Eigene Fahrten und Buchungsanfragen

- Fahrer:innen können mit einem Benutzerkonto verknüpft werden. Ein Konto gehört höchstens zu einem Fahrerprofil; Bestandsfahrer:innen bleiben unverknüpft.
- Die Verknüpfung und der Schalter **Standardzugriff auf „Meine Fahrten“** (`own_trips_access`) werden über die Benutzerverwaltung gepflegt (`users_manage`). Ein Wechsel der Verknüpfung und jede Änderung des Standardzugriffs wird auditiert.
- Bei aktiver Verknüpfung und `own_trips_access=1` erhalten Konten standardmäßig `own_trips_view` und `own_trips_request`. Der Standard liegt unter allen expliziten Benutzer- und Rollenregeln. `own_trips_access=0` schaltet nur diesen Standard ab; explizite Erlaubnisse können ihn wieder aktivieren.
- **Meine Fahrten** ist eine schreibgeschützte Ansicht für die eigenen geplanten, aktiven und abgeschlossenen Buchungen sowie die eigenen Anfragen. Sie enthält keine fremden Daten, keine Stammdatenverwaltung und keinen Export. Für Buchungsanfragen wird nur eine minimale Fahrzeugliste bereitgestellt.
- Verknüpfte Fahrer:innen mit explizitem `bookings_create` dürfen weiterhin direkt buchen. Ohne dieses Recht können sie ausschließlich Buchungsanfragen stellen.
- Eine Buchungsanfrage wird mit Status `requested` gespeichert und reserviert **kein** Fahrzeug. Ein Konflikt mit vorhandenen Buchungen wird beim Stellen nur als Warnung angezeigt.
- Berechtigte mit `booking_requests_manage` (Standard Fuhrparkleitung) sehen offene Anfragen nur von Rollen **strikt unterhalb** ihres Rangs. Die Rollen-Policy `allow`/`deny` filtert zusätzlich; eine leere Allow-Liste bedeutet „alle zulässigen unteren Rollen“, Deny gewinnt. Eigene Anfragen können nicht selbst entschieden werden.
- Die Genehmigung ist transaktional: Sie prüft den Status erneut, legt genau eine geplante Buchung an und setzt `booking_id`. Bei einem Fahrzeug- oder Fahrer:innen-Konflikt antwortet der Server mit `409`, die Anfrage bleibt offen. Ein zweiter Genehmigungsversuch wird mit `409` abgelehnt.
- Ablehnen ist mit optionaler Begründung möglich. Zurückziehen kann nur die antragstellende Person und nur im Status `requested`.
- Wird das anfragende Konto deaktiviert oder anonymisiert, werden offene Anfragen automatisch storniert und auditiert. Bereits entschiedene oder gebuchte Anfragen bleiben erhalten; bei der Anonymisierung wird die Fahrer-Konto-Verknüpfung entfernt.
- Create, Approve, Reject und Cancel werden auditiert. E-Mail-/Teams-Benachrichtigungen sind noch nicht enthalten.

### Dauerhafte Fahrzeug-Sperre

- Fahrzeuge können über die Fahrzeugverwaltung (`vehicles_manage`) dauerhaft gesperrt und wieder entsperrt werden. Eine Begründung ist optional und wird in Liste, Detailansicht und Auswahl angezeigt.
- Setzen und Aufheben der Sperre werden ebenso wie die Begründung auditiert.
- `POST /api/bookings` und `POST /api/booking-requests` antworten für ein gesperrtes Fahrzeug mit `409` und einer klaren Meldung. Eine Buchungsanfrage kann nach einer späteren Sperre nicht mehr genehmigt werden; sie bleibt offen.
- Bestehende Buchungen bleiben unverändert. Fahrtstart, Fahrtende und Stornierung unterliegen weiterhin den bisherigen Regeln und werden durch die Sperre nicht blockiert.
## Gesellschaften und Kostenstellen

- **Gesellschaften** sind ein Stammdatum unter **Einstellungen → Gesellschaften** (Code, Name, aktiv). Codes sind global eindeutig; Kostenstellencodes nur je Gesellschaft.
- Bestehende Kostenstellen werden bei Migration 17 der Standardgesellschaft (`STANDARD`, Name aus `ORG_NAME`) zugeordnet. Der bisherige globale Unique-Index auf `cost_centers.code` wird durch `UNIQUE (company_id, code COLLATE NOCASE)` ersetzt; IDs und Zuordnungen bleiben unverändert.
- Kostenstellen haben eine Pflicht-Gesellschaft. API und UI prüfen Duplikate je Gesellschaft case-insensitiv; Fehlermeldung: „Eine Kostenstelle mit diesem Code existiert in dieser Gesellschaft bereits.“
- Dropdowns zeigen `Gesellschaft · Code · Name`. Die Kostenstellenliste bietet Gesellschaftsfilter und Suche nach Code/Name; JSON-Export und Fahrtenbuch-CSV enthalten die Gesellschaft.
- **Keine Mandantentrennung:** Fahrzeuge, Benutzer, Buchungen und Kosten bleiben gesellschaftsneutral. Alle Berechtigten sehen alle Gesellschaften und Kostenstellen.
- `GET /api/companies` ist für `cost_centers_view`/`cost_centers_manage` lesbar; Anlegen/Ändern/Löschen erfordert `settings_manage`. Löschen ist nur ohne Kostenstellen möglich.

## Fahrzeugstatus und Eigentum/Leasing

- **Eigentum/Leasing:** `vehicles.ownership_type` (`owned`/`leasing`), Default `owned`. Bei `owned` werden vorhandene Leasingfelder gespeichert, aber ignoriert; es entstehen keine Leasingwarnungen oder -benachrichtigungen. Die Migration ordnet Fahrzeuge mit Leasingfeldern automatisch `leasing` zu.
- **Status:** `available` (Verfügbar), `in_use` (Unterwegs), `maintenance` (In Wartung), `defect` (Defekt), `sold` (Veräußert), `not_drivable` (Nicht fahrbereit).
- **Nicht buchbar:** `maintenance`, `defect`, `sold`, `not_drivable` sowie dauerhaft gesperrte Fahrzeuge. `in_use` bleibt für zukünftige Zeiträume buchbar. Buchungsanlage, Buchungsanfrage, Genehmigung und Fahrtstart liefern `409` mit statusbezogener Meldung.
- **Buchungsabschluss:** Setzt `maintenance`/`defect`/`sold`/`not_drivable` nicht auf verfügbar zurück; nur `in_use` wird zu `available` (bzw. `in_use` bei paralleler aktiver Fahrt).
- **UI:** Eigentum/Leasing als Radio-Toggle; Leasingfelder werden bei Eigentum ausgeblendet, aber nicht gelöscht. Statusfilter und Dropdowns kennen alle sechs Werte; nicht buchbare Fahrzeuge sind in Buchungs-/Anfrage-Dropdowns deaktiviert. Karten und Detailansicht zeigen Status- und Eigentums-Badge.
- Keine Änderung an Werkstatt-, Kosten- oder Buchungslogik außer den Statusprüfungen.

## Audit-Log

Das Audit-Log ist für **alle angemeldeten Nutzer** unter **Audit-Log** erreichbar. Der sichtbare Bereich wird ausschließlich serverseitig bestimmt:

| Berechtigung | Sichtbarer Bereich |
| --- | --- |
| keine Audit-Berechtigung | ausschließlich eigene Aktionen |
| `audit_view` | eigene Aktionen und Aktionen von Personen mit strikt niedrigerem Rang |
| `audit_view_all` | alle Aktivitäten, einschließlich Meta-, System- und Superadmin-Einträgen |

- `audit_view_all` schließt `audit_view` ein und ist innerhalb von Rangfolge und Grant Ceiling delegierbar. Es gibt keinen Umschalter und keinen `all`-Parameter.
- Rolle und Rang werden beim Schreiben als Snapshot gespeichert; spätere Rollen- oder Rangänderungen wirken nicht rückwirkend.
- Die Fuhrparkleitung erhält durch die Migration einmalig `audit_view`, nicht `audit_view_all`. Wird das Recht später entzogen, bleibt der Entzug bestehen.
- Suche und Filter (`q`, Akteur:in, Aktion, Zieltyp, Ziel, Zeitraum, Seite) arbeiten nur auf dem bereits serverseitig eingeschränkten Bereich. Gesucht wird ausschließlich in freigegebenen Feldern, nicht in rohen `details`.
- Ziel-Labels erscheinen nur bei vorhandener Objektberechtigung; andernfalls werden Zieltyp und gekürzte ID angezeigt. Details werden als serverseitig erzeugte Allowlist (`detailsSummary`) ausgeliefert. Passwörter, Hashes, Tokens, Cookies, Session-IDs und IP-Adressen werden weder gespeichert noch ausgeliefert.
- Eigene Einträge sind unmaskiert. Bei fremden Einträgen mit `audit_view` werden E-Mail-Adresse und Telefonnummer maskiert; `audit_view_all` zeigt sie unmaskiert.
- Lesezugriffe auf das Audit-Log werden als Meta-Einträge ohne Inhalte der gelesenen Einträge protokolliert. Meta-Einträge sind nur für `audit_view_all` und Administrator:innen sichtbar.
- Retention, Export und Löschung bleiben unverändert: Es gibt in dieser Version keine Lösch-, Rotations- oder Exportfunktion für Audit-Einträge.

Die Migrationen sind idempotent und führen die Datenbank auf `user_version = 18`: Die Audit-Migration ergänzt Snapshot-Spalten und Indizes und befüllt bestehende Einträge nach; die Superadmin-Migration legt die systemgeschützte Rolle `superadmin` mit Rang 2.000.000 an; die Leasing-Migration ergänzt Fahrzeug-Leasingfelder, SMTP-Einstellungen und die Dedupe-Tabelle für Benachrichtigungen; die Kostenstellen-Migration ergänzt `cost_centers`, die Zuordnungsfelder und die Manager-Rechte; die Dark-Mode-Migration ergänzt `users.color_mode` und `settings.default_color_mode`; die MFA-Migration ergänzt `user_mfa` und `mfa_recovery_codes`; die Passwort-Reset-Migration ergänzt `password_reset_tokens`; die Passkey-Migration ergänzt `user_passkeys` und `passkey_attempts`; die SSO-Migration ergänzt `user_sso`; die Retention-Migration ergänzt die vier Retention-Spalten in `settings`; die Standort-Migration ergänzt `locations` sowie `users.location_id` und `vehicles.location_id`; die Integrations-Migration ergänzt `integration_settings` mit einer Zeile; die Advanced-Migration ergänzt `app_base_url` und die Scheduler-Parameter; die Webhook-Migration ergänzt `webhooks` und übernimmt einen vorhandenen DB-Teams-Webhook; die Gesellschafts-Migration ergänzt `companies`, ordnet bestehende Kostenstellen der Standardgesellschaft zu und setzt den Unique-Index auf `(company_id, code)`; die Fahrzeug-Migration ergänzt `vehicles.ownership_type`, erweitert den Status-CHECK und rebuildet die Tabelle inklusive Fremdschlüsseln und Indizes. Das Superadmin-Konto selbst wird ausschließlich aus der Datei gebootstrappt.

## Leasing und E-Mail

- Leasingdaten werden im Fahrzeugdialog gepflegt. Ohne Leasingende und Kilometerlimit bleibt ein Fahrzeug außerhalb der Überwachung.
- Warnschwellen: 80 %, 90 % und 100 % des Kilometerlimits sowie 90 und 30 Tage vor Leasingende. Die Hinweise erscheinen in der Fahrzeugliste, in den Fahrzeugdetails, im Dashboard/Benachrichtigungsbereich und beim Buchen. Sie blockieren keine Buchung.
- E-Mails gehen an aktive Konten der Rollen **Administrator** und **Fuhrparkleitung**. Es wird pro Fahrzeug, Schwelle und Leasingzeitraum höchstens einmal versendet; Fehlversuche werden bis zu dreimal mit Wartezeit wiederholt.
- Der Scheduler prüft beim Start und anschließend alle sechs Stunden. Nach Kilometeränderungen (Fahrzeugbearbeitung, Fahrtende, Nachtragung) wird zusätzlich eine gedebouncte Prüfung ausgelöst. In Tests oder Sonderfällen kann er mit `LEASING_SCHEDULER_DISABLED=true` deaktiviert werden.
- SMTP-Einstellungen sind nur für Administrator:innen sichtbar und änderbar. Das Passwort wird **nicht** in der Datenbank, im State, im Export oder im Audit gespeichert, sondern ausschließlich in `smtp-secret.json` im Datenverzeichnis (Dateirechte 0600 auf Linux). Das Backup-Skript sichert Datenbank und Uploads, **nicht** die Secret-Datei; nach einer Wiederherstellung muss das SMTP-Passwort neu gesetzt werden. Die Test-E-Mail geht an die angemeldete Administrator:in.
- Ohne aktivierte und vollständige SMTP-Konfiguration wird keine Mail versendet; die Anwendung bleibt funktionsfähig.
- **Buchungsanfragen:** Beim Eingang werden aktive Administrator:innen, Fuhrparkleitung und Konten mit `booking_requests_manage` informiert. Bei Genehmigung oder Ablehnung erhält die anfragende Person eine Entscheidungsmail. Dedupe verhindert Doppelversendungen; Mailfehler blockieren die API-Aktion nicht.
- **Wartung/TÜV:** Der Scheduler erinnert 30, 14 und 7 Tage vor Fälligkeit sowie bei Überfälligkeit an offene Wartungen, HU/AU und Service/Inspektion. Empfänger sind aktive Administrator:innen und Fuhrparkleitung; Dedupe gilt pro Fahrzeug/Typ/Schwelle. Die Prüfung läuft beim Start und anschließend alle sechs Stunden und kann mit `REMINDER_SCHEDULER_DISABLED=true` deaktiviert werden.

## Datenaufbewahrung / Retention (optional)

Administrator:innen können unter **Einstellungen → Datenaufbewahrung** vier technische Fristen setzen; `0` deaktiviert die jeweilige Kategorie:

- `audit_retention_days` – Audit-Log
- `session_retention_days` – abgelaufene Sessions
- `password_reset_retention_days` – Passwort-Reset-Tokens
- `notification_retention_days` – Benachrichtigungs-Deliveries (E-Mail/Teams)

Der Scheduler läuft standardmäßig täglich (deaktivierbar mit `RETENTION_SCHEDULER_DISABLED=true`). Ein Dry-Run in der UI zählt nur die betroffenen Datensätze, ohne zu löschen. Jeder Lauf mit Löschungen wird als `retention_cleanup` mit Kategorienzahlen auditiert.

**Wichtig:** Buchungen, Kosten, Fahrtenbuch, Fahrzeuge, Fahrer:innen und Benutzerkonten werden durch diese Retention **nicht** automatisch gelöscht. Eine Löschung dieser Geschäftsdaten bleibt einer rechtlichen Entscheidung und einem separaten Auftrag vorbehalten.

## Virenprüfung für Uploads (optional)

Mit `VIRUS_SCAN_ENABLED=1` werden PDF-Belege und Bilder vor dem Speichern über clamd INSTREAM geprüft.

- `CLAMAV_HOST`, `CLAMAV_PORT` (Standard `3310`), Timeout 10 Sekunden.
- `VIRUS_SCAN_FAIL_CLOSED=true` (Standard bei aktivierter Prüfung) lehnt Uploads bei Scannerfehlern oder Timeout ab; `false` erlaubt sie mit Warnung.
- Befund oder Fail-Closed: HTTP `422` mit „Upload wurde aus Sicherheitsgründen abgelehnt.“, Audit `upload_blocked` mit Kategorie/Reason, keine Dateiinhalte in Logs.
- Ohne aktivierte Prüfung bleibt der Uploadpfad unverändert; PDF-/Logo-/Bildgrößenlimits bleiben bestehen.
- ClamAV ist nicht im Repository enthalten und muss als Dienst betrieben werden.

## Integrationen (Admin)

Unter **Einstellungen → Integrationen** bündelt die Anwendung SSO, Teams, ClamAV, WebAuthn, Retention und die Standortfunktion. Voraussetzung ist `settings_manage` (Administrator:innen und Fuhrparkleitung).

- **ENV-Vorrang:** Ist eine Variable gesetzt und nicht leer, gewinnt sie gegenüber der Datenbank. Das Feld erscheint schreibgeschützt mit „durch Umgebung gesetzt“. Nicht gesetzte Variablen werden aus der Datenbank gelesen.
- **Sofort wirksam:** Die Konfiguration wird pro Anfrage gelesen; Änderungen benötigen keinen Neustart.
- **Secrets:** SSO-Client-Secret und Teams-Webhook werden mit AES-256-GCM verschlüsselt in `integration_settings` gespeichert. Der Schlüssel kommt aus `INTEGRATIONS_ENCRYPTION_KEY` oder wird als `DATA_DIR/integrations.key` erzeugt (Dateirechte `0600`). **DB und Schlüsseldatei gehören zusammen** und müssen gemeinsam gesichert werden; ohne Schlüssel sind die Secrets nicht entschlüsselbar.
- **Keine Secret-Ausgabe:** API, State, Export und Audit enthalten nur `clientSecretSet`/`webhookSet` sowie Quellenangaben. Secret-Felder sind maskiert; Änderungen nur durch Eingabe eines neuen Werts, Entfernen über „Secret entfernen“.
- **Testfunktionen:** SSO prüft Discovery und JWKS ohne Login, Teams sendet eine Testkarte, ClamAV scannt eine harmlose Testdatei, WebAuthn validiert RP-ID und Origins lokal.
- **Retention:** Die bisherige Karte ist in die Integrationsseite integriert; `0 = aus` bleibt unverändert, Geschäftsdaten werden nicht gelöscht.
- **Standorte:** `LOCATIONS_ENABLED` ist als Feature-Toggle enthalten, inklusive Hinweis auf Sichtbarkeit und Freigaberouting.

Änderungen an RP-ID/Origin können bestehende Passkeys ungültig machen; die Seite warnt davor. Infrastruktur- und Bootstrap-Werte (`SESSION_SECRET`, `DATA_DIR`, `PORT`, `HOST`, `SUPERADMIN_FILE`, `MFA_ENCRYPTION_KEY`, `TRUST_PROXY`, `COOKIE_SECURE`, `NODE_ENV`) bleiben ausschließlich ENV-verwaltet.

## Webhooks (Admin)

Unter **Einstellungen → Integrationen → Webhooks** lassen sich mehrere Endpunkte verwalten. Die Liste ist die primäre Oberfläche; die Teams-Karte bleibt als **Legacy/Preset** für `TEAMS_WEBHOOK_URL` erhalten.

- **Formate:** `generic` (`event`, `title`, `text`, `timestamp`, `data`), `teams` (MessageCard), `discord` (`content`, max. 2.000 Zeichen) und `slack` (`text`).
- **Events:** Leasing, Buchungsanfragen und Wartung/TÜV pro Webhook abonnierbar; ein Test-Event steht für den Test-Button bereit.
- **URL und Secret:** Webhook-URL und optionales HMAC-Secret werden mit AES-256-GCM verschlüsselt (`integration_settings`-Schlüssel bzw. `DATA_DIR/integrations.key`). UI, State, Export und Audit zeigen nur `urlSet`, `secretSet` und den Hostnamen.
- **HMAC:** Bei gesetztem Secret werden `X-AWO-Timestamp`, `X-AWO-Event`, `X-AWO-Delivery` und `X-AWO-Signature: sha256=<hex>` über `${timestamp}.${body}` gesendet.
- **SSRF-Schutz:** Nur `http`/`https`; Hostnamen werden aufgelöst. Loopback-, private, Link-Local- und Metadaten-Adressen sind blockiert. Interne Ziele nur explizit über `WEBHOOK_ALLOW_PRIVATE_HOSTS` (kommagetrennte Hostnamen, exakt). Redirects werden manuell verfolgt (max. 2) und jedes Ziel erneut geprüft.
- **Zustellung:** Timeout 8 s, Antwort-Body wird max. 64 KB gelesen und verworfen, keine Response-Inhalte in Logs. Dedupe/Retry über `notification_deliveries` (`channel = webhook:<id>`, 6 h Retry, 15 min Pending-Timeout). Fehler blockieren API und Scheduler nicht.
- **Payloads:** keine E-Mail-Adressen/Empfängerlisten, keine Secrets; Empfänger nur als Anzahl in internen Audit-Einträgen.
- **Audit:** `webhook_added`, `webhook_updated`, `webhook_deleted`, `webhook_test`, `webhook_delivery` mit Status/Errorcode, ohne URL/Secret.
- **Migration:** Ein vorhandener DB-Teams-Webhook wird einmalig übernommen (Discord-Hosts → `discord`, sonst `teams`) und aus `integration_settings` entfernt, damit nichts doppelt gesendet wird. `TEAMS_WEBHOOK_URL` bleibt als ENV-Fallback aktiv; nach der Übernahme die ENV-Variable entfernen, sonst sendet Teams weiterhin parallel.

## Erweitert (Admin)

Unter **Einstellungen → Erweitert** liegen Basis-URL und Scheduler-Parameter. Die Seite ist für `settings_manage` sichtbar; alle Karten sind standardmäßig eingeklappt.

- **APP_BASE_URL:** Öffentliche Basis-URL für Passwort-Reset-Links. Wird als http(s) validiert und ohne abschließenden Schrägstrich gespeichert. Ohne Wert nutzt die Anwendung die Host-Information der Anfrage; eine ENV-Variable hat Vorrang.
- **Leasing-Scheduler:** Aktiv-Schalter (invers zu `LEASING_SCHEDULER_DISABLED`), Intervall, Startverzögerung und Debounce. Minimum für Intervalle: 60.000 ms.
- **Wartungs-/TÜV-Scheduler:** Aktiv-Schalter (invers zu `REMINDER_SCHEDULER_DISABLED`), Intervall und Startverzögerung.
- **Retention-Scheduler:** Aktiv-Schalter (invers zu `RETENTION_SCHEDULER_DISABLED`), Intervall und Startverzögerung. Die Aufbewahrungsfristen selbst bleiben in der Retention-Karte unter **Integrationen**.
- **Sofortige Wirkung:** Nach dem Speichern werden die Scheduler ohne Prozessneustart neu gestartet. In `NODE_ENV=test` bleiben die Scheduler deaktiviert.
- **Systemstatus:** Zeigt `NODE_ENV`, `HOST`, `PORT`, `DATA_DIR`, `TRUST_PROXY`, `COOKIE_SECURE`, den Superadmin-Dateistatus sowie die Schlüsselquelle für MFA und Integrationen. Es werden keine Secrets oder Schlüsselwerte ausgegeben.
- **Warum ENV-only:** Diese Infrastruktur-, Bootstrap- und Sicherheitswerte betreffen Container, Datenverzeichnis und Schlüsselverwaltung. Sie sind bewusst nicht über die UI änderbar, damit eine kompromittierte Admin-Sitzung die Laufzeitumgebung nicht umkonfigurieren kann.

## Logging

- **Format:** `LOG_FORMAT=text|json` (Default `text`), `LOG_LEVEL=debug|info|warn|error` (Default `info`).
- **Request-Logs:** `LOG_REQUESTS=1` (DEV) bzw. `0` (Produktion). Pro Request werden Methode, Pfad ohne Query, Status, Dauer, Request-ID, User-ID/Rolle und maskierte IP geloggt. `X-Request-Id` wird gesetzt bzw. übernommen. Statische Assets, `/healthz` und `/branding/*` werden übersprungen.
- **Redaction:** Passwörter, Secrets, Tokens, Cookies, Authorization, CSRF, WebAuthn-Challenges, SSO-Codes/ID-Tokens, SMTP-Passwörter, Webhook-URLs, Session-IDs und E-Mail-Adressen werden nicht geloggt. Fehler werden auf `name`, `code`, `message`, `stack` reduziert.
- **Mail-Log:** `LOG_DIR` (DEV `C:\awo-fuhrpark-local\logs`, Default `DATA_DIR/logs`); `mail.log` protokolliert SMTP-/Teams-/Retention-Versuche mit Kanal, Event, Empfängeranzahl, Status, Fehlercode und Dauer – ohne Adressen, Betreffzeilen oder Secrets. Rotation bei 5 MB, `mail.log` + zwei Archive.
- **Startup:** loggt Version, `APP_COMMIT`, `user_version`, `DATA_DIR`, Port, `NODE_ENV`, Feature-Flags nur als `configured: true/false` sowie MFA-/Integrations-Schlüsselquelle (`env`/`file`/`missing`).
- **DEV:** In `C:\awo-fuhrpark-local\admin.env` sind `LOG_LEVEL=debug`, `LOG_REQUESTS=1`, `LOG_FORMAT=text` und `LOG_DIR` gesetzt. Der Supervisor rotiert `dev-app.log` und `dev-supervisor.log` vor dem Start bei > 10 MB (maximal 5 Dateien).
- **Sidecars:** `dev-http.log` und `mail-events.log` können übergangsweise parallel laufen; die Anwendung schreibt ausschließlich in `mail.log`, nicht in `mail-events.log`.
- **Audit bleibt fachlich:** Audit-Inhalte werden durch das Logging nicht verändert.

## Teams-Benachrichtigungen (Legacy/Preset)

Mit `TEAMS_WEBHOOK_URL` kann weiterhin ein Incoming-Webhook für Microsoft Teams konfiguriert werden. Für neue Endpunkte und Discord/Slack bitte **Einstellungen → Integrationen → Webhooks** verwenden; die Teams-Karte ist als Legacy/Preset markiert. Es wird kein Graph, keine App-Registration und kein Secret im Repository benötigt.

- Sendet MessageCards für Leasing-Warnungen, neue/entschiedene Buchungsanfragen und Wartungs-/TÜV-Erinnerungen.
- Ohne konfigurierte URL ist die Funktion ein No-op; Versandfehler blockieren weder API-Aktionen noch Scheduler.
- Dedupe erfolgt über `notification_deliveries` mit eigenem `teams:`-Kanal; die URL und Response-Inhalte werden nicht geloggt.
- Der Webhook ist ein Betriebsgeheimnis und gehört nicht in Repository, Audit oder Dokumentation.

## Passwörter ändern

- **Normale Benutzer und Admins:** **Einstellungen → Ihr Konto → Passwort ändern**. Das aktuelle Passwort und ein neues Passwort mit mindestens 10 Zeichen eingeben. Das Hashen übernimmt die Anwendung.
- **Passwort vergessen:** Auf der Loginseite führt **Passwort zurücksetzen** zu `/forgot-password`. Nach der Anfrage wird immer dieselbe generische Antwort angezeigt. Der Link ist 60 Minuten gültig, nur einmal verwendbar und beendet nach dem Setzen des neuen Passworts alle Sitzungen des Kontos. Voraussetzung für den Versand ist eine vollständige SMTP-Konfiguration und eine korrekte `APP_BASE_URL`.
- **Superadmin:** Kein UI-Passwortwechsel. Ein neues Passwort wird lokal mit bcrypt (Cost 12) gehasht und als `passwordHash` in der Superadmin-Datei eingetragen; anschließend Container/Service neu starten. Der Self-Service-Passwort-Reset gilt nicht für den Superadmin.

Der Helper gibt ausschließlich den bcrypt-Hash aus; das Passwort wird nicht gespeichert oder geloggt. Der Hash wird in `passwordHash` der Superadmin-Datei übernommen. Kein Klartextpasswort in die Datei schreiben.

Komplette Superadmin-Datei mit eigenem Passwort erzeugen:

```bat
scripts\superadmin-setup.cmd
```

oder:

```bash
npm run superadmin:setup
```

Der Wizard fragt E-Mail, Name und Passwort verdeckt ab und schreibt die JSON-Datei außerhalb des Repos (Standard: `C:\awo-fuhrpark-local\superadmin.json`). Voraussetzung nach einem GitHub-Download: `npm ci` im Projektordner, damit `bcryptjs` vorhanden ist.

**Ein-Befehl-Installer auf dem Linux-Server** (kein manuelles Kopieren oder separater Neustart):

```bash
cd /home/l-admin/awo-fuhrpark
sudo ./scripts/install-superadmin.sh
```

Der Installer fragt E-Mail, Name und Passwort verdeckt ab, sichert eine bestehende Datei, installiert sie mit restriktiven Rechten und erstellt den Container mit read-only Secret-Mount neu. Voraussetzung: `npm ci` wurde im Projektordner ausgeführt.

## Optionale Zwei-Faktor-Authentifizierung (TOTP)

Unter **Einstellungen → Sicherheit** kann jedes Konto freiwillig TOTP aktivieren:

1. **TOTP einrichten** öffnet QR-Code und manuelles Secret für eine Authenticator-App.
2. Nach Bestätigung eines 6-stelligen Codes werden **10 Recovery-Codes** einmalig angezeigt. Sie können kopiert oder als Textdatei gespeichert werden und sind danach nicht erneut abrufbar.
3. **Deaktivieren** und **Recovery-Codes neu ausgeben** verlangen einen aktuellen TOTP- oder Recovery-Code.
4. Beim Login erscheint nach korrektem Passwort nur bei aktivierter MFA bzw. hinterlegten Passkeys die Seite `/login/mfa` mit TOTP-, Recovery- und Passkey-Option.

Sicherheitsregeln: maximal 5 Fehlversuche pro 15 Minuten, danach 15 Minuten Sperre; TOTP akzeptiert ±1 Zeitschritt und verhindert Replay; Recovery-Codes sind einmalig. Administrator:innen können MFA für Konten mit strikt niedrigerem Rang zurücksetzen, der Superadmin für jedes Konto. Dabei werden die Ziel-Sitzungen beendet und ein Audit-Eintrag ohne Geheimnisse geschrieben.

Der Schlüssel liegt in `MFA_ENCRYPTION_KEY` oder automatisch in `DATA_DIR/mfa.key` (0600). **Schlüssel und Datenbank gemeinsam sichern:** Bei Schlüsselverlust sind bestehende TOTP-Secrets nicht mehr entschlüsselbar und müssen per Admin-Reset neu eingerichtet werden.

## Optionale Passkeys (WebAuthn)

Passkeys sind ein optionaler zweiter Faktor nach korrektem Passwort. Es gibt **kein passwordless Login**; TOTP und Recovery-Codes bleiben als Fallback verfügbar.

- Unter **Einstellungen → Sicherheit** können mehrere Passkeys hinzugefügt, umbenannt und entfernt werden. Vor dem Hinzufügen ist das aktuelle Passwort erforderlich.
- Der Login zeigt nach dem Passwort zusätzlich **Mit Passkey anmelden**, sofern Passkeys hinterlegt und WebAuthn im Browser verfügbar sind. Browser ohne WebAuthn blenden die Funktion aus.
- Registrierung und Login verlangen `userVerification: required`; Challenge, Origin und RP-ID werden serverseitig strikt geprüft. Ein Counter-Rückschritt entfernt den betroffenen Passkey als kompromittiert.
- Nach Entfernen eines Passkeys werden alle Sitzungen des Kontos beendet. Der Admin-Reset löscht Passkeys, TOTP und Recovery-Codes gemeinsam und auditiert `passkey_reset` ohne Credential-Daten.
- Konfiguration ausschließlich über `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_NAME` und `WEBAUTHN_ORIGIN` (kommagetrennt). Die Werte werden **nicht** aus dem Host-Header abgeleitet. Fehlt die Konfiguration, sind die Passkey-Endpunkte sauber deaktiviert.
- Die Challenge liegt ausschließlich in der Session, ist an das Konto gebunden, fünf Minuten gültig und einmalig. Credential-IDs, Public Keys und Challenges erscheinen nicht in State, Export, Audit oder Logs.

## SSO / Entra ID (optional)

SSO ist standardmäßig deaktiviert (`SSO_ENABLED` fehlt oder ist `0`). Der lokale Login bleibt immer verfügbar, insbesondere für den Superadmin.

- **Ablauf:** `/auth/sso/start` erzeugt State, Nonce und PKCE; `/auth/sso/callback` prüft State/Nonce, tauscht den Code ein und validiert das ID-Token strikt (Signatur über JWKS, Issuer, Audience, Ablauf, `email_verified` falls vorhanden, Domain-Allowlist).
- **Konto-Verknüpfung:** bestehende aktive Konten werden per E-Mail verknüpft. Mit `SSO_AUTO_PROVISION=true` werden unbekannte Konten mit `SSO_DEFAULT_ROLE` (Standard `user`) angelegt; bei der Standardrolle wird zusätzlich ein verknüpftes Fahrerprofil erstellt. Superadmin wird nie automatisch angelegt oder hochgestuft; Superadmin-, inaktive und anonymisierte Konten werden abgelehnt.
- **Gruppen:** `SSO_GROUP_CLAIM` (Standard `groups`) wird gegen `SSO_ADMIN_GROUP` und `SSO_MANAGER_GROUP` gemappt. Ohne Treffer bleibt die bestehende Rolle erhalten; JIT nutzt `SSO_DEFAULT_ROLE`.
- **Sicherheit:** State/Nonce/PKCE sind sessiongebunden, einmalig und 10 Minuten gültig. Sessions werden nach Erfolg regeneriert. Audit-Einträge `sso_login`, `sso_provision`, `sso_failed` enthalten keine Tokens, Codes oder Secrets.
- **Entra-App-Registrierung:** Redirect-URI exakt auf `SSO_REDIRECT_URI` setzen (z. B. `https://fuhrpark.example.org/auth/sso/callback`), Client-ID und Client-Secret hinterlegen, optional Token-/Group-Claims für `groups` konfigurieren. `SSO_ISSUER` ist der Tenant-Issuer (z. B. `https://login.microsoftonline.com/<tenant-id>/v2.0`). `SSO_ALLOWED_DOMAINS` beschränkt die zulässigen E-Mail-Domains; leer bedeutet keine zusätzliche Domain-Beschränkung.

## Standorte und Freigaberouting (optional)

`LOCATIONS_ENABLED=true` aktiviert Standort-Stammdaten und Zuordnungen. Ohne Flag bleibt das bisherige Verhalten unverändert.

- Administrator:innen verwalten Standorte unter **Einstellungen → Standorte**; Benutzer- und Fahrzeugformulare erhalten eine Standortauswahl.
- Sichtbarkeit: Administrator, Superadmin und Fuhrparkleitung bleiben global. Andere Konten mit Standort sehen nur Fahrzeuge, Buchungen, Wartungen, Kosten und Buchungsanfragen ihres Standorts; Fahrzeuge ohne Standort bleiben global sichtbar. Konten ohne Standort bleiben global (Legacy/Übergang).
- Freigaberouting: Bei Buchungsanfragen werden Manager mit Standort auf den Fahrzeugstandort gefiltert; Manager ohne Standort und Administrator:innen bleiben global. E-Mail-/Teams-Empfänger folgen derselben Regel.
- Standorte mit Zuordnungen können nicht gelöscht, sondern nur deaktiviert werden.
- Die bestehende Freitext-Location am Fahrzeug bleibt als Beschreibung erhalten; `locationId` ist die steuernde Zuordnung.

Details: [Feature-Doku v0.12.0 Standorte](FEATURE_DOKU_v0.12.0_Locations.md).

## Benutzerkonten und Anonymisierung

Aktive Konten werden nicht gelöscht, sondern können deaktiviert werden. Die Deaktivierung lässt eine bestehende Fahrer-Konto-Verknüpfung unverändert; der Login ist gesperrt. Deaktivierte Konten können anschließend anonymisiert werden – Administratorkonten nur durch den Superadmin; das Superadmin-Konto selbst bleibt ausgenommen:

- Name, E-Mail-Adresse und Passwort werden dauerhaft entfernt.
- Persönliche Rechte-Ausnahmen werden entfernt.
- Eine Fahrer-Konto-Verknüpfung wird entfernt.
- Offene Buchungsanfragen des Kontos werden storniert und auditiert.
- Alle Sitzungen des Kontos werden beendet.
- Verknüpfte Buchungen, Kosten und Audit-Einträge bleiben erhalten.
- E-Mail-Adressen in zugehörigen Audit-Einträgen werden bereinigt.
- Das Konto bleibt deaktiviert und kann nicht reaktiviert werden.

Unter **Benutzer → Automatische Anonymisierung** lässt sich eine globale Frist in Tagen einstellen. `0` deaktiviert die Automatik. Die Prüfung läuft beim Serverstart, nach dem Speichern der Frist und anschließend regelmäßig. Erfasst werden alle Konten, die bereits deaktiviert und älter als die Frist sind – einschließlich Administratorkonten. Das Superadmin-Konto ist ausgenommen. Diese globale Richtlinie bleibt in Etappe 1 Administrator:innen vorbehalten (`PATCH /api/user-policy`); delegierte Benutzerverwaltung umfasst sie nicht.

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
- `mfa.key` – automatisch erzeugter 32-Byte-Schlüssel für TOTP-Secrets und Recovery-Pepper (0600); nur zusammen mit der Datenbank sichern

Konsistente Sicherung anstoßen:

```bash
docker compose exec app npm run backup
docker compose cp app:/app/data/backups ./backups
```

Die Sicherung anschließend auf ein externes Medium oder ein Backup-System kopieren. Uploads und Datenbank gehören zusammen und müssen gemeinsam gesichert werden.

## Betriebs-Skripte

| Skript | Zweck |
|---|---|
| `npm run verify-backup -- --db <pfad> --data <dir>` | SQLite-Integrität, Fremdschlüssel, Kerntabellen, Uploads und `mfa.key` prüfen; Exit-Code für Monitoring. |
| `npm run healthcheck -- --url <healthz> [--db <pfad>] [--disk <pfad>]` | HTTP-Health, optionale DB- und freie-Speicher-Prüfung; Exit-Code für Monitoring. |
| `npm run backup:offsite -- --source <dir> --target <rclone-ziel>` | Offsite-Copy über `rclone`; ohne `OFFSITE_TARGET` No-op, `--dry-run` zeigt nur den Befehl. Keine Credentials im Repo. |
| `npm run loadtest -- --url <url> --confirm` | Leichter HTTP-Lasttest gegen lokale/dedizierte Testinstanzen; Produktionsziele sind ohne `--allow-remote` gesperrt. Alternativ `k6 run scripts/loadtest.k6.js` mit `TARGET_URL`. |

Beispiele:

```bash
npm run verify-backup -- --db data/awo-fuhrpark.sqlite --data data
npm run healthcheck -- --url http://127.0.0.1:3000/healthz --db data/awo-fuhrpark.sqlite
OFFSITE_TARGET=remote:backup npm run backup:offsite -- --source data --dry-run
npm run loadtest -- --url http://127.0.0.1:3000/healthz --concurrency 5 --duration 10 --confirm
```

Der Lasttest ist kein Produktions-Benchmark und darf nicht gegen den Produktivserver laufen. Offsite-Ziele und Credentials werden ausschließlich über die Betriebsumgebung gesetzt.

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
| `MFA_ENCRYPTION_KEY` | Optional; 32 Byte als Base64 oder 64 Hex-Zeichen. Fehlt sie, wird `DATA_DIR/mfa.key` automatisch erzeugt. Ein gesetzter, ungültiger Wert bricht den Start ab. |
| `INTEGRATIONS_ENCRYPTION_KEY` | Optional; 32 Byte als Base64 oder 64 Hex-Zeichen für SSO-Client-Secret und Teams-Webhook. Fehlt sie, wird `DATA_DIR/integrations.key` erzeugt (`0600`). Schlüssel und DB gemeinsam sichern. |
| `WEBAUTHN_RP_ID` | RP-ID der Passkey-Domain, z. B. `fuhrpark.example.org`; ohne Schema/Port. |
| `WEBAUTHN_RP_NAME` | Anzeigename für den Passkey-Dialog. |
| `WEBAUTHN_ORIGIN` | Erlaubte Origin(s) inklusive Schema, mehrere kommagetrennt. Muss zur RP-ID passen. |
| `SSO_ENABLED` | `1` aktiviert OIDC-SSO; Standard aus. |
| `SSO_ISSUER` | OIDC-Issuer, z. B. Entra-Tenant-Issuer. |
| `SSO_CLIENT_ID`, `SSO_CLIENT_SECRET` | Entra-App-Registrierung. Secret niemals in Logs/Repo. |
| `SSO_REDIRECT_URI` | Exakte Callback-URI, z. B. `https://fuhrpark.example.org/auth/sso/callback`. |
| `SSO_SCOPES` | Standard `openid profile email`. |
| `SSO_ALLOWED_DOMAINS` | Kommagetrennte E-Mail-Domains; leer = keine zusätzliche Beschränkung. |
| `SSO_AUTO_PROVISION` | `true` legt unbekannte Konten automatisch an; Standard aus. |
| `SSO_DEFAULT_ROLE` | Rolle für JIT-Konten, Standard `user` (Standardbenutzer, inkl. Fahrerprofil); `superadmin` ist nie zulässig. |
| `SSO_GROUP_CLAIM`, `SSO_ADMIN_GROUP`, `SSO_MANAGER_GROUP` | Gruppen-Claim und Gruppen-IDs für das Rollenmapping. |
| `TEAMS_WEBHOOK_URL` | Optionaler Incoming-Webhook für Teams (Legacy/Preset); leer = deaktiviert. Nicht loggen/committen. |
| `TEAMS_ENABLED` | Optional; explizit `true`/`false`. Ohne Wert bleibt ein per ENV gesetzter Webhook wie bisher aktiv. |
| `WEBHOOK_ALLOW_PRIVATE_HOSTS` | Kommagetrennte Hostnamen, für die private/interne Webhook-Ziele erlaubt sind; Standard leer. Nur für vertrauenswürdige interne Ziele setzen. |
| `VIRUS_SCAN_ENABLED` | `1` aktiviert die ClamAV-Prüfung; Standard aus. |
| `CLAMAV_HOST`, `CLAMAV_PORT` | clamd-Ziel, Standard `127.0.0.1:3310`. |
| `VIRUS_SCAN_FAIL_CLOSED` | `true` (Standard bei aktivierter Prüfung) blockiert bei Scannerfehlern. |
| `RETENTION_INTERVAL_MS` | Intervall des Retention-Schedulers, Standard 24 Stunden; Minimum 60.000 ms. |
| `RETENTION_INITIAL_DELAY_MS` | Verzögerung des ersten Retention-Laufs, Standard 10 Sekunden. |
| `RETENTION_SCHEDULER_DISABLED` | `true` deaktiviert den automatischen Retention-Lauf. |
| `LEASING_INTERVAL_MS` | Intervall des Leasing-Schedulers, Standard sechs Stunden; Minimum 60.000 ms. |
| `LEASING_INITIAL_DELAY_MS` | Verzögerung des ersten Leasing-Laufs, Standard fünf Sekunden. |
| `LEASING_DEBOUNCE_MS` | Debounce nach Fahrzeug-/SMTP-Änderungen, Standard drei Sekunden. |
| `LEASING_SCHEDULER_DISABLED` | `true` deaktiviert den Leasing-Scheduler. |
| `LOCATIONS_ENABLED` | `true` aktiviert Standorte, Sichtbarkeitsfilter und Freigaberouting; Standard aus. |
| `APP_BASE_URL` | Öffentliche Basis-URL für Passwort-Reset-Links, z. B. `https://fuhrpark.example.org`. ENV gewinnt; sonst gilt der Wert aus **Erweitert**. Ohne Wert wird die Host-Information der Anfrage verwendet. |
| `LOG_LEVEL` | `debug`, `info`, `warn` oder `error`; Default `info`. |
| `LOG_REQUESTS` | `1` aktiviert Request-Logs; Default `0` in Produktion, sonst `1`. |
| `LOG_FORMAT` | `text` oder `json`; Default `text`. |
| `LOG_DIR` | Verzeichnis für `mail.log`; Default `DATA_DIR/logs`. |
| `REMINDER_INTERVAL_MS` | Intervall des Wartungs-/TÜV-Schedulers in Millisekunden, Standard sechs Stunden; Minimum 60.000 ms. |
| `REMINDER_INITIAL_DELAY_MS` | Verzögerung des ersten Wartungs-/TÜV-Laufs, Standard fünf Sekunden. |
| `REMINDER_SCHEDULER_DISABLED` | `true` deaktiviert den Wartungs-/TÜV-Scheduler. |

## Dateien

```text
.
├─ server/             Express-Anwendung, API, Schema, Bootstrap und Backup
├─ public/             CSS, Browser-JavaScript und Branding-Dateien
├─ server/views/       HTML für Anwendung und Login
├─ scripts/            Backup-, Health-, Offsite- und Lasttest-Skripte
├─ tests/              Integrationstests mit temporärer Datenbank
├─ Dockerfile
├─ docker-compose.yml
├─ deploy-docker.sh     Deployment ohne Compose-Plugin
├─ update.sh            GitHub-Update + Neustart
├─ .env.example
└─ README.md
```

## Betriebsgrenzen dieses MVPs

Für einen echten Produktivbetrieb sind zusätzlich einzuplanen:

- SSO/Entra ID (optionale TOTP-MFA und Passkeys sind vorhanden, aber kein SSO und kein zentrales Enforcement)
- Teams-Erinnerungen für TÜV und Wartungen (E-Mail-Erinnerungen sind vorhanden)
- zentrale Virenprüfung für hochgeladene PDF-Belege
- standortbezogene Sichtbarkeit und Freigabeprozesse
- Aufbewahrungs- und Löschkonzept für Audit- und personenbezogene Daten nach DSGVO
- Datenschutz-Folgenabschätzung und Betriebsvereinbarung bei personenbezogenen Fahrerdaten
- externe Backups, Monitoring und Wiederherstellungstests
- Lasttests und Penetrationstest vor öffentlichem Betrieb

Die Anwendung ist für einen einzelnen Server mit einer SQLite-Instanz ausgelegt. Für horizontale Skalierung oder mehrere parallele Instanzen sollte die Datenhaltung auf PostgreSQL umgestellt werden.

