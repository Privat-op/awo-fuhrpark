# Feature-Doku v0.16.0 – Logging für DEV

**Status:** implementiert auf `dev`; keine QS-Freigabe, kein Tag, kein Deploy.

## 1. Ziel

DEV-Logs ohne Rätselraten: einheitliches Format, Request-IDs, klare Fehler, separates Mail-Log und Rotation – ohne Secrets oder personenbezogene Daten.

## 2. Zentraler Logger

`server/lib/logger.js` bietet `debug`, `info`, `warn`, `error`.

- **Format:** ISO-Zeitstempel, Level, Komponente, Nachricht, Kontext.
- `LOG_FORMAT=text|json` (Default `text`).
- `LOG_LEVEL=debug|info|warn|error` (Default `info`; DEV `debug`).
- **Redaction:** Passwörter, Secrets, Tokens, Cookies, Authorization, CSRF, WebAuthn-Challenges, SSO-Codes/ID-Tokens, SMTP-Passwörter, Webhook-URLs, Session-IDs und E-Mail-Adressen.
- **Fehler:** nur `name`, `code`, `message`, `stack`, jeweils sanitisiert.
- Bestehende `console.*`-Aufrufe im Servercode wurden auf den Logger umgestellt (u. a. `index.js`, `smtp.js`, `teams.js`, `leasing.js`, `booking-request-notifications.js`, `maintenance-reminders.js`, `retention.js`, Audit/Session/Scheduler).

## 3. Request-Logging

- Middleware setzt `X-Request-Id` (vorhandene ID wird validiert übernommen, sonst UUID).
- `LOG_REQUESTS=1` aktiviert Request-Logs; Default: `0` in Produktion, sonst `1`.
- Pro Request: Methode, Pfad ohne Query, Status, Dauer, Request-ID, User-ID/Rolle (falls angemeldet), maskierte IP.
- Keine Bodies, Cookies, Auth-Header oder Passwörter.
- Statische Assets, `/healthz`, `/robots.txt` und `/branding/*` werden nicht geloggt.
- Fehler: 5xx = `error`, 4xx = `warn`, 404 = `debug`, jeweils mit Request-ID/User/Methode/Pfad.

## 4. Mail-Log

- `LOG_DIR` (DEV `C:\awo-fuhrpark-local\logs`, Default `DATA_DIR/logs`).
- `mail.log` für SMTP-, Teams- und Retention-Versuche:
  - Zeitstempel, Kanal (`smtp`/`teams`/`system`), Event (`smtp_test`, `password_reset`, `leasing`, `booking_request`, `maintenance`, `retention`), Empfängeranzahl, Status, Fehlercode, Dauer.
  - Keine E-Mail-Adressen, Webhook-URLs, Betreffzeilen oder Secrets.
- Rotation bei 5 MB; `mail.log` plus zwei Archive (`.1`, `.2`).

## 5. Startup-Log

Beim Start werden geloggt:

- Version, `APP_COMMIT`, `user_version`, `DATA_DIR`, Port, `NODE_ENV`
- Feature-Flags nur als `configured: true/false` (SSO, Teams, ClamAV, WebAuthn, Locations)
- Schlüsselquelle für MFA und Integrationen als `env`/`file`/`missing`

Keine Schlüsselwerte, Secrets oder URLs.

## 6. Rotation

- `dev-app.log` und `dev-supervisor.log` werden vom DEV-Supervisor vor dem Start bei > 10 MB rotiert (maximal 5 Dateien).
- `mail.log` wird durch die Anwendung separat rotiert.
- Rename-Rotation; laufende Requests verlieren keine Logzeilen.

## 7. DEV-Konfiguration

In `C:\awo-fuhrpark-local\admin.env`:

```text
LOG_LEVEL=debug
LOG_REQUESTS=1
LOG_FORMAT=text
LOG_DIR=C:\awo-fuhrpark-local\logs
```

Produktion: `LOG_LEVEL=info`, `LOG_REQUESTS=0`, `LOG_FORMAT=text`, `LOG_DIR=DATA_DIR/logs`.

## 8. Sidecars

`dev-http.log` und `mail-events.log` können übergangsweise parallel betrieben werden. Die Anwendung schreibt ausschließlich `mail.log`, nicht `mail-events.log`.

## 9. Migration-16-Cleanup

Wenn bereits eine `webhooks`-Zeile existiert, entfernt die Migration den Legacy-DB-Teams-Webhook (`teams_webhook_enc = NULL`, `teams_enabled = 0`), ohne bestehende Webhook-Zeilen zu löschen. Die Bereinigung läuft auch bei bereits auf `user_version = 16` stehenden Datenbanken beim nächsten Start. Damit entstehen keine doppelten Legacy-Zustellungen.

## 10. Tests

- Redaction (Passwort/Token/Cookie/Challenge/URL/E-Mail).
- JSON-/Text-Format und Level-Filter.
- Request-Log-Format, Request-ID, maskierte IP, Asset-/Health-Skip, 404-Debug.
- Mail-Log ohne Adressen; Rotation mit Temp-Dateien.
- Migration 16: Legacy-Cleanup bei vorhandener Webhook-Zeile.
- Vollständige Regression: **207/207 Tests**.
