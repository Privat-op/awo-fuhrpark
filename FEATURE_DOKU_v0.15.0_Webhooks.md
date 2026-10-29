# Feature-Doku v0.15.0 – Allgemeine Webhooks

**Status:** implementiert auf `dev`; keine QS-Freigabe, kein Tag, kein Deploy.  
**Migration:** `user_version = 16` (aufbauend auf 15).  
**Zugriff:** `settings_manage`/Administrator:innen.

## 1. Ziel

Der Teams-spezifische Webhook wird durch ein allgemeines Webhook-System mit mehreren Endpunkten, Formaten und Event-Abos ersetzt. Die bestehende Teams-Karte bleibt als **Legacy/Preset** für `TEAMS_WEBHOOK_URL`; die neue Liste unter **Einstellungen → Integrationen → Webhooks** ist die primäre Oberfläche.

## 2. Datenmodell (Migration 15→16)

Neue Tabelle `webhooks`:

| Spalte | Bedeutung |
|---|---|
| `id` | UUID |
| `name` | Anzeigename |
| `url_enc` | AES-256-GCM verschlüsselte Webhook-URL (Secret) |
| `enabled` | 0/1 |
| `format` | `generic`, `teams`, `discord`, `slack` |
| `events` | JSON-Array: `leasing`, `booking_request`, `maintenance`, `test` |
| `secret_enc` | optionales HMAC-Secret, AES-256-GCM |
| `created_at`, `updated_at` | Betrieb |

Keine neue Delivery-Tabelle: `notification_deliveries` wird mit `channel = webhook:<id>` und `dedupe_key = webhook:<id>:<event>:<key>` weiterverwendet. Fehlercodes: `WEBHOOK_ERROR`, `WEBHOOK_HTTP_<status>`, `WEBHOOK_TIMEOUT`, `WEBHOOK_BLOCKED`. Bestehende `teams:`-Deliveries bleiben unverändert.

### Migration des bestehenden Teams-Webhooks

- Wenn `integration_settings.teams_webhook_enc` gesetzt ist und noch kein Webhook existiert, wird ein Eintrag angelegt.
- Discord-Hosts (`discord.com`, `discordapp.com` inkl. Subdomains) → `format=discord`, sonst `format=teams`.
- Events werden aus `teams_send_leasing`, `teams_send_booking_requests` und `teams_send_maintenance` übernommen; `enabled` aus `teams_enabled`.
- Danach wird der DB-Teams-Webhook aus `integration_settings` entfernt, damit keine Doppelzustellung entsteht. `TEAMS_WEBHOOK_URL` bleibt als ENV-Fallback aktiv; nach der Übernahme die ENV-Variable entfernen, sonst sendet Teams parallel weiter.

## 3. Formate

- **generic:** `{ event, title, text, timestamp, data }`
- **teams:** bestehende MessageCard (`@type`, `@context`, `summary`, `themeColor`, `title`, `text`)
- **discord:** `{ content: "**<title>**\n<text>" }`, auf 2.000 Zeichen begrenzt
- **slack:** `{ text: "*<title>*\n<text>" }`

Payloads enthalten keine E-Mail-Adressen oder Empfängerlisten. Buchungs-Payloads lassen Personen-Namen weg; Fahrzeug, Zeitraum und Zweck bleiben enthalten.

## 4. Sicherheit

- **SSRF-Schutz:** nur `http`/`https`, keine Credentials in der URL; Hostname wird per DNS aufgelöst. Loopback-, private, Link-Local- und Metadaten-Adressen werden blockiert. `WEBHOOK_ALLOW_PRIVATE_HOSTS` erlaubt exakt gelistete Hostnamen (kommagetrennt, Standard leer).
- **Redirects:** `redirect: 'manual'`, maximal 2 Sprünge, jede Ziel-URL wird erneut validiert.
- **Netzwerk:** Timeout 8 s; Response-Body wird max. 64 KB gelesen und verworfen; keine Response-Inhalte in Logs.
- **Verschlüsselung:** URL und HMAC-Secret mit AES-256-GCM; Schlüssel aus `INTEGRATIONS_ENCRYPTION_KEY` oder `DATA_DIR/integrations.key`. Backup-Hinweis: Schlüssel und DB gemeinsam sichern.
- **Maskierung:** API, State, Export und Audit enthalten nur `urlSet`, `secretSet`, Hostname und Status – niemals URL oder Secret.
- **HMAC:** `X-AWO-Timestamp` (Unix-Sekunden), `X-AWO-Event`, `X-AWO-Delivery`, `X-AWO-Signature: sha256=<hex>` über `${timestamp}.${body}`.

## 5. Dispatch

`server/lib/webhooks.js` stellt `dispatchWebhooks(db, event, payload, options)` bereit:

- Leasing-, Buchungsanfragen- und Wartungs-Code rufen es zusätzlich zu E-Mail/Teams auf.
- Fehler blockieren API und Scheduler nicht.
- Retry alle 6 Stunden, Pending-Timeout 15 Minuten, Dedupe über `notification_deliveries`.
- Audit `webhook_delivery` mit Status/Errorcode, ohne URL/Secret.

## 6. API und UI

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/webhooks` | Liste ohne Secrets |
| POST | `/api/webhooks` | anlegen |
| PATCH | `/api/webhooks/:id` | bearbeiten |
| DELETE | `/api/webhooks/:id` | löschen |
| POST | `/api/webhooks/:id/test` | Test-Event, synchrones Ergebnis |

UI: Karte **Webhooks** auf der Integrationsseite mit Liste (Name, Host, Format, Events, Status), Testen/Bearbeiten/Löschen, Leerzustand und Dialog für Name, URL (maskiert), Format, Events, optionales HMAC-Secret und Aktivstatus. Warnhinweis zu privaten Hosts/SSRF.

## 7. Tests

- Migration 15→16 idempotent, Discord- und Teams-Erkennung, Legacy-Bereinigung.
- URL-/Secret-Verschlüsselung, Maskierung, keine URLs/Secrets in State/Audit.
- SSRF: Loopback, privat, Link-Local, Metadaten, IPv6; Allowlist; Redirect-Prüfung.
- Formate inkl. Discord-Limit; HMAC-Signatur.
- Dispatch: Event-Filter, mehrere/disabled Webhooks, Dedupe, Retry, HTTP-/Timeout-Fehler.
- API-CRUD, Test-Endpunkt, Audit.
- Vollständige Regression: **207/207 Tests**.

## 8. Offene Punkte

- Interne Webhook-Ziele und Allowlist fachlich festlegen.
- Produktive Endpunkte/Formate und HMAC-Secrets über den Betriebsweg setzen; keine Werte im Repository.
- Restrisiko DNS-Rebinding zwischen Prüfung und Verbindung dokumentieren; bei Bedarf Network-Pinning im Betrieb.
- Keine QS-Freigabe, kein Tag, kein Deploy.
