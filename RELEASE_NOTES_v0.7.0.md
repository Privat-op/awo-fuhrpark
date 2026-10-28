# AWO Fuhrparkmanagement – Release Notes v0.7.0

**Stand:** 28.10.2026  
**Status:** QS-freigegeben (51/51 Checks, keine Findings)  
**Migration:** `user_version = 5` (idempotent)

## Inhalte

### Leasingüberwachung
- Leasingfelder pro Fahrzeug: Beginn, Ende, Startkilometer, Gesamt-Kilometerlimit.
- Bestandsfahrzeuge ohne Leasing bleiben unverändert (`leasing: null`), kein Zwangswert.
- Warnstufen bei 80/90/100 % des Kilometerlimits; Status `critical` ab 100 %.
- Leasingende-Erinnerungen 90/30 Tage vor Ende sowie „überfällig“.
- Anzeige in Fahrzeugliste, Fahrzeugdetails, Dashboard/Benachrichtigungen und Buchungsdialogen.
- Buchungen und Fahrtverläufe werden bei 100 % **nicht blockiert** – reine Warnung.

### E-Mail-Benachrichtigungen
- SMTP-Konfiguration ausschließlich für Administrator:innen.
- Empfänger: aktive Konten der Rollen `admin` und `manager`.
- Dedupe pro Fahrzeug, Schwelle und Leasingzeitraum; pro Kategorie wird nur die höchste erreichte Schwelle versendet.
- Fehlversuche: maximal 3, Retry frühestens nach 6 Stunden.
- Scheduler: Startlauf plus 6-Stunden-Takt; deaktivierbar über `LEASING_SCHEDULER_DISABLED=true`; zusätzlicher Debounce nach Kilometer-/Leasingänderungen, Fahrtende und Nachtragung.
- SMTP-Passwort ausschließlich in `DATA_DIR/smtp-secret.json` (0600). Nicht in Datenbank, State, Export, Audit oder Logs; `smtp` ist aus dem JSON-Export entfernt.

### Superadmin
- Der Superadmin kann einem Administratorkonto die Administrator-Rolle entziehen (Herabstufung auf eine niedrigere Rolle).
- Mindestens ein aktives Administratorkonto muss bestehen bleiben.
- Normale Admins können weiterhin keine Admins bearbeiten; Superadmin-Konto und -Rolle bleiben systemgeschützt.
- Rechte gelten sofort; Audit wird geschrieben.

## QS
- Leasing/E-Mail: 51/51 Checks PASS, keine Findings.
- Superadmin-Demotion: 35/35 Checks PASS, keine Findings.
- Regressionen QS-001/005/007/008 sowie Rollen-/UI-/Superadmin-Tests grün.
- Testartefakte unter `C:\awo-fuhrpark-local\qs` (nicht Teil des Repositories).

## Upgrade
- Migration läuft beim Start automatisch und ist idempotent (`user_version` 4 → 5).
- Bestehende Fahrzeuge, Buchungen, Fahrten, Kosten, Rollen und Auditdaten bleiben erhalten.
- Nach einem Restore aus einem Backup muss das SMTP-Passwort neu gesetzt werden (die Secret-Datei ist bewusst nicht Teil des Backups).
- Ohne SMTP-Konfiguration bleibt das System voll funktionsfähig; es werden keine Mails versendet.

## Nicht enthalten
- Kostenstellen (Paket 2) und Dark Mode (Paket 3) – nur Design/Estimate, kein Code.
- MFA/Passkey, QS-010/003/004/006, Auto-Refresh und Pilot bleiben Backlog.
