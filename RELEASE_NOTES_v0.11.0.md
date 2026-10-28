# Release Notes v0.11.0 – Entwurf

**Status:** Entwurf, keine QS-Freigabe, kein Tag, kein Deploy.  
**Basis:** `dev`, `user_version = 12`.  
**Tests:** 163/163 grün (Stand: Phase-1-Abschluss; vor Release erneut vollständig ausführen).

## Highlights

- Optionale Passkeys als zweiter Faktor nach dem Passwort.
- Optionales OIDC-SSO für Microsoft Entra ID mit PKCE, State/Nonce, Gruppenmapping und JIT-Provisioning.
- Optionaler Microsoft-Teams-Incoming-Webhook für Leasing, Buchungsanfragen und Wartungs-/TÜV-Erinnerungen.
- Optionale ClamAV-Prüfung für Uploads.
- Technische DSGVO-Retention für Audit, Sessions, Reset-Tokens und Notification-Deliveries inklusive Dry-Run.
- Betriebs-Skripte für Backup-Verifikation, Healthcheck, Offsite-Copy und Lasttest.

## Sicherheit und Kompatibilität

- Alle neuen Integrationen sind standardmäßig aus und müssen explizit konfiguriert werden.
- Kein passwordless Login; Passwort, TOTP/Recovery und Passkeys bleiben getrennte Faktoren.
- Keine automatische Löschung von Buchungen, Kosten oder Fahrtenbuch.
- SSO legt niemals Superadmin an oder stuft dorthin hoch; lokaler Login bleibt Fallback.
- Keine Secrets, Webhook-URLs, Tokens oder Credential-Daten in Logs, State, Export oder Audit.

## Migration

- `user_version = 10`: `user_passkeys`, `passkey_attempts`.
- `user_version = 11`: `user_sso`.
- `user_version = 12`: Retention-Spalten in `settings`.

## Konfiguration

- SSO: `SSO_*` gemäß README/Feature-Doku.
- Passkeys: `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_NAME`, `WEBAUTHN_ORIGIN`.
- Teams: `TEAMS_WEBHOOK_URL`.
- Virenscan: `VIRUS_SCAN_*`, `CLAMAV_*`.
- Retention: Admin-UI/Fristen; Scheduler über `RETENTION_*`.
- Betrieb: `OFFSITE_TARGET`, optionale Health-/Backup-Pfade.

## Offene Punkte vor Release

- QS-Freigabe der Phase-1-Features.
- Produktive Entra-App-Registrierung, Redirect-URI und Group Claims.
- Produktiver Teams-Webhook als Betriebsgeheimnis.
- ClamAV-Betrieb und Signaturen-Monitoring.
- Rechtliche Freigabe der Retention-Fristen; keine Geschäftsdatenlöschung.
- Echte Hardware-/Browser-Abnahme für Passkeys, Restore-Test, Pilot/Pen-Test.
- Phase 2 (Locations/Approval-Routing) erst nach Design und separater Freigabe.
