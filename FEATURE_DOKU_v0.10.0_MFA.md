# Feature-Doku v0.10.0 – Optionale MFA (TOTP)

**Status:** implementiert auf `feature/v0100-mfa-optional`, Basis v0.9.1 (`e3e5553`)  
**Ziel:** Freiwillige Zwei-Faktor-Authentifizierung für alle Konten. Keine Pflicht, keine Fristen, kein Enforcement, kein Step-up.  
**Nicht enthalten:** Passkey/WebAuthn, SMS-/E-Mail-OTP, MFA-Pflicht pro Rolle, Recovery über Support-Hotline.

## 1. Scope

- MFA ist für Superadmin, Administrator:innen, Fuhrparkleitung und normale Nutzer:innen **optional**.
- Nur **TOTP** (RFC 6238, SHA-1, 6 Stellen, 30 Sekunden) und **Recovery-Codes**.
- Jede:r kann MFA in **Einstellungen → Sicherheit** selbst aktivieren, deaktivieren und Recovery-Codes neu ausgeben.
- Login bleibt ohne `totp_enabled = 1` unverändert. Nur bei aktivierter MFA wird nach korrektem Passwort eine Pending-Session erzeugt und `/login/mfa` verlangt.
- Administrator:innen dürfen MFA von Konten mit **strikt niedrigerem Rang** zurücksetzen; der Superadmin von jedem Konto. Ziel-Sitzungen werden beendet, der Reset wird auditiert.
- Kein Step-up für Rollen-, Benutzer- oder SMTP-Aktionen; dort gelten unverändert die bestehenden Rechte.

## 2. Migration und Datenmodell

Migration: **`user_version = 8`**, idempotent. Bestehende Konten bleiben unverändert und haben keine MFA.

### `user_mfa`

| Feld | Typ | Zweck |
|---|---|---|
| `user_id` | TEXT PK, FK `users(id)` ON DELETE CASCADE | 1:1 zum Konto |
| `totp_secret_enc` | TEXT | AES-256-GCM verschlüsseltes Secret (`v1.iv.tag.ciphertext`, Base64url) |
| `totp_enabled` | INTEGER 0/1 | aktiv nach bestätigter Einrichtung |
| `totp_confirmed_at` | TEXT | Zeitpunkt der Aktivierung |
| `totp_last_used_step` | INTEGER | Replay-Schutz |
| `failed_attempts` | INTEGER | Fehlversuche im aktuellen 15-Minuten-Fenster |
| `locked_until` | TEXT | temporäre MFA-Sperre |
| `last_verified_at` | TEXT | letzte erfolgreiche Verifikation |
| `created_at`, `updated_at` | TEXT | Betrieb |

### `mfa_recovery_codes`

| Feld | Typ | Zweck |
|---|---|---|
| `id` | TEXT PK | interne ID |
| `user_id` | TEXT FK `users(id)` ON DELETE CASCADE | Zuordnung |
| `code_hash` | TEXT UNIQUE | HMAC-SHA-256 mit HKDF-Pepper |
| `batch_id` | TEXT | Ausgabegruppe |
| `used_at` | TEXT | Einmalverwendung |
| `created_at` | TEXT | Erstellung |

- 10 Codes pro Ausgabe, 16 Base32-Zeichen, gruppiert als `XXXX-XXXX-XXXX-XXXX`.
- Nur Hashes werden gespeichert; Codes sind nicht rekonstruierbar.
- Neuausgabe löscht alle alten Codes derselben Person.
- Es gibt **keine** WebAuthn-/Challenge-/Policy-Tabellen.

## 3. Kryptografie

- TOTP-Secret: **AES-256-GCM**, zufälliger 12-Byte-IV pro Datensatz, **AAD = `user_id`**.
- Schlüsselquelle:
  - `MFA_ENCRYPTION_KEY` (32 Byte Base64 oder 64 Hex-Zeichen) oder
  - automatisch `DATA_DIR/mfa.key` (Base64, Modus `0600`; unter Windows ohne POSIX-Modus, aber im geschützten Datenverzeichnis).
- Ein gesetzter, aber ungültiger `MFA_ENCRYPTION_KEY` führt zu einem Startfehler statt zu einem stillen Fallback.
- Recovery-Pepper: HKDF-SHA-256 aus demselben Schlüssel mit getrenntem Info-Label `awo-mfa-recovery-v1`; Code-Hash: HMAC-SHA-256 über den normalisierten Code.
- Keine Secrets in DB-Klartext, State, Export, Audit, Logs, Fehlermeldungen, Cookies oder `localStorage`/`sessionStorage`.
- Key-Rotation ist nicht Teil des MVP. Bei Schlüsselverlust werden bestehende TOTP-Secrets unlesbar; Admin-Reset und Neueinrichtung sind nötig.

## 4. Abläufe und API

Alle Änderungen laufen über die bestehende Session-/CSRF-Prüfung, `Cache-Control: no-store` und die globale API-Rate-Limitierung.

### 4.1 Self-Service

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/security` | Status: `totpEnabled`, `confirmedAt`, `lastVerifiedAt`, `recoveryCodesRemaining`, `lockedUntil` |
| POST | `/api/security/totp/enroll/start` | Pending-Secret verschlüsseln, `otpauth://`-URI, Secret und QR-SVG einmalig liefern |
| POST | `/api/security/totp/enroll/confirm` | 6-stelligen Code prüfen, MFA aktivieren, 10 Recovery-Codes einmalig liefern |
| POST | `/api/security/totp/disable` | aktuellen TOTP-/Recovery-Code verlangen, Faktoren und Codes löschen |
| POST | `/api/security/recovery/regenerate` | aktuellen TOTP-/Recovery-Code verlangen, alte Codes invalidieren, neue einmalig liefern |

Das Enrollment-Secret existiert nur im lokalen Dialogzustand und wird nicht im globalen State gespeichert.

### 4.2 Login

1. `POST /login` mit E-Mail und Passwort.
2. Ohne aktive MFA: Session wird regeneriert, Login abgeschlossen, Redirect `/`.
3. Mit aktiver MFA: Session wird regeneriert und als **pending** markiert (`mfaPendingUserId`, `mfaPendingAt`), Redirect `/login/mfa`.
4. `GET /login/mfa` rendert TOTP-/Recovery-Formular; Pending-Sessions laufen nach 10 Minuten ab.
5. `POST /login/mfa` prüft TOTP oder Recovery, Lockout und Replay. Bei Erfolg wird die Session erneut regeneriert, `userId` und `mfaVerifiedAt` gesetzt, Redirect `/`.
6. `POST /login/mfa/cancel` verwirft die Pending-Session und führt zurück zu `/login`.

Ohne gültige vollständige Session liefern API-Aufrufe `401`, HTML-Aufrufe leiten auf `/login/mfa` bzw. `/login`.

### 4.3 Admin-Reset

`POST /api/security/admin-reset/:userId`

- Administrator:in: Zielrolle muss strikt niedriger sein; Admin-/Superadmin-Konten sind ausgeschlossen; das eigene Konto ist ausgeschlossen.
- Superadmin: jedes Konto.
- Löscht `user_mfa` und alle Recovery-Codes des Ziels, beendet normale und pending Sitzungen, schreibt `mfa_reset` ohne Geheimnisse.

## 5. Sperren und Fehlerverhalten

- TOTP akzeptiert den aktuellen Zeitschritt sowie ±1 Schritt (Time-Drift).
- Replay-Schutz über `totp_last_used_step`: bereits verwendete oder ältere Schritte werden abgelehnt.
- Maximal **5 Fehlversuche pro 15 Minuten**; danach **15 Minuten Sperre**. Der Zähler wird nach Erfolg oder abgelaufenem Fenster zurückgesetzt.
- Recovery-Codes zählen in dasselbe Limit und sind einmalig.
- Fehlermeldungen unterscheiden nicht zwischen unbekanntem Code, verbrauchtem Recovery-Code und falschem TOTP.
- CSRF gilt für alle POST-Routen; die Login-Formulare nutzen `_csrf`, die API den Header `X-CSRF-Token`.

## 6. Audit

Ohne Secrets, Codes, Hashes, Session-IDs oder Schlüssel:

- `mfa_enroll_started`
- `mfa_enabled`
- `mfa_disabled`
- `mfa_verify_success`
- `mfa_verify_failed`
- `mfa_locked`
- `mfa_recovery_used`
- `mfa_recovery_regenerated`
- `mfa_reset`

Details enthalten nur Faktortyp, Kontext, Status/Fehlerkategorie, Ziel-ID, Akteur und Zeitpunkt. Das Enrollment-Start-Response enthält das Secret bewusst einmalig; es wird nicht auditiert.

## 7. UI

- Karte **Sicherheit** unter **Einstellungen → Ihr Konto**:
  - Status „Nicht eingerichtet“ / „TOTP aktiv“
  - Bestätigungs- und Verifikationszeitpunkt, verbleibende Recovery-Codes
  - Aktionen „TOTP einrichten“, „MFA deaktivieren“, „Recovery-Codes neu ausgeben“
  - Hinweis bei temporärer Sperre
- Enrollment-Dialog:
  - serverseitig erzeugtes QR-SVG mit Alt-Text
  - manuelles Secret als Alternative
  - Codefeld mit `autocomplete="one-time-code"`, `inputmode="numeric"`, Fokus
- Recovery-Codes:
  - einmalige Anzeige, Kopieren und Download als `.txt`
  - Bestätigungspflicht vor dem Schließen
- Login-Seite `/login/mfa`:
  - TOTP-Feld, Recovery-Checkbox, Abbrechen
  - `role="alert"`/`aria-live` für Fehler, Fokus auf dem Codefeld, kein Auto-Redirect bei Fehler
- Benutzerverwaltung:
  - MFA-Badge pro Konto
  - „MFA zurücksetzen“ nur bei berechtigten Zielkonten
- `prefers-reduced-motion`, Tastaturbedienung und Fokusfalle der bestehenden Modale bleiben erhalten.

## 8. Tests

Die Suite umfasst **95 Tests** (84 Bestandstests + 11 MFA-Tests). MFA-spezifisch:

- TOTP-RFC-6238-Vektoren, ±1 Zeitschritt, ungültige Codes, Replay
- AES-256-GCM-Roundtrip, zufällige IVs, falsches AAD, Schlüsseldatei
- Recovery-Code-Normalisierung, Einmalverwendung, Neuausgabe invalidiert alte Codes
- Migration 7→8 idempotent, Tabellen, FK-Check
- Lockout nach 5 Fehlversuchen und 15-Minuten-Fenster
- Enrollment, Status, Deaktivierung, State ohne Secrets
- Login ohne/mit MFA, Pending-Session, Session-Regeneration, Recovery-Login
- Rate-Limit/Lockout und Audit ohne Geheimnisse
- Admin-Reset: Self, Gleichrang, niedriger Rang, Manager, Superadmin
- State, Export und Serverlog ohne TOTP-Secret, Recovery-Code oder Hash
- UI-Bausteine für Sicherheitskarte, Dialoge, Login-MFA und Admin-Reset
- Vollständige Regression der Bestandstests (Rollen/UI/Leasing/Kostenstellen/Dark Mode/Superadmin/QS-013)

Ausführen:

```bash
node --test
```

## 9. Betrieb

- `MFA_ENCRYPTION_KEY` als System-/Docker-Secret setzen **oder** `DATA_DIR/mfa.key` automatisch erzeugen lassen.
- Datenbank und `mfa.key` gehören zusammen in die Sicherung. Ein Restore nur der Datenbank macht TOTP-Secrets unlesbar.
- Key-Verlust: betroffene Konten per Admin-/Superadmin-Reset von MFA befreien und neu einrichten lassen.
- Superadmin: Self-Service wie jede andere Person. Bei Totalverlust des Geräts und fehlenden Recovery-Codes greift der dokumentierte Betriebsweg über Superadmin-Datei/DB; ein separates CLI ist nicht Teil des MVP.
- Keine MFA-Pflicht, keine Grace-Period, kein Step-up. Bestehende Rechte und Ranglogik bleiben unverändert.

## 10. Bekannte Grenzen und Rollback

- Kein Passkey/WebAuthn (Phase B), kein SMS-/E-Mail-OTP.
- Keine zentrale Policy, keine Rollenpflicht, keine Fristen.
- Keine Key-Rotation und kein automatischer Re-Encrypt.
- Unter Windows hat `0600` keine POSIX-Wirkung; der Schutz erfolgt über das Datenverzeichnis.
- Rollback auf v0.9.1: Code zurücksetzen; die Tabellen `user_mfa` und `mfa_recovery_codes` können unverändert bestehen bleiben. `user_version = 8` wird von älteren Ständen nicht zurückgesetzt; ein Downgrade der Migration ist nicht vorgesehen.
- Kein Deploy, kein Merge nach `main`/STABLE im Rahmen dieses Pakets.
