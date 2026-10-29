# Feature-Doku v0.18.0 – Fahrzeug-Eigentum und Statuswerte

**Status:** implementiert auf `dev`; keine QS-Freigabe, kein Tag, kein Deploy.  
**Migration:** `user_version = 18`.

## 1. Ziel

Fahrzeuge erhalten eine explizite Eigentums-/Leasing-Eigenschaft und drei zusätzliche Statuswerte. Keine Änderung an Werkstatt-, Kosten- oder Buchungslogik außer den Statusprüfungen.

## 2. Datenmodell (Migration 17→18)

- `vehicles.ownership_type TEXT NOT NULL DEFAULT 'owned' CHECK (ownership_type IN ('owned','leasing'))`.
- Backfill: Fahrzeuge mit einem der Felder `leasing_start`, `leasing_end`, `leasing_start_km`, `leasing_km_limit` werden `leasing`, sonst `owned`.
- `vehicles.status`: `available`, `in_use`, `maintenance`, `defect`, `sold`, `not_drivable`.
- Da SQLite den CHECK nicht ändern kann, wird `vehicles` neu aufgebaut: Daten kopieren, alte Tabelle ersetzen, Indizes (`idx_vehicles_cost_center`, `idx_vehicles_location`) und Fremdschlüssel erhalten, `foreign_key_check`, keine Datenverluste. Idempotent.

## 3. Status-Semantik

| Status | Anzeige | Buchbar |
|---|---|---|
| `available` | Verfügbar | ja |
| `in_use` | Unterwegs | ja, für zukünftige Zeiträume |
| `maintenance` | In Wartung | nein |
| `defect` | Defekt | nein |
| `sold` | Veräußert | nein |
| `not_drivable` | Nicht fahrbereit | nein |

Zusätzlich bleibt die dauerhafte Fahrzeug-Sperre wirksam.

## 4. Server

- Zentraler Helper `vehicleUnavailableReason(vehicle)`/`assertVehicleBookable` mit klaren `409`-Meldungen:
  - „… befindet sich in Wartung.“
  - „… ist defekt.“
  - „… ist als veräußert markiert.“
  - „… ist nicht fahrbereit.“
- Verwendet in Buchungsanlage, Buchungsanfrage, Genehmigung und Fahrtstart. `in_use` bleibt buchbar.
- Buchungsabschluss behält `maintenance`, `defect`, `sold`, `not_drivable`; nur `in_use` wird zu `available` (bzw. `in_use` bei paralleler Fahrt).
- `ownershipType` in `POST/PATCH /api/vehicles`, `state`/`mapVehicle` und Audit.
- Leasing: `owned` liefert keinen Leasingstatus und keine Warnungen; `collectLeasingNotifications` überspringt `owned`. `leasing` bleibt unverändert.

## 5. UI

- Fahrzeugdialog: Radio **Eigentum/Leasing**; bei Eigentum ist der Leasingblock ausgeblendet, Werte bleiben im Formular erhalten und werden nicht gelöscht.
- Status-Dropdown mit allen sechs Werten.
- Fahrzeugkarten/-details zeigen Status- und Eigentums-Badge.
- Buchungs-/Anfrage-Dropdowns deaktivieren nicht buchbare Statuswerte; „Buchen“ ist in den Details gesperrt.
- Statusfilter enthält automatisch alle Werte aus `VEHICLE_STATUS`.

## 6. Tests

- Migration 17→18: Rebuild, Defaults, Backfill, Status-CHECK, FK-Integrität, Indizes, Idempotenz.
- API: gültige/ungültige `ownershipType`, neue Statuswerte, Bookability-Meldungen, Statuserhalt beim Abschluss.
- Leasing: Eigentum ohne Warnung/Notification, Leasing unverändert.
- UI-Harness: sechs Statuswerte, Radio-Toggle, Leasingblock, Badges, deaktivierte Optionen.
- Vollständige Regression: **218/218 Tests**.

## 7. Offene Punkte

- Keine Werkstatt-/Kostenlogik-Änderung; Status ist eine Fahrzeug-Eigenschaft.
- Keine gesonderte Status-Historie.
- Keine QS-Freigabe, kein Tag, kein Deploy.
