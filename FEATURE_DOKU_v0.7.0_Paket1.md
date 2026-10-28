# AWO Fuhrparkmanagement – Feature-Doku v0.7.0 Paket 1

**Stand:** 28.10.2026  
**Branch:** `main` (Release v0.7.0)  
**Basis:** `df819ff` (v0.6.2)  
**Status:** QS-freigegeben (51/51 Checks, keine Findings), Release v0.7.0  
**Nicht enthalten:** Kostenstellen (Paket 2) und Dark Mode (Paket 3) – nur Design/Estimate.

## 1. Ziel

Paket 1 ergänzt die Leasingüberwachung und einen optionalen E-Mail-Versand für Leasing-Warnungen. Bestandsfahrzeuge ohne Leasingdaten bleiben unverändert. Warnungen sind Hinweise und blockieren keine Buchungen.

## 2. Datenmodell und Migration

Migration `server/lib/leasing-schema.js`, `LEASING_SCHEMA_VERSION = 5`, idempotent.

### Fahrzeugfelder (`vehicles`)

| Feld | Typ | Bedeutung |
|---|---|---|
| `leasing_start` | TEXT / ISO-Datum | Leasingbeginn, optional |
| `leasing_end` | TEXT / ISO-Datum | Leasingende |
| `leasing_start_km` | INTEGER | Kilometerstand bei Leasingbeginn |
| `leasing_km_limit` | INTEGER | Gesamt-Kilometerlimit über die Laufzeit |

Ohne `leasing_end` und `leasing_km_limit` liefert der State `leasing: null`; es gibt keine Warnung und keine Mail.

### SMTP (`smtp_settings`, eine Zeile)

`host`, `port`, `secure`, `username`, `from_address`, `enabled`, `updated_at`. Das Passwort liegt **nicht** in dieser Tabelle.

### Dedupe (`notification_deliveries`)

`dedupe_key` (unique), `channel`, `vehicle_id`, `kind`, `status`, `attempts`, `last_attempt_at`, `error_code`, Zeitstempel. Der Dedupe-Key enthält Fahrzeug-ID, Schwelle und einen Hash aus Leasingzeitraum/Startkilometer/Limit. Damit wird pro Fahrzeug, Schwelle und Leasingzeitraum höchstens einmal versendet.

## 3. Berechnung und Warnschwellen

`server/lib/leasing.js`:

- Verbrauchte Kilometer: `max(0, mileage - leasing_start_km)`.
- Restkilometer: `leasing_km_limit - used`.
- Prozent: gerundet auf eine Nachkommastelle.
- Kilometerstufe: `80`, `90`, `100` (jeweils höchste erreichte Stufe).
- Leasingende: `90` Tage, `30` Tage, `expired` (überfällig).
- Status: `ok`, `warning`, `critical`.
- Fahrzeug-State enthält `leasing` mit `usedKm`, `remainingKm`, `percent`, `kmLevel`, `daysRemaining`, `endLevel`, `status` und `warnings[]`.

Warnungen erscheinen in:

- Fahrzeugliste (`leasing-strip`),
- Fahrzeugdetails (Banner, Fortschrittsbalken, Restkilometer),
- Dashboard und Benachrichtigungsglocke (`getAlerts`),
- Buchungsdialog und Buchungsanfrage (Hinweis beim ausgewählten Fahrzeug),
- API-Antworten nach Buchung/Fahrtende/Nachtragung (`leasingWarning`).

Die API blockiert bei einer Warnung nicht. Es gibt weiterhin nur die bestehenden harten Sperren (dauerhafte Fahrzeugsperre, Wartung, Konflikte).

## 4. E-Mail-Versand

### Konfiguration

- `PATCH /api/smtp` und `POST /api/smtp/test` sind über `requireAdmin` ausschließlich für Administrator:innen (und Superadmin) erreichbar.
- Nicht-Administrator:innen erhalten im State kein `smtp`-Objekt.
- Das Passwort wird separat in `DATA_DIR/smtp-secret.json` gespeichert (atomar, Modus 0600 auf Linux). Es erscheint nicht in State, JSON-Export, Audit oder Logs.
- `PATCH /api/smtp` akzeptiert `password` zum Setzen und `clearPassword` zum Entfernen. Leer lassen behält das gespeicherte Passwort.
- Ohne `enabled=true`, Host, gültige Absenderadresse und – falls Benutzername gesetzt – Passwort wird nicht versendet.

### Empfänger

Aktive Konten mit Rolle `admin` oder `manager`, ohne anonymisierte Konten, dedupliziert. Keine Empfänger → kein Versand (`no_recipients`).

### Versand und Fehler

- `server/lib/smtp.js` kapselt Validierung, Secret-Datei und Nodemailer-Transport; Tests injizieren eine `transportFactory` und versenden keine echten Mails.
- Fehler werden nur als Code (z. B. `EAUTH`, `ECONNECTION`) gespeichert/geloggt, nicht mit Host, Benutzer oder Passwort.
- Fehlversuche: maximal drei Versuche, Wiederholung frühestens nach sechs Stunden.
- Erfolgreiche und fehlgeschlagene Versuche werden als `leasing_notification` auditiert (ohne Empfängeradressen).

### Scheduler

- Startlauf fünf Sekunden nach Serverstart, danach alle sechs Stunden.
- Zusätzlich Debounce-Prüfung nach Fahrzeugänderung mit Kilometer-/Leasingbezug, Fahrtende und Nachtragung.
- `LEASING_SCHEDULER_DISABLED=true` deaktiviert den Scheduler (Tests/Betrieb).
- Fehler im Scheduler werden abgefangen; der Webserver bleibt funktionsfähig.

## 5. API-Änderungen

| Methode | Pfad | Recht | Zweck |
|---|---|---|---|
| GET | `/api/state` | angemeldet | Fahrzeug-`leasing`; `smtp` nur für Administrator:innen |
| POST/PATCH | `/api/vehicles` | `vehicles_manage` | Leasingfelder lesen/schreiben, Audit `leasing_update` |
| PATCH | `/api/smtp` | Admin | SMTP-Konfiguration speichern |
| POST | `/api/smtp/test` | Admin | Testmail an angemeldete Administrator:in |
| POST | `/api/bookings` | `bookings_create` | Antwort enthält `leasingWarning` |
| POST | `/api/bookings/:id/end` | Buchungsrecht | Antwort enthält `leasingWarning` |
| POST | `/api/trips` | `logbook_manage` | Antwort enthält `leasingWarning` |
| POST | `/api/booking-requests` | `own_trips_request` | Antwort enthält `requestWarning` und `leasingWarning` |

Das JSON-Export entfernt `smtp` explizit.

## 6. Rechte und Audit

- Keine neuen Rollenrechte oder Objekttypen. Leasing ist Teil von `vehicles_view`/`vehicles_manage`.
- SMTP ist bewusst **nicht** über `settings_manage` delegierbar, sondern an die Administrator-Rolle gebunden.
- Audit-Aktionen: `leasing_update`, `leasing_notification`, `smtp_test`, `update`/`smtp`.
- Audit-Details enthalten keine Passwörter, Hostnamen oder Empfängeradressen.

## 7. UI

- Fahrzeugdialog: Abschnitt „Leasing“ mit Beginn, Ende, Startkilometer und Gesamt-Kilometerlimit.
- Fahrzeugkarte: kompakter Warnstreifen bei 80/90/100 % oder Leasingende.
- Fahrzeugdetails: Warnbanner, Fortschrittsbalken, verbrauchte/verbleibende Kilometer und Leasingende.
- Einstellungen: Karte „E-Mail-Versand“ nur für Administrator:innen, inklusive Test-E-Mail und Passwort-Hinweis.
- Buchungsdialoge: dynamischer Leasing-Hinweis beim Fahrzeugwechsel.

## 8. Tests

**Neu:** `tests/leasing.test.js` (7 Tests) und `tests/leasing-api.test.js` (5 Tests).

Abgedeckt:

- Schwellen 80/90/100 %, Restkilometer, Überschreitung.
- Leasingende 90/30/überfällig.
- Fahrzeuge ohne Leasing.
- Dedupe pro Schwelle/Zeitraum; erneuter Versand erst bei nächster Schwelle.
- SMTP-Fehler `EAUTH`, begrenzter Retry, keine Secrets in Delivery/Audit.
- SMTP-Passwort nicht im öffentlichen State; separate Secret-Datei.
- Idempotente Migration auf `user_version = 5`.
- API: Speichern/Berechnen/Audit, Bestandsfahrzeug ohne Leasing.
- Rechte: Viewer darf nicht bearbeiten, Manager kein SMTP, Admin schon.
- SMTP-Admin-only; Passwort nicht in State/Export/Audit.
- Buchung mit Leasing-Warnung bleibt `planned` (keine Blockade).

**Regression:** vollständige Suite `node --test` → **55/55 Tests grün**. Darin enthalten: QS-001 (Exportrechte), QS-005 (Migration `last_login_at`), QS-007 (logbook_view), QS-008 (CSV-Formel-Injection), Superadmin-, Rollen- und UI-Tests. `npm audit --omit=dev` → **0 Vulnerabilities**.

**UI-Smoke (lokaler Temporärserver, kein Deploy):** Anmeldung als Admin, Fahrzeug mit 80.000 km / 100.000 km Limit und Leasingende in 90 Tagen angelegt. Ergebnis: Leasing-Warnstreifen auf der Fahrzeugkarte, zwei Hinweise in der Benachrichtigungsglocke, vollständige Leasinganzeige in den Fahrzeugdetails, beide Warnungen im Buchungsdialog, Warn-Toast nach dem Speichern der Buchung, SMTP-Karte in den Einstellungen mit leerem Passwortfeld. Keine Konsolenfehler.

## 9. Betrieb und Grenzen

- Kein Echtversand ohne aktivierte SMTP-Konfiguration; Tests nutzen ausschließlich Fake-Transports.
- Keine Mail-Queue mit externem Worker; Versand läuft im Serverprozess. Bei sehr langsamem SMTP kann ein Prüflauf verzögert sein, der Webserver bleibt durch Timeouts geschützt.
- Das SMTP-Passwort liegt im Daten-Volume, wird vom Backup-Skript (`server/backup.js`) aber bewusst nicht mitgesichert. Nach einer Wiederherstellung muss es neu gesetzt werden.
- Kein Deploy, kein Merge nach `main`, keine Änderung an STABLE.
- Paket 2/3 sind nicht implementiert.

## 10. QS-Übergabe

Bitte prüfen:

1. Migration von v0.6.2 (`user_version = 4`) auf 5, Idempotenz, Bestandsfahrzeuge ohne Leasing.
2. Schwellen und Dedupe inkl. Retry-Grenzen.
3. SMTP-Admin-only, Passwort nicht in State/Export/Audit/Logs.
4. Rechte: `vehicles_view`/`vehicles_manage`, Manager kein SMTP.
5. UI-Darstellung und Buchungswarnung ohne Blockade.
6. Regression QS-001/005/007/008.
