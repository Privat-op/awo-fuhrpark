# Feature-Doku v0.13.0 – Integrationen (Admin)

**Status:** implementiert auf `dev`; keine QS-Freigabe, kein Tag, kein Deploy.  
**Migration:** `user_version = 14` (`integration_settings`); v0.14.0 erweitert auf 15.  
**Zugriff:** `settings_manage` bzw. Administrator:innen; Inhalte werden nur an berechtigte Konten im State ausgeliefert.

## 1. Ziel

SSO, Teams, ClamAV, WebAuthn, Retention und Standorte zentral unter **Einstellungen → Integrationen** verwalten. Die ENV-Konfiguration bleibt Override für den Betrieb; bestehende Installationen verhalten sich unverändert.

## 2. Vorrangregel

- Eine ENV-Variable gilt als gesetzt, wenn sie existiert und nach Trimmen nicht leer ist.
- Gesetzte ENV gewinnt; das UI-Feld ist schreibgeschützt und mit „durch Umgebung gesetzt“ markiert.
- Sonst gilt der Datenbankwert aus `integration_settings`.
- Secrets werden nur geändert oder entfernt, wenn die zugehörige ENV-Variable nicht gesetzt ist.
- Kein Neustart nötig: Die Konfiguration wird pro Anfrage gelesen.

Ausnahme Teams-Altverhalten: Ist `TEAMS_WEBHOOK_URL` per ENV gesetzt und `TEAMS_ENABLED` nicht, bleibt Teams wie bisher aktiv. Ein reiner DB-Webhook benötigt `teams_enabled = 1`.

## 3. Datenmodell

`integration_settings` (genau eine Zeile `id = 1`):

- SSO: `sso_enabled`, `sso_issuer`, `sso_client_id`, `sso_client_secret_enc`, `sso_redirect_uri`, `sso_scopes`, `sso_allowed_domains`, `sso_auto_provision`, `sso_default_role`, `sso_group_claim`, `sso_admin_group`, `sso_manager_group`.
- Teams: `teams_enabled`, `teams_webhook_enc`, `teams_send_leasing`, `teams_send_booking_requests`, `teams_send_maintenance`.
- ClamAV: `clamav_enabled`, `clamav_host`, `clamav_port`, `clamav_fail_closed`.
- WebAuthn: `webauthn_rp_id`, `webauthn_rp_name`, `webauthn_origin`.
- Standorte: `locations_enabled`.
- `updated_at`.

Retention bleibt in `settings` und wird auf der Integrationsseite mitverwaltet.

## 4. Secret-Handling

- Verschlüsselung: AES-256-GCM, AAD je Feld, Format `v1.<iv>.<tag>.<ciphertext>`.
- Schlüssel: `INTEGRATIONS_ENCRYPTION_KEY` (32 Byte Base64 oder 64 Hex) oder `DATA_DIR/integrations.key` (automatisch erzeugt, `0600`).
- **Backup:** Datenbank und Schlüsseldatei gehören zusammen. Ohne Schlüssel sind gespeicherte Secrets nicht entschlüsselbar.
- API/State/Export/Audit enthalten nur `clientSecretSet`/`webhookSet` und die Quelle (`env`, `db`, `none`). Secret-Felder sind maskiert.
- „Secret entfernen“ löscht den verschlüsselten Wert. Wird der Teams-Webhook entfernt, wird Teams automatisch deaktiviert.
- Audit `update`/`integration_test` enthält nur Feldnamen, Status und Fehlercodes, niemals Werte.

## 5. API

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/integrations` | sichere Konfiguration inkl. `envLocked` und Retention |
| PATCH | `/api/integrations` | nicht gesperrte Werte aktualisieren, validieren, Audit |
| POST | `/api/integrations/test/sso` | OIDC-Discovery und JWKS |
| POST | `/api/integrations/test/teams` | Testkarte an den Webhook |
| POST | `/api/integrations/test/clamav` | harmlose Testdatei über clamd INSTREAM |
| POST | `/api/integrations/test/webauthn` | RP-ID/Origin-Validierung ohne Netzwerk |

Alle Endpunkte benötigen CSRF und `settings_manage`.

## 6. Validierung

- SSO: Pflichtfelder nur bei aktiviertem SSO; Issuer und Redirect-URI nur `http(s)`, keine Credentials in der URL; Default-Rolle nie `superadmin`, muss bei JIT existieren.
- Teams: bei Aktivierung gültige `http(s)`-Webhook-URL.
- ClamAV: Host erforderlich, Port 1–65535.
- WebAuthn: RP-ID, RP-Name und Origin gemeinsam; jede Origin muss zur RP-ID passen.
- Standorte/Retention: unverändert; `0 = aus`.

## 7. UI

- Eigene Route `#/integrationen`, sichtbar für `settings_manage`.
- Karten für SSO, Teams, ClamAV, WebAuthn, Retention und Standort-Toggle mit Status-Badge (Aktiv/Unvollständig/Inaktiv).
- ENV-gesperrte Felder sind `disabled` und mit Badge/Hinweis markiert.
- Secrets nur als Passwortfeld mit Platzhalter; kein Secret im JS-State oder `localStorage`.
- Test-Buttons mit Toast-Rückmeldung; Fehlermeldungen ohne Secrets.
- Warnhinweis bei WebAuthn-Änderungen, weil bestehende Passkeys brechen können.
- Die frühere Retention-Karte auf der Einstellungsseite ist durch einen Link auf die Integrationsseite ersetzt.

## 8. Tests

`tests/integrations.test.js`:

- Migration 13→14 idempotent, eine Zeile, Defaults aus.
- ENV-vor-DB-Präzedenz und `envLocked`.
- Verschlüsselung at rest, Maskierung, kein Secret in API/State/Audit, Schlüsseldatei.
- Validierungsfehler und Rollback.
- API: ENV-Sperre, Secret setzen/entfernen, Auto-Deaktivierung von Teams.
- Test-Endpunkte gegen lokale Mocks: OIDC-Discovery/JWKS, Teams-Webhook, clamd, WebAuthn.
- Vollständige Regression: 213/213 Tests.

## 9. Offene Punkte

- Produktive Entra-/Teams-/ClamAV-Werte und WebAuthn-Domain festlegen.
- Betriebsweg für die Sicherung von `integrations.key` dokumentieren und testen.
- Retention-Fristen bleiben bis zur rechtlichen Freigabe `0`.
- Keine QS-Freigabe, kein Tag, kein Deploy.
