# Release Notes v0.18.0 (Entwurf)

**Status:** Entwurf für `dev`; keine QS-Freigabe, kein Tag, kein Deploy.

## Neu

- **Eigentum/Leasing:** neue Fahrzeug-Eigenschaft `ownership_type` (`owned`/`leasing`), in API, State und UI.
- **Neue Statuswerte:** `Defekt`, `Veräußert`, `Nicht fahrbereit` zusätzlich zu Verfügbar, Unterwegs und In Wartung.
- **Buchbarkeit:** `maintenance`, `defect`, `sold`, `not_drivable` und dauerhaft gesperrte Fahrzeuge sind nicht buchbar; `in_use` bleibt für zukünftige Zeiträume buchbar. Klare `409`-Meldungen in Buchungsanlage, Anfrage, Genehmigung und Fahrtstart.
- **Statuserhalt:** Beim Buchungsabschluss bleiben `maintenance`/`defect`/`sold`/`not_drivable` erhalten; nur `in_use` wird verfügbar.
- **UI:** Eigentum/Leasing-Toggle mit ein-/ausblendbarem Leasingblock, Statusfilter und Dropdowns mit sechs Werten, Status-/Eigentums-Badges, deaktivierte Buchungsoptionen.
- **Migration 18:** Tabellen-Rebuild mit Ownership-Backfill, erweitertem Status-CHECK, FK-/Index-Erhalt und Fremdschlüsselprüfung. Bestehende Daten und IDs bleiben erhalten.

## Verhalten

- Bei `owned` werden vorhandene Leasingfelder ignoriert; es entstehen keine Leasingwarnungen oder -Notifications. Werte werden beim Umschalten nicht gelöscht.
- Leasingverhalten für `leasing` bleibt unverändert.
- Keine Änderung an Werkstatt-, Kosten- oder Buchungslogik außer den Statusprüfungen.
- Kein passwordless Login; keine Tunnel-/SMTP-/Release-/Deploy-Änderungen.

## Tests

- Migration 17→18, Ownership/Status-API, Bookability, Statuserhalt, Leasing-Eigentum, UI-Harness.
- Vollständige Regression: **218/218 Tests PASS**.
