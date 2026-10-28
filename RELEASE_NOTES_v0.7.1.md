# AWO Fuhrparkmanagement – Release Notes v0.7.1

**Stand:** 28.10.2026  
**Status:** QS-freigegeben (21/21 Checks, keine Findings)  
**Basis:** v0.7.0 (Commit `c6a0440`)

## Änderung

- Der Info-Banner „Superadmin ist datei-verwaltet“ auf der Seite **Rollen & Rechte** wurde entfernt.
- Keine Layout-Lücke: Der Banner-Block wurde vollständig entfernt.
- Rollen anlegen/bearbeiten, Objekt-Ausnahmen, Rechte und der Systemschutz des Superadmins bleiben unverändert.
- Superadmin-Konto und -Rolle bleiben in State und UI unsichtbar.

## QS

- 21/21 Checks PASS, keine Findings.
- Geprüft: Banner in Admin- und Superadmin-Sicht entfernt, Rollenfunktionen unverändert, Superadmin-Schutz (409/403), Regression QS-001, FK-Check leer, `user_version = 5`.

## Upgrade

- Keine Migration erforderlich; `user_version` bleibt 5.
