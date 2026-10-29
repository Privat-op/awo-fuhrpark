# Release Notes v0.13.0 (Entwurf)

**Status:** Entwurf für `dev`; keine QS-Freigabe, kein Tag, kein Deploy.

## Neu

- **Einstellungen → Integrationen:** zentrale Admin-Seite für SSO/Entra ID, Microsoft Teams, ClamAV, WebAuthn/Passkeys, Retention und Standorte.
- **ENV-Override:** gesetzte Umgebungsvariablen haben Vorrang; betroffene Felder sind schreibgeschützt und gekennzeichnet. Änderungen wirken ohne Neustart.
- **Verschlüsselte Secrets:** SSO-Client-Secret und Teams-Webhook werden mit AES-256-GCM gespeichert. Schlüssel aus `INTEGRATIONS_ENCRYPTION_KEY` oder `DATA_DIR/integrations.key` (`0600`). DB und Schlüssel gemeinsam sichern.
- **Testfunktionen:** OIDC-Discovery/JWKS, Teams-Testkarte, ClamAV-Testscan und WebAuthn-Konfigurationsprüfung.
- **Secret-Hygiene:** Secrets erscheinen nie in State, Export, Audit oder Logs; UI zeigt nur „gesetzt/nicht gesetzt“ und maskierte Eingabefelder.
- **Migration 14:** neue Tabelle `integration_settings` mit einer Zeile; idempotent.

## Verhalten

- Alle Integrations-Features bleiben standardmäßig deaktiviert.
- Bestehende ENV-Konfigurationen funktionieren unverändert; ein ENV-Teams-Webhook bleibt ohne `TEAMS_ENABLED` aktiv.
- Retention bleibt `0 = aus`; keine Löschung von Buchungen, Kosten oder Fahrtenbuch.
- Standortfunktion bleibt standardmäßig aus.
- Passwordless Login bleibt ausgeschlossen.
- Infrastruktur-/Bootstrap-Variablen (`SESSION_SECRET`, `DATA_DIR`, `PORT`, `HOST`, `SUPERADMIN_FILE`, `MFA_ENCRYPTION_KEY`, `TRUST_PROXY`, `COOKIE_SECURE`, `NODE_ENV`) bleiben ENV-only.

## Betrieb

- Beim ersten Start wird `DATA_DIR/integrations.key` erzeugt, falls kein `INTEGRATIONS_ENCRYPTION_KEY` gesetzt ist.
- Backup-Hinweis: Datenbank und `integrations.key` gehören zusammen; ohne Schlüssel sind gespeicherte Integrations-Secrets verloren.
- Keine Änderungen an Tunnel, SMTP, Release- oder Deploy-Wegen.

## Tests

- Neue Integrations-Tests: Migration, ENV-vor-DB, Secret-Hygiene, Validierung, Test-Endpunkte mit lokalen Mocks.
- Vollständige Regression: **187/187 Tests PASS**.
