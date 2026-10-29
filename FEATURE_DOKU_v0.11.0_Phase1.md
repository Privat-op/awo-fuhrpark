# Feature-Doku v0.11.0 – Phase 1: SSO, Teams, Virenscan, Retention, Betrieb

**Status:** implementiert auf `dev`; keine QS-Freigabe, kein Deploy, kein Tag.  
**Basis:** `user_version = 12` (Passkeys + SSO + Retention).  
**Grundsatz:** Neue Integrationen sind optional und standardmäßig aus; bestehende Installationen bleiben ohne Konfiguration unverändert.

## 1. SSO / Entra ID (OIDC)

- Generischer Authorization-Code-Flow mit PKCE (S256), State und Nonce.
- Routen `/auth/sso/start` und `/auth/sso/callback`; State/Nonce/PKCE sind sessiongebunden, einmalig und 10 Minuten gültig.
- ID-Token-Prüfung: Signatur über JWKS, Issuer, Audience, Ablauf/Not-before, Nonce, `email_verified` (falls vorhanden), E-Mail-Domain-Allowlist.
- Konto-Verknüpfung per E-Mail; JIT-Provisioning optional mit `SSO_DEFAULT_ROLE` (Standard `user`). Bei der Standardrolle wird automatisch ein verknüpftes Fahrerprofil mit `own_trips_access=1` angelegt. Superadmin wird nie automatisch angelegt oder hochgestuft; Superadmin-, inaktive und anonymisierte Konten werden abgelehnt.
- Gruppenmapping über `SSO_GROUP_CLAIM`, `SSO_ADMIN_GROUP`, `SSO_MANAGER_GROUP`. Kein Treffer lässt bestehende Rollen unverändert.
- Lokaler Login bleibt Fallback. Session-Regeneration nach Erfolg; Audit `sso_login`, `sso_provision`, `sso_failed` ohne Tokens/Secrets.
- Kein passwordless Login; SSO ist ein primärer Loginweg, Passkeys bleiben zweiter Faktor des lokalen Logins.

Konfiguration: `SSO_ENABLED`, `SSO_ISSUER`, `SSO_CLIENT_ID`, `SSO_CLIENT_SECRET`, `SSO_REDIRECT_URI`, `SSO_SCOPES`, `SSO_ALLOWED_DOMAINS`, `SSO_AUTO_PROVISION`, `SSO_DEFAULT_ROLE`, `SSO_GROUP_CLAIM`, `SSO_ADMIN_GROUP`, `SSO_MANAGER_GROUP`. Diese Werte können seit v0.13.0 zusätzlich unter **Einstellungen → Integrationen** gepflegt werden; eine gesetzte ENV-Variable hat Vorrang. Siehe [Feature-Doku v0.13.0 Integrationen](FEATURE_DOKU_v0.13.0_Integrationen.md).

Entra-App-Registrierung:

1. Redirect-URI exakt auf `SSO_REDIRECT_URI` setzen.
2. Client-ID und Client-Secret hinterlegen.
3. Optional Token-Konfiguration für `groups` aktivieren und Gruppen-IDs in `SSO_ADMIN_GROUP`/`SSO_MANAGER_GROUP` eintragen.
4. `SSO_ISSUER` auf den Tenant-Issuer setzen; Domain-Allowlist restriktiv konfigurieren.

## 2. Teams-Benachrichtigungen

- Optionaler Incoming-Webhook über `TEAMS_WEBHOOK_URL`; ohne Graph/App-Registration.
- MessageCards für Leasing-Warnungen, neue/entschiedene Buchungsanfragen und Wartungs-/TÜV-Erinnerungen.
- Dedupe im bestehenden `notification_deliveries`-Modell mit eigenem `teams:`-Kanal; Fehler blockieren API/Scheduler nicht. URL und Response-Inhalte werden nicht geloggt.

## 3. Virenprüfung für Uploads

- `VIRUS_SCAN_ENABLED` (Standard aus), `CLAMAV_HOST`, `CLAMAV_PORT`, `VIRUS_SCAN_FAIL_CLOSED` (Standard true bei aktivierter Prüfung).
- PDF-Belege, Rechnungsbilder, Fahrzeugbilder und Branding-Logos werden vor der Verarbeitung per clamd INSTREAM geprüft.
- Befund oder Fail-Closed: HTTP 422 „Upload wurde aus Sicherheitsgründen abgelehnt.“, Audit `upload_blocked` mit Kategorie/Reason, keine Dateiinhalte in Logs.
- Timeout 10 Sekunden. Ohne Aktivierung bleibt der Uploadpfad unverändert.

## 4. Retention (technische/auditnahe Daten)

- Vier Fristen in `settings`, jeweils `0 = aus`: `audit_retention_days`, `session_retention_days`, `password_reset_retention_days`, `notification_retention_days`.
- Täglicher Scheduler (deaktivierbar über `RETENTION_SCHEDULER_DISABLED`), Dry-Run und manueller Lauf über die Admin-UI.
- Löscht ausschließlich Audit-Log, abgelaufene Sessions, Passwort-Reset-Tokens und Notification-Deliveries. **Keine** automatische Löschung von Buchungen, Kosten, Fahrtenbuch, Fahrzeugen, Fahrer:innen oder Konten.
- Audit `retention_cleanup` mit Kategorienzahlen, keine personenbezogenen Daten.

## 5. Betriebs-Skripte

- `scripts/verify-backup.js`: SQLite-Integrität, Fremdschlüssel, Kerntabellen, Uploads und `mfa.key`; Exit-Code.
- `scripts/healthcheck.js`: HTTP `/healthz`, optionale DB- und Disk-Prüfung; Exit-Code.
- `scripts/backup-offsite.js`: rclone-basierter Offsite-Copy-Hook; ohne Ziel No-op, mit `--dry-run` ohne Kopieren.
- `scripts/loadtest.js`: leichter HTTP-Lasttest; lokale/dedizierte Ziele, `--confirm` erforderlich, Produktionsziele ohne `--allow-remote` gesperrt.

## 6. Tests

Die vollständige Suite umfasst **163 Tests** (Stand nach Scripts-Tests), alle grün.

Neu abgedeckt:

- SSO: Mock-OIDC-Provider, Discovery/JWKS/Token, PKCE, State/Nonce, Replay, unverified E-Mail, Domain, Audience, Ablauf, Signatur, Rollenmapping, JIT, lokaler Fallback, inaktive/anonymisierte/Superadmin-Konten.
- Teams: Mock-`fetch`, OK/FOUND/Timeout, Missing-Config, Dedupe, Fehlerpfad, Leasing/Buchungsanfrage/Wartung ohne SMTP.
- Virenscan: Mock-clamd INSTREAM OK/FOUND/Timeout, Fail-Closed/Fail-Open, PDF-Blockierung und -Speicherung.
- Retention: Migration 11→12, feste Daten, Dry-Run, Kategorien, 0=aus, technische Daten gelöscht, Buchungen/Kosten/Driver unverändert, Audit.
- Skripte: Temp-DBs/-Verzeichnisse, Health-Server, Offsite-No-op/Dry-Run, Loadtest-Sicherheitsgates.
- Regression: alle bisherigen MFA-, Passkey-, Login-, Rollen-, UI-, Leasing-, Kostenstellen-, Dark-Mode-, Superadmin- und QS-Tests.

## 7. Roadmap / offene Entscheidungen

- **Phase 2:** standortbezogene Sichtbarkeit und Freigabeprozesse erst nach Design und Freigabe (`LOCATIONS_ENABLED` default false).
- **DSGVO:** vollständige Löschung von Buchungen/Kosten/Fahrtenbuch erst nach rechtlicher Entscheidung.
- **SSO:** produktive Entra-Tenant-/Group-Claim-Werte, Domain-Allowlist und Betriebsweg für Passkey-/MFA-Fallback festlegen.
- **Teams:** produktiven Webhook über Betriebsgeheimnis setzen; keine URL in Repo/Logs.
- **ClamAV:** clamd-Betrieb, Signaturen-Update und Monitoring organisatorisch festlegen.
- **Retention:** rechtliche Fristen und Freigabe der technischen Kategorien; keine Geschäftsdaten löschen.
- Echte Hardware-/Browser-Abnahme, Pilot, Pen-Test, Backup-Restore-Test und QS-Freigabe bleiben organisatorisch.
