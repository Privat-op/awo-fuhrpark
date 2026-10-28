# Feature-Doku v0.11.0 – Optionale Passkeys (WebAuthn Phase B)

**Status:** implementiert auf `dev`  
**Grundsatz:** Passkeys sind optional. Kein Enforcement, kein Step-up, kein passwordless Login. Passwort, TOTP und Recovery-Codes bleiben Fallback.  
**Bibliothek:** `@simplewebauthn/server` 14.0.3, `@simplewebauthn/browser` 14.0.0.

## 1. Scope

- Passkey als zweiter Faktor nach korrektem Passwort.
- Mehrere Passkeys pro Konto.
- Registrierung, Umbenennung und Entfernung unter **Einstellungen → Sicherheit**.
- Login über TOTP, Recovery-Code oder Passkey.
- Admin-/Superadmin-Reset entfernt Passkeys zusammen mit TOTP und Recovery-Codes.
- Kein passwordless Login, keine SSO-/Entra-ID-Integration.

## 2. Konfiguration

Ausschließlich über Umgebungsvariablen; **keine Ableitung aus dem Host-Header**:

- `WEBAUTHN_RP_ID` – RP-ID ohne Schema/Port, z. B. `fuhrpark.example.org`
- `WEBAUTHN_RP_NAME` – Anzeigename im Browser-Dialog
- `WEBAUTHN_ORIGIN` – erlaubte Origin(s) inklusive Schema, mehrere kommagetrennt

Die Origin muss zur RP-ID passen (gleiche Domain oder Subdomain). Fehlt oder widerspricht die Konfiguration, antworten die Passkey-Endpunkte mit `503` und klarer Meldung; es entsteht kein `500`. Die Loginseite blendet den Passkey-Button aus. Passkey-only-Konten benötigen in diesem Fall einen Admin-Reset, um wieder einen anderen Faktor zu erhalten.

## 3. Migration und Datenmodell

Migration: **`user_version = 10`**, idempotent.

### `user_passkeys`

| Feld | Typ | Zweck |
|---|---|---|
| `id` | TEXT PK | interne ID |
| `user_id` | TEXT FK `users(id)` ON DELETE CASCADE | Zuordnung |
| `credential_id` | TEXT UNIQUE | Base64URL der Credential-ID |
| `public_key` | TEXT | Base64URL des Public Keys |
| `counter` | INTEGER | Signaturzähler |
| `transports` | TEXT | JSON-Array |
| `name` | TEXT | Anzeigename |
| `created_at` | TEXT | Registrierung |
| `last_used_at` | TEXT | letzte Anmeldung |

### `passkey_attempts`

Interne Tabelle für das kontobezogene Lockout (`failed_attempts`, `locked_until`, `updated_at`). Keine Credential-Daten.

## 4. API

### Registrierung (angemeldet)

| Methode | Pfad | Zweck |
|---|---|---|
| POST | `/api/security/passkeys/options` | Passwortbestätigung, Registrierungsoptionen, Challenge in Session |
| POST | `/api/security/passkeys/verify` | Attestation prüfen, Passkey speichern, Audit `passkey_added` |
| PATCH | `/api/security/passkeys/:id` | Namen ändern, Audit `passkey_renamed` |
| DELETE | `/api/security/passkeys/:id` | Entfernen, Audit `passkey_removed`, alle Sitzungen beenden |

Die Challenge ist an das Konto gebunden, fünf Minuten gültig und einmalig. Das aktuelle Passwort wird vor der Registrierung serverseitig mit bcrypt geprüft.

### Login

| Methode | Pfad | Zweck |
|---|---|---|
| POST | `/api/auth/passkey/options` | Optionen für Pending-Session, `allowCredentials` der hinterlegten Passkeys |
| POST | `/api/auth/passkey/verify` | Assertion prüfen, Session regenerieren, `mfaVerifiedAt` setzen |

Die Endpunkte sind nur mit einer Pending-Session nach korrektem Passwort nutzbar und CSRF-geschützt. Bei Erfolg wird die Session regeneriert; TOTP/Recovery bleiben parallel verfügbar.

### Admin-Reset

Der bestehende MFA-Reset löscht zusätzlich alle Passkeys, beendet Ziel-Sitzungen und schreibt `passkey_reset` ohne Credential-Daten.

## 5. Sicherheit

- `userVerification: required` bei Registrierung und Login.
- Strikte Prüfung von Challenge, Origin, RP-ID, Signatur und Counter durch `@simplewebauthn/server`.
- Counter-Rückschritt: betroffener Passkey wird gelöscht, Audit `passkey_counter_regression`, Login generisch abgelehnt.
- Maximal 5 Fehlversuche pro 15 Minuten pro Konto, danach 15 Minuten Sperre. Passwortbestätigung und Assertion zählen in dasselbe Lockout.
- Challenge nur in der Session; keine Credential-IDs, Public Keys oder Challenges in State, Export, Audit oder Logs.
- State/Sicherheits-API liefern nur interne ID, Name, Transports und Zeitstempel.
- Entfernen eines Passkeys und Admin-Reset beenden alle Sitzungen des Kontos.
- Browser ohne WebAuthn: Sicherheitskarte und Login-Button werden ausgeblendet.

## 6. UI

- Sicherheitskarte mit Passkey-Liste, „Passkey hinzufügen“, Umbenennen und Entfernen.
- Passwortbestätigung im Hinzufügen-Dialog.
- Login-MFA-Seite mit „Mit Passkey anmelden“; TOTP/Recovery bleiben sichtbar, wenn eingerichtet.
- Fehler mit `role="alert"`/`aria-live`, Fokusführung und Tastaturbedienung.
- Browser-Bibliothek wird serverseitig aus `@simplewebauthn/browser` unter `/vendor/simplewebauthn-browser.js` ausgeliefert.

## 7. Tests

Die vollständige Suite umfasst **140 Tests**, alle grün.

Passkey-spezifisch:

- Migration 9→10, Tabellen, FK, Idempotenz
- Konfigurationsvalidierung (fehlend, fremde Origin, RP-ID-Mismatch)
- Challenge: sessiongebunden, einmalig, 5-Minuten-Ablauf
- Speicherung: sichere Liste, Duplikat, Umbenennen, Entfernen, keine Credential-Daten
- Mock-Verifier: Registrierung, Authentifizierung, Counter-Rückschritt
- Lockout: 5 Fehlversuche, 15 Minuten
- API: Security-Status, CSRF, Passwortbestätigung, Pending-Passkey-Login, TOTP-Fallback
- API: Passkey entfernen beendet Sitzung; Admin-Reset löscht Passkeys und Ziel-Sitzungen
- API: Account-Lockout, ungültige Assertion mit Audit
- State/Export ohne Credential-ID/Public-Key
- Regression aller bisherigen MFA-, Login-, Rollen-, UI-, Leasing-, Kostenstellen-, Dark-Mode-, Superadmin- und QS-Tests

### Manueller Smoke-Test

Durchgeführt mit **Microsoft Edge 156 Headless** und einem virtuellen Plattform-Authenticator über das Chrome DevTools Protocol (`WebAuthn.addVirtualAuthenticator`, `ctap2`, `internal`, User Verification). Ablauf:

1. Login mit Passwort.
2. Einstellungen → Sicherheit → Passkey hinzufügen mit Passwortbestätigung.
3. Virtueller Authenticator erzeugt Passkey; Liste zeigt „Smoke Passkey“.
4. Logout und erneuter Login mit Passwort.
5. `/login/mfa` zeigt „Mit Passkey anmelden“.
6. Passkey-Assertion erfolgreich; Dashboard wird geladen.

Ergebnis: **erfolgreich**. Ein Test mit echter Hardware (Windows Hello/YubiKey) auf dem Zielsystem bleibt Teil der Deployment-Abnahme.

## 8. Offene Punkte / Grenzen

- Kein passwordless Login.
- Keine Attestation-Metadaten-/AAGUID-Richtlinie; Attestation `none`.
- Keine Passkey-Backup-/Exportfunktion; Wiederherstellung über zweiten Passkey, TOTP/Recovery oder Admin-Reset.
- Keine Key-Rotation für Passkeys (Public Keys sind keine Geheimnisse).
- Bei fehlender WebAuthn-Konfiguration sind Passkey-only-Konten auf Admin-Reset angewiesen.
- Echte Hardware-Authenticator-Abnahme (Chrome/Edge, Windows Hello, Security Key) steht für das Zielsystem aus.
