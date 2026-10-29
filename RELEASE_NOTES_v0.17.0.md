# Release Notes v0.17.0 (Entwurf)

**Status:** Entwurf für `dev`; keine QS-Freigabe, kein Tag, kein Deploy.

## Neu

- **Gesellschaften als Stammdatum:** neue Seite **Einstellungen → Gesellschaften** mit Code, Name und Aktivstatus.
- **Kostenstellencodes je Gesellschaft:** `UNIQUE (company_id, code COLLATE NOCASE)` statt globaler Eindeutigkeit; derselbe Code ist in verschiedenen Gesellschaften erlaubt.
- **Migration 17:** neue Tabelle `companies`, Standardgesellschaft, Zuordnung bestehender Kostenstellen, Tabellen-Rebuild mit FK-Prüfung und ohne Datenverlust.
- **Kostenstellen-UI:** Gesellschaftsspalte, Filter nach Gesellschaft, Suche nach Code/Name, Pflicht-Auswahl im Formular.
- **Dropdowns:** alle Kostenstellenauswahlen zeigen `Gesellschaft · Code · Name`.
- **Export:** JSON mit `companyId`/`companyCode`/`companyName`; Fahrtenbuch-CSV mit eigener Spalte `Gesellschaft`.
- **Audit:** Gesellschafts- und Kostenstellenänderungen inklusive Gesellschaftsangaben, ohne Secrets.

## Verhalten

- Keine Mandantentrennung: Fahrzeuge, Benutzer, Buchungen und Kosten bleiben gesellschaftsneutral; alle Berechtigten sehen alle Gesellschaften.
- Inaktive Gesellschaften bleiben sichtbar, können aber nicht neu zugeordnet werden.
- Gesellschaften mit Kostenstellen können nicht gelöscht werden.
- Bestehende Kostenstellen werden der Standardgesellschaft zugeordnet; IDs und Zuordnungen bleiben unverändert.
- Kein passwordless Login; keine Tunnel-/SMTP-/Release-/Deploy-Änderungen.

## Tests

- Migration, Unique-Verhalten, Company-CRUD/Rechte, Kostenstellen-CRUD, State/Export, UI-Harness.
- Vollständige Regression: **218/218 Tests PASS**.
