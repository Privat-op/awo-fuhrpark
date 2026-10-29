# Feature-Doku v0.14.0 – Erweitert (Betrieb & Scheduler)

**Status:** implementiert auf `dev`; keine QS-Freigabe, kein Tag, kein Deploy.  
**Migration:** `user_version = 15` (aufbauend auf 14).  
**Zugriff:** `settings_manage`/Administrator:innen; Karten standardmäßig eingeklappt.

## 1. Ziel

Alle app-level Betriebswerte in der UI verfügbar machen, ohne Infrastruktur-/Bootstrap-Konfiguration zu öffnen:

- `APP_BASE_URL`
- Leasing-, Wartungs-/TÜV- und Retention-Scheduler (Aktivstatus, Intervall, Startverzögerung, Leasing-Debounce)
- Read-only-Systemstatus

## 2. Datenmodell (Migration 14→15)

Neue Spalten in `integration_settings` (eine Zeile):

| Spalte | Default | Bedeutung |
|---|---|---|
| `webauthn_enabled` | `1` | WebAuthn/Passkeys aktiv (Konfiguration bleibt erhalten) |
| `app_base_url` | `''` | öffentliche Basis-URL |
| `leasing_scheduler_enabled` | `1` | Scheduler aktiv |
| `leasing_interval_ms` | `21600000` | 6 Stunden |
| `leasing_initial_delay_ms` | `5000` | erster Lauf |
| `leasing_debounce_ms` | `3000` | Debounce |
| `reminder_scheduler_enabled` | `1` | Scheduler aktiv |
| `reminder_interval_ms` | `21600000` | 6 Stunden |
| `reminder_initial_delay_ms` | `5000` | erster Lauf |
| `retention_scheduler_enabled` | `1` | Scheduler aktiv |
| `retention_interval_ms` | `86400000` | 24 Stunden |
| `retention_initial_delay_ms` | `10000` | erster Lauf |

Die Migration ergänzt fehlende Spalten idempotent per `ALTER TABLE`; `schema.sql` enthält sie für Neuinstallationen. Bestehende Installationen behalten das bisherige Scheduler-Verhalten (aktiv).

## 3. ENV-Vorrang

Gesetzte, nicht leere ENV gewinnt und ist in der UI schreibgeschützt:

| UI-Wert | ENV |
|---|---|
| APP_BASE_URL | `APP_BASE_URL` |
| Leasing aktiv | `LEASING_SCHEDULER_DISABLED` (invers) |
| Leasing-Intervall | `LEASING_INTERVAL_MS` |
| Leasing-Startverzögerung | `LEASING_INITIAL_DELAY_MS` |
| Leasing-Debounce | `LEASING_DEBOUNCE_MS` |
| Wartung aktiv | `REMINDER_SCHEDULER_DISABLED` (invers) |
| Wartungs-Intervall | `REMINDER_INTERVAL_MS` |
| Wartungs-Startverzögerung | `REMINDER_INITIAL_DELAY_MS` |
| Retention aktiv | `RETENTION_SCHEDULER_DISABLED` (invers) |
| Retention-Intervall | `RETENTION_INTERVAL_MS` |
| Retention-Startverzögerung | `RETENTION_INITIAL_DELAY_MS` |

## 4. Laufzeitverhalten

- Nach einem erfolgreichen `PATCH /api/integrations` werden alle Scheduler über `server/lib/scheduler-control.js` gestoppt und mit der neuen Konfiguration neu gestartet – ohne Prozessneustart.
- `triggerLeasingCheck` liest den Debounce-Wert bei jedem Aufruf aus der Datenbank.
- `NODE_ENV=test` hält Wartungs- und Retention-Scheduler weiterhin deaktiviert; der Leasing-Scheduler respektiert die Datenbank-/ENV-Aktivierung.
- `APP_BASE_URL` wird für neue Passwort-Reset-Links verwendet (siehe `requestPasswordReset`); ohne Wert bleibt die Host-Information der Anfrage der Fallback.

## 5. Validierung

- `APP_BASE_URL`: leer erlaubt; sonst gültige `http(s)`-URL, keine Credentials; abschließende Schrägstriche werden entfernt.
- Scheduler-Intervalle: 60.000 bis 2.592.000.000 ms (30 Tage).
- Startverzögerungen: 0 bis 86.400.000 ms (24 Stunden).
- Leasing-Debounce: 0 bis 3.600.000 ms (1 Stunde).
- Fehler werden als `400` mit verständlicher Meldung zurückgegeben; keine Secrets in Antworten.

## 6. Systemstatus (read-only)

Angezeigt werden:

- `NODE_ENV`, `HOST`, `PORT`, `DATA_DIR`, `TRUST_PROXY`, `COOKIE_SECURE`
- `SUPERADMIN_FILE`: gesetzt/nicht gesetzt und Datei vorhanden/fehlt (kein Pfad)
- MFA-Schlüsselquelle (`env`/`file`/`missing`) und Integrations-Schlüsselquelle
- Hinweis, dass diese Werte bewusst ENV-only bleiben (Bootstrap, Sicherheit, Container).

Es werden keine Schlüsselwerte, Pfade zu Secret-Dateien oder Secrets ausgegeben.

## 7. UI

- Neue Route `#/erweitert` („Einstellungen → Erweitert“), nur `settings_manage`.
- Einstiegskarte auf der Einstellungsseite ist eingeklappt; die Zielseite zeigt alle Karten als zugeklappte Accordions.
- Aktiv-Schalter blenden Detailfelder aus, solange das Feature/Scheduler inaktiv ist.
- ENV-gesperrte Felder sind deaktiviert und mit „durch Umgebung gesetzt“ markiert.
- Speichern startet Scheduler neu; Fehlermeldungen ohne Secrets.

Zusätzlich sind auf der Integrationsseite SSO-, Teams- und ClamAV-Details ausgeblendet, solange das Feature inaktiv ist; WebAuthn/Passkeys haben einen eigenen Aktiv-Schalter, der die gespeicherte Konfiguration nur deaktiviert, ohne sie zu löschen.

## 8. Tests

- Migration 14→15 idempotent, Defaults und Spalten.
- ENV-vor-DB für Basis-URL und Scheduler; `envLocked`.
- Validierung von URL, Intervallen und Verzögerungen.
- Scheduler-Registry: Start, Stop, Neustart; Leasing-Scheduler respektiert DB-Aktivierung.
- Passwort-Reset-Link nutzt DB-`APP_BASE_URL`, ENV gewinnt.
- Systemstatus ohne Secrets; UI-Sichtbarkeit (eingeklappt, Advanced-Seite).
- Vollständige Regression: **213/213 Tests**.

## 9. Offene Punkte

- Produktive Basis-URL und Scheduler-Intervalle fachlich festlegen.
- Retention-Fristen bleiben bis zur rechtlichen Freigabe `0`.
- Keine QS-Freigabe, kein Tag, kein Deploy.
