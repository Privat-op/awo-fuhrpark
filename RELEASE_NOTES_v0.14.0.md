# Release Notes v0.14.0 (Entwurf)

**Status:** Entwurf für `dev`; keine QS-Freigabe, kein Tag, kein Deploy.

## Neu

- **Einstellungen → Erweitert:** eigene Admin-Seite für Betriebsparameter; Karten sind standardmäßig eingeklappt.
- **APP_BASE_URL:** in der UI pflegbar, ENV bleibt Override. Wird für Passwort-Reset-Links verwendet und ohne abschließenden Schrägstrich gespeichert.
- **Scheduler in der UI:** Leasing, Wartung/TÜV und Retention mit Aktiv-Schalter, Intervall und Startverzögerung; Leasing zusätzlich mit Debounce. Intervalle minimum 60.000 ms.
- **Scheduler-Neustart ohne Prozessneustart:** Nach dem Speichern werden die Scheduler mit der neuen Konfiguration neu initialisiert.
- **Systemstatus (read-only):** `NODE_ENV`, `HOST`, `PORT`, `DATA_DIR`, `TRUST_PROXY`, `COOKIE_SECURE`, Superadmin-Dateistatus sowie MFA-/Integrations-Schlüsselquelle. Keine Secrets oder Schlüsselwerte.
- **Eingeklappte optionale Features:** SSO-, Teams- und ClamAV-Details sind ausgeblendet, solange das Feature inaktiv ist; WebAuthn/Passkeys haben einen eigenen Aktiv-Schalter, der die Konfiguration nur deaktiviert.
- **Migration 15:** neue Spalten in `integration_settings` für Basis-URL, WebAuthn-Aktivierung und Scheduler; idempotent, bestehende Scheduler und Passkeys bleiben aktiv.

## Verhalten

- Alle bisherigen Integrations-Features bleiben standardmäßig deaktiviert.
- Scheduler-Defaults entsprechen dem bisherigen Verhalten (Leasing/Wartung 6 Stunden, Retention 24 Stunden).
- `NODE_ENV=test` hält Wartungs- und Retention-Scheduler deaktiviert.
- Retention-Fristen bleiben `0 = aus`; keine Löschung von Buchungen, Kosten oder Fahrtenbuch.
- Passwordless Login bleibt ausgeschlossen.
- Infrastruktur-/Bootstrap-Variablen (`SESSION_SECRET`, `DATA_DIR`, `PORT`, `HOST`, `SUPERADMIN_FILE`, `MFA_ENCRYPTION_KEY`, `TRUST_PROXY`, `COOKIE_SECURE`, `NODE_ENV`) bleiben ENV-only.

## Tests

- Neue Tests für Migration 14→15, ENV-vor-DB, Validierung, Scheduler-Neustart, Passwort-Reset-Link, Systemstatus und UI-Sichtbarkeit.
- Vollständige Regression: **196/196 Tests PASS**.
