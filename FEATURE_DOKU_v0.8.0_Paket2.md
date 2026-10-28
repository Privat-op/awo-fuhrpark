# AWO Fuhrparkmanagement – Feature-Doku v0.8.0 Paket 2

**Stand:** 28.10.2026  
**Branch:** `feature/v080-kostenstellen`  
**Basis:** `main` / `d0134e1` (v0.7.1)  
**Status:** implementiert, lokal getestet, **nicht deployed**

## 1. Ziel

Kostenstellen als Stammdatum einführen, Fahrzeugen/Fahrer:innen/Benutzerkonten zuordnen und in Buchungen, Buchungsanfragen und Kosten als Snapshot führen. Filter, Summen und Exporte werden ergänzt. Bestandsdaten bleiben ohne Zuordnung (`NULL`).

## 2. Datenmodell und Migration

Migration `server/lib/cost-centers-schema.js`, `COST_CENTERS_SCHEMA_VERSION = 6`, idempotent.

### `cost_centers`

| Feld | Typ | Regel |
|---|---|---|
| `id` | TEXT PK | UUID |
| `code` | TEXT, `COLLATE NOCASE UNIQUE` | normalisiert: trim, Großschreibung, Leerzeichen → `-`; max. 40 Zeichen |
| `name` | TEXT | erforderlich, max. 160 |
| `description` | TEXT | optional, max. 500 |
| `active` | INTEGER 0/1 | inaktive bleiben historisch sichtbar |
| `created_at`, `updated_at` | TEXT | ISO |

### Zuordnungen

`cost_center_id` (nullable, `REFERENCES cost_centers(id) ON DELETE SET NULL`) auf:

- `vehicles`
- `drivers`
- `users`
- `bookings`
- `booking_requests`
- `costs`

Indizes auf allen sechs Spalten. Bestandsdaten werden nicht zurückgefüllt.

### Rechte-Migration

Die Manager-Rolle erhält einmalig `cost_centers_view` und `cost_centers_manage`. Administrator erhält alle Rechte automatisch. Individuelle Benutzer-Entziehungen bleiben unberührt.

## 3. Default-Logik

Zentral in `server/lib/cost-centers.js`:

- **Buchung / Buchungsanfrage / Nachtrag:** explizite Auswahl → Fahrer:in → Fahrzeug → Benutzerkonto → `NULL`.
- **Kosten / Wartungskosten:** explizite Auswahl → Fahrzeug → Benutzerkonto (erfassende Person) → `NULL`.

Regeln:

- Eine explizite Auswahl von `null`/leer bedeutet bewusst „keine Kostenstelle“ und überschreibt Defaults.
- Inaktive Kostenstellen werden bei neuen Defaults übersprungen; eine bestehende Zuordnung kann unverändert bleiben.
- Änderungen an Defaults wirken nicht rückwirkend. Buchungen/Kosten speichern die ID als Snapshot.

## 4. API

### Stammdaten

| Methode | Pfad | Recht |
|---|---|---|
| POST | `/api/cost-centers` | `cost_centers_manage` |
| PATCH | `/api/cost-centers/:id` | `cost_centers_manage` |
| POST | `/api/cost-centers/:id/deactivate` | `cost_centers_manage` |
| DELETE | `/api/cost-centers/:id` | `cost_centers_manage` |

- Code-Konflikt: 409.
- Ungültiger Code: 400.
- Löschen nur ohne Referenzen; sonst 409 mit Nutzungsdetails und Hinweis auf Deaktivieren.
- Deaktivieren ist idempotent; Reaktivieren über `PATCH { active: true }`.

### Zuordnungen

- `POST/PATCH /api/vehicles`, `/api/drivers`, `/api/users` akzeptieren `costCenterId`.
- `POST /api/bookings`, `/api/booking-requests`, `/api/trips`, `/api/costs` akzeptieren optional `costCenterId`.
- Ohne Feld greift die Default-Logik; `null`/leer erzwingt „keine Kostenstelle“.
- Eine explizite Auswahl erfordert `cost_centers_view`; bestehende Werte können auch ohne dieses Recht unverändert gespeichert werden.

### State

- `costCenters` mit `id`, `code`, `name`, `description`, `active`, `usage` (Fahrzeuge, Fahrer:innen, Benutzer, Buchungen, Anfragen, Kosten, Gesamt) nur bei `cost_centers_view`.
- Fahrzeuge, Fahrer:innen, Buchungen, Buchungsanfragen, Kosten und Benutzer tragen `costCenterId`, `costCenterCode`, `costCenterName`.
- Benutzer-Kostenstellen erscheinen nur im Benutzerverwaltungs-State.

### Export

- JSON-Export enthält `costCenters` und die Zuordnungsfelder; SMTP bleibt weiterhin ausgeschlossen.
- CSV-Fahrtenbuch: Spalte `Kostenstelle` (Code · Name) **am Ende**; optionaler Filter `?costCenter=<id>` oder `?costCenter=none`.
- CSV-Formel-Injection-Neutralisierung bleibt aktiv.

## 5. Audit

- `create`, `update`, `deactivate`, `delete` auf `cost_center`.
- `assign_cost_center` auf Fahrzeug, Fahrer:in und Benutzerkonto bei Zuordnungsänderungen.
- Buchungs-/Kosten-/Nachtrags-Audits enthalten `costCenterId`.
- Audit-Ziel-Label für Kostenstellen zeigt Code und Name; Sichtbarkeit über `cost_centers_view`.

## 6. UI

- Einstellungen → Karte „Kostenstellen“ mit Code, Bezeichnung, Status, Nutzung, Anlegen/Bearbeiten/Deaktivieren/Löschen.
- Auswahl „Kostenstelle“ in Fahrzeug-, Fahrer:-, Benutzer-, Buchungs-, Anfrage-, Kosten- und Nachtrags-Dialogen; Default-Hinweis mit Quelle.
- Badges in Fahrzeugliste, Fahrer-Karten, Buchungsdetails, Kostentabelle und Benutzerliste.
- Kosten: Filter „Kostenstelle“, Spalte und Karte „Kosten nach Kostenstelle“.
- Fahrtenbuch: Filter „Kostenstelle“, Spalte und CSV-Filter.
- Leerzustände „Ohne Kostenstelle“/„Keine Kostenstellen“.
- Inaktive Kostenstellen sind in Auswahllisten nur sichtbar, wenn sie bereits zugeordnet sind.

## 7. Tests

**Neu:** `tests/cost-centers.test.js` (7 Tests) und `tests/cost-centers-api.test.js` (7 Tests).

Abgedeckt:

- CRUD, Code-Normalisierung, Duplikat 409, Deaktivieren, Löschsperre mit Nutzungsdetails.
- Default-Präzedenz Buchung/Kosten in allen Kombinationen inkl. explizitem `null` und inaktiven Defaults.
- Snapshot-Historie: Default-Änderung verändert bestehende Buchungen nicht.
- Rechte: Manager-Default, Viewer ohne Stammdatenliste, View-only ohne Schreibrecht, Delegation von `cost_centers_view`.
- State: Kostenstellen, IDs/Code/Name, Benutzer-Zuordnung, inaktive und „Ohne Kostenstelle“.
- JSON-Export und CSV-Spalte/Filter inkl. Formel-Injection.
- Migration 5→6 idempotent, Spalten, `ON DELETE SET NULL`, Manager-Rechte, `foreign_key_check`.
- Audit für CRUD, Deaktivierung und Zuordnungsänderungen.

**Regression:** vollständige Suite `node --test` → **69/69 Tests grün** (55 Bestand + 14 neu). QS-001/005/007/008, Rollen-, Superadmin-, Leasing- und UI-Tests bleiben grün.

**UI-Smoke (temporärer Lokalserver, kein Deploy):** Kostenstelle `KST-100` angelegt, Fahrzeug und Fahrer:in zugeordnet, Kostenstelle in Fahrzeugkarte/Fahrer-Karte sichtbar, Buchungsdialog mit Default-Hinweis „Vorbelegt aus Fahrer:in“, Kostenansicht mit Spalte/Filter, Fahrtenbuch mit Spalte/Filter. Keine Konsolenfehler.

## 8. Betrieb und Grenzen

- Kein Deploy, kein Merge nach `main`, keine STABLE-Änderung.
- Keine Hierarchien, Budgets, Buchhaltungsintegration oder DATEV-Export.
- Snapshot ist die Kostenstellen-ID; Code/Name werden beim Lesen aus dem aktuellen Stammdatum aufgelöst.
- Löschen ist nur ohne Referenzen möglich; Deaktivieren erhält die Historie.
- Die Kostenstellen-Nutzungszahlen werden serverseitig aus allen Referenztabellen berechnet.

## 9. QS-Übergabe

Bitte prüfen:

1. Migration v0.7.1 (`user_version = 5`) → 6, Idempotenz, FK/`foreign_key_check`, Bestandsdaten `NULL`.
2. Manager-Rechte und Delegation/Grant Ceiling.
3. Default-Präzedenz Buchung/Kosten/Anfrage inkl. explizitem `NULL`, inaktiven Defaults und Snapshot.
4. CRUD/Deaktivieren/Löschsperre und Audit.
5. State/Filter, UI-Dialoge, Badges, Kosten-/Fahrtenbuch-Summen.
6. JSON/CSV inkl. Formel-Injection.
7. Regression QS-001/005/007/008 sowie Rollen/UI/Superadmin/Leasing.
