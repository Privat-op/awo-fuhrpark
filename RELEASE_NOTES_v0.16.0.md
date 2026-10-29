# Release Notes v0.16.0 (Entwurf)

**Status:** Entwurf für `dev`; keine QS-Freigabe, kein Tag, kein Deploy.

## Neu

- **Zentraler Logger:** `debug/info/warn/error`, ISO-Zeitstempel, Komponente und Kontext; `LOG_FORMAT=text|json`, `LOG_LEVEL`.
- **Redaction:** keine Passwörter, Secrets, Tokens, Cookies, Authorization, CSRF, WebAuthn-Challenges, SSO-Codes/ID-Tokens, SMTP-Passwörter, Webhook-URLs, Session-IDs oder E-Mail-Adressen in Logs.
- **Request-Logging:** `LOG_REQUESTS=1` (DEV), Request-ID (`X-Request-Id`), Methode/Pfad ohne Query/Status/Dauer/User/Rolle/maskierte IP; keine Bodies oder Auth-Header.
- **Fehler-Logging:** 5xx = error, 4xx = warn, 404 = debug – mit Request-ID/User/Methode/Pfad.
- **Mail-Log:** `LOG_DIR/mail.log` für SMTP-, Teams- und Retention-Versuche mit Kanal, Event, Empfängeranzahl, Status, Fehlercode und Dauer; Rotation bei 5 MB.
- **Startup-Log:** Version, `APP_COMMIT`, `user_version`, `DATA_DIR`, Port, `NODE_ENV`, Feature-Flags als `configured` und Schlüsselquelle (`env`/`file`/`missing`) – ohne Secrets.
- **DEV-Konfiguration:** `admin.env` mit `LOG_LEVEL=debug`, `LOG_REQUESTS=1`, `LOG_FORMAT=text`, `LOG_DIR`.
- **Migration-16-Cleanup:** Legacy-Teams-Webhook wird auch bei bereits vorhandenen Webhooks aus `integration_settings` entfernt; keine Duplikate, keine Webhook-Zeile gelöscht.

## Verhalten

- Audit-Inhalte bleiben unverändert.
- Keine Secrets/PII in Logs.
- `dev-http.log`/`mail-events.log`-Sidecars können übergangsweise weiterlaufen; die App schreibt nur `mail.log`.
- Produktion: `LOG_LEVEL=info`, `LOG_REQUESTS=0`.
- Keine Tunnel-/SMTP-/Release-/Deploy-Änderungen, kein Supervisor-Neustart.

## Tests

- Neue Logger-Tests: Redaction, Formate, Request-Logs, Mail-Log, Rotation.
- Migration-16-Cleanup-Test.
- Vollständige Regression: **218/218 Tests PASS**.
