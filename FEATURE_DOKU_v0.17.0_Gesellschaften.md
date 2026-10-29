# Feature-Doku v0.17.0 – Gesellschaften und Kostenstellencodes

**Status:** implementiert auf `dev`; keine QS-Freigabe, kein Tag, kein Deploy.  
**Migration:** `user_version = 17`.  
**Zugriff:** Gesellschaften lesen `cost_centers_view`/`cost_centers_manage`; schreiben `settings_manage`.

## 1. Ziel

Kostenstellencodes sollen je Gesellschaft wiederverwendbar sein. Gesellschaft ist ein Stammdatum; es gibt **keine vollständige Mandantentrennung**. Fahrzeuge, Benutzer, Buchungen und Kosten bleiben gesellschaftsneutral.

## 2. Datenmodell (Migration 16→17)

### `companies`

| Feld | Typ |
|---|---|
| `id` | TEXT PK |
| `code` | TEXT NOT NULL COLLATE NOCASE UNIQUE |
| `name` | TEXT NOT NULL |
| `active` | INTEGER 0/1, Default 1 |
| `created_at`, `updated_at` | TEXT |

### `cost_centers`

- `company_id TEXT NOT NULL REFERENCES companies(id)`
- Unique: `(company_id, code COLLATE NOCASE)`
- Der bisherige globale `UNIQUE(code)` entfällt.

Die Migration legt eine Standardgesellschaft `STANDARD` an; Name aus `settings.org_name`, Fallback „Standardgesellschaft“. Bestehende Kostenstellen werden ihr zugeordnet. Die Tabelle wird per Rebuild migriert (neue Tabelle, Kopieren, Drop, Rename), IDs und Referenzen aus vehicles/drivers/users/bookings/booking_requests/costs bleiben erhalten. Danach `foreign_key_check`; bei Verletzungen bricht die Migration ab. Idempotent und ohne Datenverlust.

## 3. API

| Methode | Pfad | Recht |
|---|---|---|
| GET | `/api/companies` | `cost_centers_view` oder `cost_centers_manage` |
| POST/PATCH/DELETE | `/api/companies` bzw. `/:id` | `settings_manage` |

- Gesellschaft: Code/Name validiert; Code case-insensitiv eindeutig; aktiv/inaktiv.
- Löschen nur ohne Kostenstellen; sonst `409` und deaktivieren.
- Kostenstellen: `companyId` bei Neuanlage Pflicht, bei Updates beibehalten/änderbar; inaktive Gesellschaft nur bei unveränderter Zuordnung.
- Duplikatprüfung je Gesellschaft; Fehler `409`: „Eine Kostenstelle mit diesem Code existiert in dieser Gesellschaft bereits.“
- Audit: `create`/`update`/`delete`/`activate`/`deactivate` für `company` und `cost_center`, inklusive `companyId`, `companyCode`, `companyName`; ohne Secrets.

## 4. State und Export

- Kostenstellen und zugeordnete Objekte enthalten `companyId`, `companyCode`, `companyName`.
- `state.companies` für Berechtigte; keine Sichtbarkeitseinschränkung.
- JSON-Export enthält die Felder über den State.
- Fahrtenbuch-CSV hat eine eigene Spalte `Gesellschaft` vor `Kostenstelle`.

## 5. UI

- Neue Seite **Einstellungen → Gesellschaften** (Navigation) mit Liste, Anlegen, Bearbeiten, Aktivieren/Deaktivieren und Löschen.
- Kostenstellenkarte: Spalte Gesellschaft, Filter nach Gesellschaft, Suche nach Code/Name, Pflicht-Select im Formular.
- Alle Kostenstellen-Dropdowns (Buchung, Anfrage, Fahrzeug, Fahrer, Benutzer, Kosten) zeigen `Gesellschaft · Code · Name`.
- Warnhinweis: keine Mandantentrennung; alle Berechtigten sehen alle Gesellschaften.

## 6. Tests

- Migration 16→17: Standardgesellschaft, Rebuild, Daten-/ID-Erhalt, Fremdschlüssel, Idempotenz.
- Gleicher Code in zwei Gesellschaften erlaubt; gleicher Code in derselben Gesellschaft (case-insensitiv) `409`.
- Company-CRUD, Rechte, Validierung, Deaktivierung, Löschsperre, Audit.
- Kostenstellen-CRUD mit `companyId`, State-/Export-Felder, CSV-Spalte.
- UI-Harness: Gesellschaftsseite, Spalte/Filter, Formular-Select, Dropdown-Label.
- Vollständige Regression: **213/213 Tests**.

## 7. Offene Punkte

- Weitere Gesellschafts-Stammdaten (Adresse, Nummernkreise) nicht enthalten.
- Keine Sichtbarkeits-/Zugriffstrennung nach Gesellschaft (bewusst Phase 2).
- Keine Migration von Fahrzeugen/Benutzern/Buchungen auf Gesellschaften.
- Keine QS-Freigabe, kein Tag, kein Deploy.
