# Release Notes v0.15.0 (Entwurf)

**Status:** Entwurf fÃ¼r `dev`; keine QS-Freigabe, kein Tag, kein Deploy.

## Neu

- **Allgemeine Webhooks:** mehrere Endpunkte unter **Einstellungen â†’ Integrationen â†’ Webhooks**.
- **Formate:** generisch, Microsoft Teams (MessageCard), Discord und Slack.
- **Event-Abos:** Leasing, Buchungsanfragen und Wartung/TÃœV pro Webhook.
- **HMAC:** optionales Secret; `X-AWO-Timestamp`, `X-AWO-Event`, `X-AWO-Delivery`, `X-AWO-Signature`.
- **SSRF-Schutz:** DNS-AuflÃ¶sung, Block von Loopback/privaten/Link-Local-/Metadaten-Adressen, Allowlist Ã¼ber `WEBHOOK_ALLOW_PRIVATE_HOSTS`, manuelle Redirect-PrÃ¼fung (max. 2).
- **Sichere Secrets:** Webhook-URL und HMAC-Secret AES-256-GCM verschlÃ¼sselt; UI/State/Export/Audit nur `urlSet`, `secretSet` und Hostname.
- **Retry/Dedupe:** `notification_deliveries` mit `channel = webhook:<id>`, 6 h Retry, 15 min Pending-Timeout; Fehler blockieren API/Scheduler nicht.
- **Test-Endpunkt:** synchrones Ergebnis mit Status/Errorcode, Audit ohne URL/Secret.
- **Legacy-Migration:** vorhandener DB-Teams-Webhook wird Ã¼bernommen (Discord-Hosts â†’ Discord) und aus den Integrationen entfernt; `TEAMS_WEBHOOK_URL` bleibt ENV-Fallback.
- **Migration 16:** neue Tabelle `webhooks`, idempotent.

## Verhalten

- Keine Webhooks sind standardmÃ¤ÃŸig aktiv; bestehendes Verhalten bleibt, bis Endpunkte konfiguriert sind.
- Teams-Karte ist als **Legacy/Preset** markiert; die Webhook-Liste ist primÃ¤r.
- Payloads enthalten keine EmpfÃ¤nger-E-Mail-Adressen.
- Passwordless Login bleibt ausgeschlossen.
- Infrastruktur-/Bootstrap-Variablen bleiben ENV-only.

## Betrieb

- `DATA_DIR/integrations.key` bzw. `INTEGRATIONS_ENCRYPTION_KEY` sichert Webhook-URLs und -Secrets; gemeinsam mit der DB sichern.
- Interne Webhook-Ziele nur nach PrÃ¼fung Ã¼ber `WEBHOOK_ALLOW_PRIVATE_HOSTS` freigeben.
- Keine Ã„nderungen an Tunnel, SMTP, Release oder Deploy.

## Tests

- Neue Webhook-Tests: Migration, SSRF, Formate, HMAC, Dispatch/Dedupe/Retry, API, Secret-Hygiene.
- VollstÃ¤ndige Regression: **213/213 Tests PASS**.
