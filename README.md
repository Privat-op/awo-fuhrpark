# AWO Fuhrparkmanagement · Server-MVP

Serverfähige Fuhrparkverwaltung für die AWO Bremerhaven auf Basis von Node.js, SQLite und einer schlanken Web-Oberfläche. Dieses Repository enthält ausschließlich die Serverversion – ohne statische Demo. Die Anwendung startet **ohne Beispieldaten**: Beim ersten Start werden ausschließlich das Administratorkonto aus der `.env` und die Organisationsdaten angelegt.

## Funktionen

- Zentrale Anmeldung mit Sessions, CSRF-Schutz und Rate-Limits
- Rollen: **Administrator** und **Fuhrparkleitung** sowie frei anlegbare Rollen
- Feine Rechteverwaltung: Modulrechte, Objekt-Ausnahmen pro Fahrzeug, Fahrer:in, Buchung, Kostenposition und Wartung sowie persönliche Benutzer-Ausnahmen
- Delegierbare Benutzer- und Rollenverwaltung mit Rangfolge, Grant Ceiling, Passwort-Reset, Deaktivierung und Anonymisierung deaktivierter Konten
- Automatische Anonymisierung deaktivierter Konten nach einer global einstellbaren Frist
- Fahrzeuge mit Bild-Upload, Standort, Kilometerstand, HU/AU und Service
- Leasingüberwachung mit Laufzeit, Gesamt-Kilometerlimit, Warnschwellen 80/90/100 % und Erinnerungen 90/30 Tage vor Leasingende
- Optionaler E-Mail-Versand an Fuhrparkleitung und Administration bei Leasing-Schwellen; SMTP-Konfiguration ausschließlich für Administrator:innen
- Dauerhafte Fahrzeug-Sperre mit Begründung, Audit und serverseitiger 409-Sperre für neue Buchungen und Anfragen
- Buchungen mit serverseitiger Konfliktprüfung für Fahrzeug und Fahrer:in
- Eigene Fahrten: verknüpfte Fahrer:innen sehen ausschließlich ihre eigenen Buchungen und können Buchungsanfragen stellen
- Buchungsanfragen mit Rang- und Rollen-Policy, transaktionaler Genehmigung und Audit
- Fahrtenbuch mit Fahrtstart, Fahrtende und manueller Nachtragung
- Wartungsplan mit automatischer Kostenübernahme bei Erledigung
- Kostenverwaltung inklusive Beleg-Upload (JPG, PNG, PDF)
- Dashboard, Suche und Benachrichtigungen mit Gelesen-Status
- **Globales Erscheinungsbild:** Allgemeines AWO-Theme mit offiziellem Logo oder neutrales Theme mit eigenem Anzeigenamen, optionalem Logo, Akzentfarbe, weiteren Farben und Sidebar-Stil inklusive Live-Vorschau
- DATEV-unabhängiger JSON-Export und CSV-Export des Fahrtenbuchs; beide serverseitig berechtigungsgeprüft und audit-protokolliert
- **Audit-Log für alle angemeldeten Nutzer:** serverseitig begrenzte Sicht (eigene Aktionen, Rangbereich oder alle Aktivitäten), Suche/Filter, Maskierung, Meta-Audit und Pagination
- SQLite-Datenbank, Dateispeicher und Sicherungsskript
- Docker- und Reverse-Proxy-fähig

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
| Eigene Rollen | Frei anlegbare Rollen mit individuellem Rang, Modulrechten und Objekt-Ausnahmen |

Konten mit `users_manage` können Benutzer anlegen, bearbeiten, deaktivieren, anonymisieren, Benutzer-Ausnahmen pflegen und Fahrer-Konten verknüpfen. Konten mit `roles_manage` verwalten Rollen, Ränge, Objekt-Ausnahmen und die Buchungsanfrage-Policy. Beide Rechte sind getrennt vergebbar. Die Fuhrparkleitung erhält zusätzlich `booking_requests_manage`. Jede Person kann ihr eigenes Passwort unter **Einstellungen** ändern – ausgenommen der Superadmin, dessen Passwort ausschließlich aus der Datei stammt.

### Superadmin

Der Superadmin ist die oberste Verwaltungsinstanz. Er kann Administratorkonten anlegen, bearbeiten, deaktivieren und Passwörter zurücksetzen, aber niemals sich selbst, einen zweiten Superadmin oder die Superadmin-Rolle verwalten. Bestehende Administratorkonten können nicht herabgestuft, gelöscht oder anonymisiert werden; mindestens ein aktives Administratorkonto bleibt geschützt. Der Superadmin zählt nicht als „letzter aktiver Admin“.

- **Datei:** Pfad über `SUPERADMIN_FILE`. Docker-Default ist `/run/secrets/awo-superadmin.json`, außerhalb von Docker `/etc/awo-fuhrpark/superadmin.json`. Die Datei muss außerhalb von Repository, persistentem Daten-Volume und Backup liegen und sollte `root:root` mit `0600` gehören.
- **Format:** JSON mit den Pflichtfeldern `email`, `name` und `passwordHash`. `passwordHash` ist ein bcrypt-Hash mit Cost 12; Klartextpasswörter werden nicht unterstützt. Der Hash wird offline erzeugt und niemals in Logs, Audit, Chat oder Dokumentation ausgegeben.
- **Bootstrap:** Beim Start wird nach Schema-/Rollenmigration ein Konto mit fester ID `superadmin`, der Rolle `superadmin` und `active=1` idempotent angelegt oder aktualisiert. Fehlt die Datei oder ist sie ungültig, wird nur gewarnt, ein vorhandenes Konto wird `active=0` gesetzt und der Superadmin-Login ist gesperrt; das System läuft normal weiter. Es gibt keinen Fallback auf einen alten Hash und keine Löschung oder Anonymisierung.
- **Rotation/Recovery:** Datei ersetzen und Dienst bzw. Container neu starten. Änderungen an E-Mail oder Hash sowie eine Reaktivierung invalidieren alle Superadmin-Sessions. Jede Änderung wird als `superadmin_update` ohne Secret auditiert; eine Sperrung als `superadmin_disabled`.
- **Schutz:** Keine UI-/API-Route zum Anlegen, Ändern oder Löschen des Superadmins. Das Konto ist in Benutzerliste und Datenexport vollständig ausgeblendet; die Rolle erscheint im Rollenbaum systemgeschützt mit Schloss. Superadmin-Ereignisse bleiben für berechtigte `audit_view_all`- und Administrator-Konten im Audit sichtbar.
- **MFA/Passkey:** perspektivisch verpflichtend vorgemerkt, in dieser Etappe nicht enthalten.

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
- Administratorkonten und die Administrator-Rolle sind geschützt. Administratoren können keine anderen Administratoren bearbeiten, deaktivieren oder zu Administratoren befördern. Nur der Superadmin verwaltet Administratorkonten; eine Herabstufung, Löschung oder Anonymisierung bestehender Administratorkonten ist ausgeschlossen. Mindestens ein aktives Administratorkonto bleibt geschützt.
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

Die Migrationen sind idempotent und führen die Datenbank auf `user_version = 5`: Die Audit-Migration ergänzt Snapshot-Spalten und Indizes und befüllt bestehende Einträge nach; die Superadmin-Migration legt die systemgeschützte Rolle `superadmin` mit Rang 2.000.000 an; die Leasing-Migration ergänzt Fahrzeug-Leasingfelder, SMTP-Einstellungen und die Dedupe-Tabelle für Benachrichtigungen. Das Superadmin-Konto selbst wird ausschließlich aus der Datei gebootstrappt.

## Leasing und E-Mail

- Leasingdaten werden im Fahrzeugdialog gepflegt. Ohne Leasingende und Kilometerlimit bleibt ein Fahrzeug außerhalb der Überwachung.
- Warnschwellen: 80 %, 90 % und 100 % des Kilometerlimits sowie 90 und 30 Tage vor Leasingende. Die Hinweise erscheinen in der Fahrzeugliste, in den Fahrzeugdetails, im Dashboard/Benachrichtigungsbereich und beim Buchen. Sie blockieren keine Buchung.
- E-Mails gehen an aktive Konten der Rollen **Administrator** und **Fuhrparkleitung**. Es wird pro Fahrzeug, Schwelle und Leasingzeitraum höchstens einmal versendet; Fehlversuche werden bis zu dreimal mit Wartezeit wiederholt.
- Der Scheduler prüft beim Start und anschließend alle sechs Stunden. Nach Kilometeränderungen (Fahrzeugbearbeitung, Fahrtende, Nachtragung) wird zusätzlich eine gedebouncte Prüfung ausgelöst. In Tests oder Sonderfällen kann er mit `LEASING_SCHEDULER_DISABLED=true` deaktiviert werden.
- SMTP-Einstellungen sind nur für Administrator:innen sichtbar und änderbar. Das Passwort wird **nicht** in der Datenbank, im State, im Export oder im Audit gespeichert, sondern ausschließlich in `smtp-secret.json` im Datenverzeichnis (Dateirechte 0600 auf Linux). Das Backup-Skript sichert Datenbank und Uploads, **nicht** die Secret-Datei; nach einer Wiederherstellung muss das SMTP-Passwort neu gesetzt werden. Die Test-E-Mail geht an die angemeldete Administrator:in.
- Ohne aktivierte und vollständige SMTP-Konfiguration wird keine Mail versendet; die Anwendung bleibt funktionsfähig.

## Passwörter ändern

- **Normale Benutzer und Admins:** **Einstellungen → Ihr Konto → Passwort ändern**. Das aktuelle Passwort und ein neues Passwort mit mindestens 10 Zeichen eingeben. Das Hashen übernimmt die Anwendung.
- **Superadmin:** Kein UI-Passwortwechsel. Ein neues Passwort wird lokal mit bcrypt (Cost 12) gehasht und als `passwordHash` in der Superadmin-Datei eingetragen; anschließend Container/Service neu starten.

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

## Benutzerkonten und Anonymisierung

Aktive Konten werden nicht gelöscht, sondern können deaktiviert werden. Die Deaktivierung lässt eine bestehende Fahrer-Konto-Verknüpfung unverändert; der Login ist gesperrt. Deaktivierte Konten können anschließend anonymisiert werden:

- Name, E-Mail-Adresse und Passwort werden dauerhaft entfernt.
- Persönliche Rechte-Ausnahmen werden entfernt.
- Eine Fahrer-Konto-Verknüpfung wird entfernt.
- Offene Buchungsanfragen des Kontos werden storniert und auditiert.
- Alle Sitzungen des Kontos werden beendet.
- Verknüpfte Buchungen, Kosten und Audit-Einträge bleiben erhalten.
- E-Mail-Adressen in zugehörigen Audit-Einträgen werden bereinigt.
- Das Konto bleibt deaktiviert und kann nicht reaktiviert werden.

Unter **Benutzer → Automatische Anonymisierung** lässt sich eine globale Frist in Tagen einstellen. `0` deaktiviert die Automatik. Die Prüfung läuft beim Serverstart, nach dem Speichern der Frist und anschließend regelmäßig. Nur Konten, die bereits deaktiviert und älter als die Frist sind, werden erfasst. Diese globale Richtlinie bleibt in Etappe 1 Administrator:innen vorbehalten (`PATCH /api/user-policy`); delegierte Benutzerverwaltung umfasst sie nicht.

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

- SSO/Entra ID und Mehrfaktor-Authentifizierung
- E-Mail-/Teams-Erinnerungen für TÜV und Wartungen
- zentrale Virenprüfung für hochgeladene PDF-Belege
- standortbezogene Sichtbarkeit und Freigabeprozesse
- Aufbewahrungs- und Löschkonzept für Audit- und personenbezogene Daten nach DSGVO
- Datenschutz-Folgenabschätzung und Betriebsvereinbarung bei personenbezogenen Fahrerdaten
- externe Backups, Monitoring und Wiederherstellungstests
- Lasttests und Penetrationstest vor öffentlichem Betrieb

Die Anwendung ist für einen einzelnen Server mit einer SQLite-Instanz ausgelegt. Für horizontale Skalierung oder mehrere parallele Instanzen sollte die Datenhaltung auf PostgreSQL umgestellt werden.

