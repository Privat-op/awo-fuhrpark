# AWO Fuhrparkmanagement Â· Server-MVP

ServerfÃ¤hige Fuhrparkverwaltung fÃ¼r die AWO Bremerhaven auf Basis von Node.js, SQLite und einer schlanken Web-OberflÃ¤che. Dieses Repository enthÃ¤lt ausschlieÃŸlich die Serverversion â€“ ohne statische Demo. Die Anwendung startet **ohne Beispieldaten**: Beim ersten Start werden ausschlieÃŸlich das Administratorkonto aus der `.env` und die Organisationsdaten angelegt.

## Funktionen

- Zentrale Anmeldung mit Sessions, CSRF-Schutz und Rate-Limits
- Rollen: **Administrator** und **Fuhrparkleitung** sowie frei anlegbare Rollen
- Feine Rechteverwaltung: Modulrechte, Objekt-Ausnahmen pro Fahrzeug, Fahrer:in, Buchung, Kostenposition und Wartung sowie persÃ¶nliche Benutzer-Ausnahmen
- Delegierbare Benutzer- und Rollenverwaltung mit Rangfolge, Grant Ceiling, Passwort-Reset, Deaktivierung und Anonymisierung deaktivierter Konten
- Automatische Anonymisierung deaktivierter Konten nach einer global einstellbaren Frist
- Fahrzeuge mit Bild-Upload, Standort, Kilometerstand, HU/AU und Service
- Dauerhafte Fahrzeug-Sperre mit BegrÃ¼ndung, Audit und serverseitiger 409-Sperre fÃ¼r neue Buchungen und Anfragen
- Buchungen mit serverseitiger KonfliktprÃ¼fung fÃ¼r Fahrzeug und Fahrer:in
- Eigene Fahrten: verknÃ¼pfte Fahrer:innen sehen ausschlieÃŸlich ihre eigenen Buchungen und kÃ¶nnen Buchungsanfragen stellen
- Buchungsanfragen mit Rang- und Rollen-Policy, transaktionaler Genehmigung und Audit
- Fahrtenbuch mit Fahrtstart, Fahrtende und manueller Nachtragung
- Wartungsplan mit automatischer KostenÃ¼bernahme bei Erledigung
- Kostenverwaltung inklusive Beleg-Upload (JPG, PNG, PDF)
- Dashboard, Suche und Benachrichtigungen mit Gelesen-Status
- **Globales Erscheinungsbild:** Allgemeines AWO-Theme mit offiziellem Logo oder neutrales Theme mit eigenem Anzeigenamen, optionalem Logo, Akzentfarbe, weiteren Farben und Sidebar-Stil inklusive Live-Vorschau
- DATEV-unabhÃ¤ngiger JSON-Export und CSV-Export des Fahrtenbuchs; beide serverseitig berechtigungsgeprÃ¼ft und audit-protokolliert
- **Audit-Log fÃ¼r alle angemeldeten Nutzer:** serverseitig begrenzte Sicht (eigene Aktionen, Rangbereich oder alle AktivitÃ¤ten), Suche/Filter, Maskierung, Meta-Audit und Pagination
- SQLite-Datenbank, Dateispeicher und Sicherungsskript
- Docker- und Reverse-Proxy-fÃ¤hig

## Release v0.6.0

v0.6.0 bÃ¼ndelt Etappe 2 (Own Trips, Buchungsanfragen, dauerhafte Fahrzeug-Sperre) und das Audit-Paket. Beide Pakete sind QS-verifiziert; der integrierte Stand `4a18ec2` ist die Release-Basis.

- **Own Trips:** 1:1-VerknÃ¼pfung von Fahrer:innen und Benutzerkonten, schlanke Ansicht â€žMeine Fahrtenâ€œ, Default-Rechte Ã¼ber `own_trips_access`.
- **Buchungsanfragen:** `booking_requests_manage`, Rollen-Policy und Rang-Gate, keine Selbstgenehmigung, transaktionale Genehmigung mit Doppelbelegungscheck.
- **Fahrzeug-Sperre:** dauerhaft gesperrte Fahrzeuge verursachen 409 bei neuen Buchungen und Buchungsanfragen; bestehende Buchungen bleiben unverÃ¤ndert.
- **Audit-Log:** Self-only ohne Audit-Recht, Rangbereich mit `audit_view`, alle EintrÃ¤ge mit `audit_view_all` â€“ ohne Switch; Suche/Filter, Maskierung, Meta-Audit und Pagination.
- **OberflÃ¤che:** Zahnrad als zentraler Settings-Einstieg; Sidebar-Fix `d69755b`.

Details, Migration und bekannte EinschrÃ¤nkungen: [Release Notes v0.6.0](RELEASE_NOTES_v0.6.0.md).

## Release v0.6.1

v0.6.1 ergÃ¤nzt Own-Trip-Actions, Superadmin (Etappe 3) und den UI-Berechtigungs-Fix inklusive Admin-Self-Driver-Link. QS-Freigabe: JA, keine Findings; DEV-Basis `506b9f0`.

- **Own-Trip-Actions:** `own_trips_execute`; eigene geplante Fahrten starten, aktive beenden; Fremd-/UnverknÃ¼pft-Kontexte 403.
- **Superadmin:** dateibasiert Ã¼ber `SUPERADMIN_FILE`, bcrypt-Hash, Rank 2.000.000, systemgeschÃ¼tzt und in der UI vollstÃ¤ndig ausgeblendet; Admin-Verwaltung nur durch Superadmin; fehlende/ungÃ¼ltige Datei sperrt nur den Superadmin-Login.
- **UI-Fix:** Sidebar ohne Flash unerlaubter EintrÃ¤ge; Settings nur mit erlaubten Karten; Admin kann ausschlieÃŸlich sein eigenes Fahrerprofil verknÃ¼pfen.
- **Migration:** `user_version = 4`.

Details: [Release Notes v0.6.1](RELEASE_NOTES_v0.6.1.md) Â· [Feature-Doku v0.6.1](FEATURE_DOKU_v0.6.1.md).

> **Hinweis zum Fahrtenbuch:** Historische Nachtragungen dÃ¼rfen einen Startkilometer unter dem aktuellen Fahrzeugstand haben. Die OberflÃ¤che zeigt in diesem Fall einen Hinweis, blockiert das Speichern aber nicht; der Fahrzeugstand wird nur angehoben, wenn der eingetragene Endkilometer hÃ¶her liegt.

## Schnellstart mit Docker

Voraussetzungen: Linux-Server mit Docker und Docker Compose, optional eine Domain mit HTTPS.

```bash
cp .env.example .env
# .env Ã¶ffnen und SESSION_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD sowie Organisationsdaten setzen.
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

Wenn Ã„nderungen im GitHub-Repository auf `main` liegen:

```bash
cd ~/awo-fuhrpark
./update.sh
```

Das Skript prÃ¼ft auf lokale Ã„nderungen, zieht den neuesten Stand, baut das Image neu und ersetzt den Container. Datenbank, Uploads und Sicherungen bleiben im Volume `awo_fuhrpark_data` erhalten.

Danach `http://SERVER-IP:3000` Ã¶ffnen und mit dem in `.env` hinterlegten Administratorkonto anmelden. Das Passwort sollte anschlieÃŸend unter **Einstellungen â†’ Passwort Ã¤ndern** geÃ¤ndert werden.

### Wichtig beim ersten Start

- `ADMIN_EMAIL` und `ADMIN_PASSWORD` werden nur benÃ¶tigt, solange die Benutzertabelle leer ist.
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

Die Anwendung lÃ¤uft anschlieÃŸend unter `http://127.0.0.1:3000`. Datenbank und Uploads landen standardmÃ¤ÃŸig im Verzeichnis `data/`.

### Tests

Die Integrationstests laufen mit einer temporÃ¤ren SQLite-Datenbank und einem zufÃ¤lligen Loopback-Port; Produktivdaten und echte Zugangsdaten werden nicht verwendet:

```bash
node --test
```

## HTTPS und Reverse Proxy

FÃ¼r den Produktivbetrieb ist HTTPS verpflichtend. Beispiel mit Caddy:

```caddyfile
fuhrpark.example.org {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}
```

In `.env` anschlieÃŸend setzen:

```dotenv
COOKIE_SECURE=true
TRUST_PROXY=1
```

Danach den Container neu starten. Der Server sollte nicht ungeschÃ¼tzt direkt aus dem Internet auf Port 3000 erreichbar sein.

## Rollen und Rechte

| Rolle | Rechte |
| --- | --- |
| Superadmin | Sonderrolle mit Rang 2.000.000, systemgeschÃ¼tzt, ausschlieÃŸlich Ã¼ber die Superadmin-Datei konfiguriert; nicht Ã¼ber UI/API anlegbar, zuweisbar, Ã¤nderbar oder lÃ¶schbar |
| Administrator | Alle Fuhrparkfunktionen, Einstellungen sowie Benutzer- und Rollenverwaltung; immer vollstÃ¤ndig, systemgeschÃ¼tzt und nicht Ã¼ber die Benutzerverwaltung vergebbar |
| Fuhrparkleitung | Standardrolle mit allen Fuhrparkfunktionen, Einstellungen, den delegierten Rechten `users_manage`/`roles_manage` sowie `audit_view` (ohne `audit_view_all`); Rechte, Rang und Objekt-Ausnahmen kÃ¶nnen angepasst werden |
| Eigene Rollen | Frei anlegbare Rollen mit individuellem Rang, Modulrechten und Objekt-Ausnahmen |

Konten mit `users_manage` kÃ¶nnen Benutzer anlegen, bearbeiten, deaktivieren, anonymisieren, Benutzer-Ausnahmen pflegen und Fahrer-Konten verknÃ¼pfen. Konten mit `roles_manage` verwalten Rollen, RÃ¤nge, Objekt-Ausnahmen und die Buchungsanfrage-Policy. Beide Rechte sind getrennt vergebbar. Die Fuhrparkleitung erhÃ¤lt zusÃ¤tzlich `booking_requests_manage`. Jede Person kann ihr eigenes Passwort unter **Einstellungen** Ã¤ndern â€“ ausgenommen der Superadmin, dessen Passwort ausschlieÃŸlich aus der Datei stammt.

### Superadmin

Der Superadmin ist die oberste Verwaltungsinstanz. Er kann Administratorkonten anlegen, bearbeiten, deaktivieren und PasswÃ¶rter zurÃ¼cksetzen, aber niemals sich selbst, einen zweiten Superadmin oder die Superadmin-Rolle verwalten. Bestehende Administratorkonten kÃ¶nnen nicht herabgestuft, gelÃ¶scht oder anonymisiert werden; mindestens ein aktives Administratorkonto bleibt geschÃ¼tzt. Der Superadmin zÃ¤hlt nicht als â€žletzter aktiver Adminâ€œ.

- **Datei:** Pfad Ã¼ber `SUPERADMIN_FILE`. Docker-Default ist `/run/secrets/awo-superadmin.json`, auÃŸerhalb von Docker `/etc/awo-fuhrpark/superadmin.json`. Die Datei muss auÃŸerhalb von Repository, persistentem Daten-Volume und Backup liegen und sollte `root:root` mit `0600` gehÃ¶ren.
- **Format:** JSON mit den Pflichtfeldern `email`, `name` und `passwordHash`. `passwordHash` ist ein bcrypt-Hash mit Cost 12; KlartextpasswÃ¶rter werden nicht unterstÃ¼tzt. Der Hash wird offline erzeugt und niemals in Logs, Audit, Chat oder Dokumentation ausgegeben.
- **Bootstrap:** Beim Start wird nach Schema-/Rollenmigration ein Konto mit fester ID `superadmin`, der Rolle `superadmin` und `active=1` idempotent angelegt oder aktualisiert. Fehlt die Datei oder ist sie ungÃ¼ltig, wird nur gewarnt, ein vorhandenes Konto wird `active=0` gesetzt und der Superadmin-Login ist gesperrt; das System lÃ¤uft normal weiter. Es gibt keinen Fallback auf einen alten Hash und keine LÃ¶schung oder Anonymisierung.
- **Rotation/Recovery:** Datei ersetzen und Dienst bzw. Container neu starten. Ã„nderungen an E-Mail oder Hash sowie eine Reaktivierung invalidieren alle Superadmin-Sessions. Jede Ã„nderung wird als `superadmin_update` ohne Secret auditiert; eine Sperrung als `superadmin_disabled`.
- **Schutz:** Keine UI-/API-Route zum Anlegen, Ã„ndern oder LÃ¶schen des Superadmins. Das Konto ist in Benutzerliste und Datenexport vollstÃ¤ndig ausgeblendet; die Rolle erscheint im Rollenbaum systemgeschÃ¼tzt mit Schloss. Superadmin-Ereignisse bleiben fÃ¼r berechtigte `audit_view_all`- und Administrator-Konten im Audit sichtbar.
- **MFA/Passkey:** perspektivisch verpflichtend vorgemerkt, in dieser Etappe nicht enthalten.

Beispiel fÃ¼r die Dateistruktur (Werte ersetzen; kein echter Hash im Repository):

```json
{
  "email": "superadmin@example.org",
  "name": "Superadmin",
  "passwordHash": "<bcrypt-Hash mit Cost 12>"
}
```

FÃ¼r Docker die Datei read-only unter dem Default-Pfad einbinden, zum Beispiel:

```yaml
services:
  app:
    volumes:
      - /etc/awo-fuhrpark/superadmin.json:/run/secrets/awo-superadmin.json:ro
```

Das Verzeichnis muss fÃ¼r den Anwendungsbenutzer lesbar sein, ohne dass Klartext oder Hashes in Logs gelangen. Bei unsicheren Datei-/Verzeichnisrechten oder einem Pfad innerhalb von Repository/Volume warnt der Start, bricht aber nicht ab. Der Container lÃ¤uft als Benutzer `node`; die Datei muss daher entweder fÃ¼r diesen Benutzer lesbar sein oder der Betrieb muss die EigentÃ¼mer-/Gruppenrechte entsprechend kontrolliert setzen.

### Delegierte Verwaltung und Rangfolge

- Jede Rolle hat einen ganzzahligen Rang; hÃ¶her bedeutet mÃ¤chtiger. GleichstÃ¤nde (Ties) sind erlaubt, aber Rollen und Konten gleichen Rangs kÃ¶nnen sich gegenseitig nicht verwalten.
- Superadmin (Rang 2.000.000, ausschlieÃŸlich datei-verwaltet), Administrator (Rang 1.000.000) und Fuhrparkleitung (Rang 900.000) sind vorbelegt. Bestehende eigene Rollen starten bei 100.000 + Index, also unterhalb der Fuhrparkleitung.
- Nicht-Administratoren sehen nur die eigene sowie strikt niedrigere RÃ¤nge. Die eigene Rolle und das eigene Konto sind nicht Ã¼ber die Verwaltung bearbeitbar; das eigene Passwort bleibt unter **Einstellungen** Ã¤nderbar.
- Neue Rollen und RangÃ¤nderungen mÃ¼ssen strikt unterhalb des eigenen Rangs liegen. Die Untergrenze fÃ¼r neu vergebene RÃ¤nge ist **1**; Rang 0 ist kein gÃ¼ltiger neuer Rollenrang. Rollen mit zugewiesenen Konten oder Systemrollen kÃ¶nnen nicht gelÃ¶scht werden.
- **Grant Ceiling:** Nicht-Administratoren kÃ¶nnen nur Rechte weitergeben, die sie selbst effektiv global besitzen. Rollen mit Admin-only-Rechten (z. B. `branding_manage`) bleiben fÃ¼r sie gesperrt. Objektbezogene Sonderrechte zÃ¤hlen nicht als Grundlage fÃ¼r die Weitergabe.
- Die Weitergabe von `users_manage` und `roles_manage` an strikt niedrigere Rollen ist erlaubt; jede Delegationsstufe bleibt an Rang und Grant Ceiling gebunden.
- Der Widerruf ist **isoliert**: Entzieht eine Ã¼bergeordnete Rolle ihre Verwaltungsrechte, bleiben bereits an untere Rollen vergebene Rechte bestehen. Der obere Rang kann sie bei Bedarf direkt bei den unteren Rollen entziehen; eine automatische Kaskade gibt es nicht.
- Administratorkonten und die Administrator-Rolle sind geschÃ¼tzt. Administratoren kÃ¶nnen keine anderen Administratoren bearbeiten, deaktivieren oder zu Administratoren befÃ¶rdern. Nur der Superadmin verwaltet Administratorkonten; eine Herabstufung, LÃ¶schung oder Anonymisierung bestehender Administratorkonten ist ausgeschlossen. Mindestens ein aktives Administratorkonto bleibt geschÃ¼tzt.
- Ã„nderungen an Rollen und Konten werden transaktional ausgefÃ¼hrt und auditiert.

### Fahrtenbuch-Rechte

- `logbook_view` und `logbook_export` Ã¶ffnen ausschlieÃŸlich das Fahrtenbuch mit abgeschlossenen Fahrten. Sie geben keinen Zugriff auf die allgemeine Buchungsverwaltung oder die vollstÃ¤ndigen Fahrzeug-/Fahrer-Stammdatenseiten.
- Fahrzeug- und Fahrername werden im Fahrtenbuch als minimale Referenz mitgeliefert, damit die Tabelle und der CSV-Export lesbar bleiben.
- `logbook_manage` (Fahrten nachtragen) setzt zusÃ¤tzlich die Fahrzeug- und Fahreransicht voraus, damit eine Fahrt ausgewÃ¤hlt werden kann.
- Historische NachtrÃ¤ge dÃ¼rfen unter dem aktuellen Fahrzeugkilometerstand liegen; die UI zeigt einen Hinweis, blockiert aber nicht.

### Rechte-Hierarchie

Die Rechte werden in dieser Reihenfolge aufgelÃ¶st, von der spezifischsten zur allgemeinsten Regel:

1. **Benutzer-Objekt-Ausnahme** â€“ gilt fÃ¼r genau ein Objekt und einen Benutzer.
2. **Benutzer-Modul-Ausnahme** â€“ gilt fÃ¼r einen Benutzer und ein Modul.
3. **Rollen-Objekt-Ausnahme** â€“ gilt fÃ¼r genau ein Objekt und eine Rolle.
4. **Rollenrecht** â€“ gilt fÃ¼r die gesamte Rolle.

Auf derselben Ebene gewinnt bei Konflikten die Verweigerung. Eine Objekt-Ausnahme kann ein Recht erlauben oder verweigern, auch wenn das Rollenrecht anders lautet. Die Administrator-Rolle ignoriert Benutzer-Ausnahmen und bleibt immer vollstÃ¤ndig.

FÃ¼r `own_trips_view` und `own_trips_request` gibt es eine zusÃ¤tzliche unterste Ebene: den Fahrer-Default bei aktiver Konto-VerknÃ¼pfung und `own_trips_access=1`. Er greift nur, wenn keine explizite Benutzer- oder Rollenregel entscheidet. Die Reihenfolge lautet daher: Benutzer-Objekt â†’ Benutzer global â†’ Rollen-Objekt â†’ Rollenrecht â†’ Fahrer-Default.

### Objekt-Ausnahmen

Unter **Rollen & Rechte â†’ Objekt-Ausnahmen** lassen sich pro Rolle und Objekt einzelne Aktionen auf **Standard**, **Erlauben** oder **Verweigern** stellen. UnterstÃ¼tzt werden:

- Fahrzeuge
- Fahrer:innen
- Buchungen
- Kostenpositionen
- Wartungen

Die Einstellungen gelten serverseitig fÃ¼r Datenanzeige und Aktionen. Ein Benutzer sieht ein Objekt nur, wenn die effektive Berechtigung es zulÃ¤sst; die gleiche PrÃ¼fung greift bei Bearbeitung, Buchung, Kosten, Wartung und Belegen.

### Benutzer-Ausnahmen

Unter **Benutzer â†’ Benutzer-Ausnahmen** kÃ¶nnen Personen mit `users_manage` persÃ¶nliche Modul- und Objekt-Ausnahmen pflegen, soweit Rang und Grant Ceiling dies zulassen. Diese haben Vorrang vor den Rollenrechten. Beim Wechsel in die Administrator-Rolle oder bei der Anonymisierung werden persÃ¶nliche Ausnahmen entfernt.

### Eigene Fahrten und Buchungsanfragen

- Fahrer:innen kÃ¶nnen mit einem Benutzerkonto verknÃ¼pft werden. Ein Konto gehÃ¶rt hÃ¶chstens zu einem Fahrerprofil; Bestandsfahrer:innen bleiben unverknÃ¼pft.
- Die VerknÃ¼pfung und der Schalter **Standardzugriff auf â€žMeine Fahrtenâ€œ** (`own_trips_access`) werden Ã¼ber die Benutzerverwaltung gepflegt (`users_manage`). Ein Wechsel der VerknÃ¼pfung und jede Ã„nderung des Standardzugriffs wird auditiert.
- Bei aktiver VerknÃ¼pfung und `own_trips_access=1` erhalten Konten standardmÃ¤ÃŸig `own_trips_view` und `own_trips_request`. Der Standard liegt unter allen expliziten Benutzer- und Rollenregeln. `own_trips_access=0` schaltet nur diesen Standard ab; explizite Erlaubnisse kÃ¶nnen ihn wieder aktivieren.
- **Meine Fahrten** ist eine schreibgeschÃ¼tzte Ansicht fÃ¼r die eigenen geplanten, aktiven und abgeschlossenen Buchungen sowie die eigenen Anfragen. Sie enthÃ¤lt keine fremden Daten, keine Stammdatenverwaltung und keinen Export. FÃ¼r Buchungsanfragen wird nur eine minimale Fahrzeugliste bereitgestellt.
- VerknÃ¼pfte Fahrer:innen mit explizitem `bookings_create` dÃ¼rfen weiterhin direkt buchen. Ohne dieses Recht kÃ¶nnen sie ausschlieÃŸlich Buchungsanfragen stellen.
- Eine Buchungsanfrage wird mit Status `requested` gespeichert und reserviert **kein** Fahrzeug. Ein Konflikt mit vorhandenen Buchungen wird beim Stellen nur als Warnung angezeigt.
- Berechtigte mit `booking_requests_manage` (Standard Fuhrparkleitung) sehen offene Anfragen nur von Rollen **strikt unterhalb** ihres Rangs. Die Rollen-Policy `allow`/`deny` filtert zusÃ¤tzlich; eine leere Allow-Liste bedeutet â€žalle zulÃ¤ssigen unteren Rollenâ€œ, Deny gewinnt. Eigene Anfragen kÃ¶nnen nicht selbst entschieden werden.
- Die Genehmigung ist transaktional: Sie prÃ¼ft den Status erneut, legt genau eine geplante Buchung an und setzt `booking_id`. Bei einem Fahrzeug- oder Fahrer:innen-Konflikt antwortet der Server mit `409`, die Anfrage bleibt offen. Ein zweiter Genehmigungsversuch wird mit `409` abgelehnt.
- Ablehnen ist mit optionaler BegrÃ¼ndung mÃ¶glich. ZurÃ¼ckziehen kann nur die antragstellende Person und nur im Status `requested`.
- Wird das anfragende Konto deaktiviert oder anonymisiert, werden offene Anfragen automatisch storniert und auditiert. Bereits entschiedene oder gebuchte Anfragen bleiben erhalten; bei der Anonymisierung wird die Fahrer-Konto-VerknÃ¼pfung entfernt.
- Create, Approve, Reject und Cancel werden auditiert. E-Mail-/Teams-Benachrichtigungen sind noch nicht enthalten.

### Dauerhafte Fahrzeug-Sperre

- Fahrzeuge kÃ¶nnen Ã¼ber die Fahrzeugverwaltung (`vehicles_manage`) dauerhaft gesperrt und wieder entsperrt werden. Eine BegrÃ¼ndung ist optional und wird in Liste, Detailansicht und Auswahl angezeigt.
- Setzen und Aufheben der Sperre werden ebenso wie die BegrÃ¼ndung auditiert.
- `POST /api/bookings` und `POST /api/booking-requests` antworten fÃ¼r ein gesperrtes Fahrzeug mit `409` und einer klaren Meldung. Eine Buchungsanfrage kann nach einer spÃ¤teren Sperre nicht mehr genehmigt werden; sie bleibt offen.
- Bestehende Buchungen bleiben unverÃ¤ndert. Fahrtstart, Fahrtende und Stornierung unterliegen weiterhin den bisherigen Regeln und werden durch die Sperre nicht blockiert.
## Audit-Log

Das Audit-Log ist fÃ¼r **alle angemeldeten Nutzer** unter **Audit-Log** erreichbar. Der sichtbare Bereich wird ausschlieÃŸlich serverseitig bestimmt:

| Berechtigung | Sichtbarer Bereich |
| --- | --- |
| keine Audit-Berechtigung | ausschlieÃŸlich eigene Aktionen |
| `audit_view` | eigene Aktionen und Aktionen von Personen mit strikt niedrigerem Rang |
| `audit_view_all` | alle AktivitÃ¤ten, einschlieÃŸlich Meta-, System- und Superadmin-EintrÃ¤gen |

- `audit_view_all` schlieÃŸt `audit_view` ein und ist innerhalb von Rangfolge und Grant Ceiling delegierbar. Es gibt keinen Umschalter und keinen `all`-Parameter.
- Rolle und Rang werden beim Schreiben als Snapshot gespeichert; spÃ¤tere Rollen- oder RangÃ¤nderungen wirken nicht rÃ¼ckwirkend.
- Die Fuhrparkleitung erhÃ¤lt durch die Migration einmalig `audit_view`, nicht `audit_view_all`. Wird das Recht spÃ¤ter entzogen, bleibt der Entzug bestehen.
- Suche und Filter (`q`, Akteur:in, Aktion, Zieltyp, Ziel, Zeitraum, Seite) arbeiten nur auf dem bereits serverseitig eingeschrÃ¤nkten Bereich. Gesucht wird ausschlieÃŸlich in freigegebenen Feldern, nicht in rohen `details`.
- Ziel-Labels erscheinen nur bei vorhandener Objektberechtigung; andernfalls werden Zieltyp und gekÃ¼rzte ID angezeigt. Details werden als serverseitig erzeugte Allowlist (`detailsSummary`) ausgeliefert. PasswÃ¶rter, Hashes, Tokens, Cookies, Session-IDs und IP-Adressen werden weder gespeichert noch ausgeliefert.
- Eigene EintrÃ¤ge sind unmaskiert. Bei fremden EintrÃ¤gen mit `audit_view` werden E-Mail-Adresse und Telefonnummer maskiert; `audit_view_all` zeigt sie unmaskiert.
- Lesezugriffe auf das Audit-Log werden als Meta-EintrÃ¤ge ohne Inhalte der gelesenen EintrÃ¤ge protokolliert. Meta-EintrÃ¤ge sind nur fÃ¼r `audit_view_all` und Administrator:innen sichtbar.
- Retention, Export und LÃ¶schung bleiben unverÃ¤ndert: Es gibt in dieser Version keine LÃ¶sch-, Rotations- oder Exportfunktion fÃ¼r Audit-EintrÃ¤ge.

Die Migrationen sind idempotent und fÃ¼hren die Datenbank auf `user_version = 4`: Die Audit-Migration ergÃ¤nzt Snapshot-Spalten und Indizes und befÃ¼llt bestehende EintrÃ¤ge nach; die Superadmin-Migration legt die systemgeschÃ¼tzte Rolle `superadmin` mit Rang 2.000.000 an. Das Superadmin-Konto selbst wird ausschlieÃŸlich aus der Datei gebootstrappt.

## PasswÃ¶rter Ã¤ndern

- **Normale Benutzer und Admins:** **Einstellungen â†’ Ihr Konto â†’ Passwort Ã¤ndern**. Das aktuelle Passwort und ein neues Passwort mit mindestens 10 Zeichen eingeben. Das Hashen Ã¼bernimmt die Anwendung.
- **Superadmin:** Kein UI-Passwortwechsel. Ein neues Passwort wird lokal mit bcrypt (Cost 12) gehasht und als `passwordHash` in der Superadmin-Datei eingetragen; anschlieÃŸend Container/Service neu starten.

Der Helper gibt ausschlieÃŸlich den bcrypt-Hash aus; das Passwort wird nicht gespeichert oder geloggt. Der Hash wird in `passwordHash` der Superadmin-Datei Ã¼bernommen. Kein Klartextpasswort in die Datei schreiben.

Komplette Superadmin-Datei mit eigenem Passwort erzeugen:

```bat
scripts\superadmin-setup.cmd
```

oder:

```bash
npm run superadmin:setup
```

Der Wizard fragt E-Mail, Name und Passwort verdeckt ab und schreibt die JSON-Datei auÃŸerhalb des Repos (Standard: `C:\awo-fuhrpark-local\superadmin.json`). Voraussetzung nach einem GitHub-Download: `npm ci` im Projektordner, damit `bcryptjs` vorhanden ist.

**Ein-Befehl-Installer auf dem Linux-Server** (kein manuelles Kopieren oder separater Neustart):

```bash
cd /home/l-admin/awo-fuhrpark
sudo ./scripts/install-superadmin.sh
```

Der Installer fragt E-Mail, Name und Passwort verdeckt ab, sichert eine bestehende Datei, installiert sie mit restriktiven Rechten und erstellt den Container mit read-only Secret-Mount neu. Voraussetzung: `npm ci` wurde im Projektordner ausgefÃ¼hrt.

## Benutzerkonten und Anonymisierung

Aktive Konten werden nicht gelÃ¶scht, sondern kÃ¶nnen deaktiviert werden. Die Deaktivierung lÃ¤sst eine bestehende Fahrer-Konto-VerknÃ¼pfung unverÃ¤ndert; der Login ist gesperrt. Deaktivierte Konten kÃ¶nnen anschlieÃŸend anonymisiert werden:

- Name, E-Mail-Adresse und Passwort werden dauerhaft entfernt.
- PersÃ¶nliche Rechte-Ausnahmen werden entfernt.
- Eine Fahrer-Konto-VerknÃ¼pfung wird entfernt.
- Offene Buchungsanfragen des Kontos werden storniert und auditiert.
- Alle Sitzungen des Kontos werden beendet.
- VerknÃ¼pfte Buchungen, Kosten und Audit-EintrÃ¤ge bleiben erhalten.
- E-Mail-Adressen in zugehÃ¶rigen Audit-EintrÃ¤gen werden bereinigt.
- Das Konto bleibt deaktiviert und kann nicht reaktiviert werden.

Unter **Benutzer â†’ Automatische Anonymisierung** lÃ¤sst sich eine globale Frist in Tagen einstellen. `0` deaktiviert die Automatik. Die PrÃ¼fung lÃ¤uft beim Serverstart, nach dem Speichern der Frist und anschlieÃŸend regelmÃ¤ÃŸig. Nur Konten, die bereits deaktiviert und Ã¤lter als die Frist sind, werden erfasst. Diese globale Richtlinie bleibt in Etappe 1 Administrator:innen vorbehalten (`PATCH /api/user-policy`); delegierte Benutzerverwaltung umfasst sie nicht.

## Erscheinungsbild

Unter **Einstellungen â†’ Erscheinungsbild** kann ausschlieÃŸlich ein Administrator das Theme global fÃ¼r alle Nutzer:innen und die Anmeldeseite wÃ¤hlen:

- **AWO:** allgemeines AWO-Theme mit offiziellem AWO-Logo, ohne Ortsverband-Zusatz
- **Neutral:** eigenes Branding mit frei wÃ¤hlbarem Anzeigenamen, optionalem Logo, Akzentfarbe, weiteren Farben fÃ¼r Seite/Karten/Text/Rahmen, wahlweise dunkler oder heller Sidebar und Live-Vorschau

Die Einstellung wird in der Datenbank gespeichert und ist nicht pro Benutzerkonto wÃ¤hlbar. Andere angemeldete Nutzer sehen sie nach dem nÃ¤chsten Laden der Seite.

Das AWO-Logo ist eine eingetragene Wort-/Bildmarke der Arbeiterwohlfahrt. Die Nutzung setzt eine entsprechende Berechtigung voraus. Quelle der eingebundenen Logo-Datei: Wikimedia Commons, `Awo-logo-08.svg`.

## Datenhaltung und Sicherung

Dauerhafte Daten liegen im Docker-Volume `awo_fuhrpark_data` unter `/app/data`:

- `awo-fuhrpark.sqlite` â€“ zentrale Datenbank
- `uploads/vehicles/` â€“ Fahrzeugbilder
- `uploads/receipts/` â€“ Kostenbelege
- `backups/` â€“ lokale Sicherungen

Konsistente Sicherung anstoÃŸen:

```bash
docker compose exec app npm run backup
docker compose cp app:/app/data/backups ./backups
```

Die Sicherung anschlieÃŸend auf ein externes Medium oder ein Backup-System kopieren. Uploads und Datenbank gehÃ¶ren zusammen und mÃ¼ssen gemeinsam gesichert werden.

## Konfiguration

| Variable | Bedeutung |
| --- | --- |
| `SESSION_SECRET` | Pflicht, mindestens 32 Zeichen |
| `ADMIN_NAME` | Anzeigename des ersten Administrators |
| `ADMIN_EMAIL` | E-Mail des ersten Administrators |
| `ADMIN_PASSWORD` | Startpasswort, nur bei leerer Benutzertabelle nÃ¶tig |
| `ORG_NAME`, `ORG_LOCATION`, `ORG_EMAIL`, `ORG_PHONE` | Erstinstallation der Organisationsdaten |
| `COOKIE_SECURE` | `true` hinter HTTPS |
| `TRUST_PROXY` | `1`, wenn ein Reverse Proxy davorsteht |
| `APP_PORT` | Host-Port fÃ¼r Docker Compose, Standard `3000` |
| `DATA_DIR` | Datenverzeichnis im Container, Standard `/app/data` |

## Dateien

```text
.
â”œâ”€ server/             Express-Anwendung, API, Schema, Bootstrap und Backup
â”œâ”€ public/             CSS, Browser-JavaScript und Branding-Dateien
â”œâ”€ server/views/       HTML fÃ¼r Anwendung und Login
â”œâ”€ tests/              Integrationstests mit temporÃ¤rer Datenbank
â”œâ”€ Dockerfile
â”œâ”€ docker-compose.yml
â”œâ”€ deploy-docker.sh     Deployment ohne Compose-Plugin
â”œâ”€ update.sh            GitHub-Update + Neustart
â”œâ”€ .env.example
â””â”€ README.md
```

## Betriebsgrenzen dieses MVPs

FÃ¼r einen echten Produktivbetrieb sind zusÃ¤tzlich einzuplanen:

- SSO/Entra ID und Mehrfaktor-Authentifizierung
- E-Mail-/Teams-Erinnerungen fÃ¼r TÃœV und Wartungen
- zentrale VirenprÃ¼fung fÃ¼r hochgeladene PDF-Belege
- standortbezogene Sichtbarkeit und Freigabeprozesse
- Aufbewahrungs- und LÃ¶schkonzept fÃ¼r Audit- und personenbezogene Daten nach DSGVO
- Datenschutz-FolgenabschÃ¤tzung und Betriebsvereinbarung bei personenbezogenen Fahrerdaten
- externe Backups, Monitoring und Wiederherstellungstests
- Lasttests und Penetrationstest vor Ã¶ffentlichem Betrieb

Die Anwendung ist fÃ¼r einen einzelnen Server mit einer SQLite-Instanz ausgelegt. FÃ¼r horizontale Skalierung oder mehrere parallele Instanzen sollte die Datenhaltung auf PostgreSQL umgestellt werden.

