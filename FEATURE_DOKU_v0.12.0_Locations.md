# Feature-Doku v0.12.0 – Standorte und Freigaberouting

**Status:** implementiert auf `dev`; Feature standardmäßig aus. Keine QS-Freigabe, kein Deploy/Tag.  
**Migration:** `user_version = 13`.  
**Flag:** `LOCATIONS_ENABLED=false` (Default); bei `false` bleibt das bisherige Verhalten unverändert.

## 1. Datenmodell

- `locations`: `id`, `name` (unique, case-insensitive), `active`, `created_at`, `updated_at`.
- `users.location_id` und `vehicles.location_id`: nullable FK auf `locations` (`ON DELETE SET NULL`).
- Der bestehende Freitext `vehicles.location` bleibt als Beschreibung erhalten; `location_id` steuert Sichtbarkeit und Routing.

## 2. Sichtbarkeit

Bei aktivem Flag:

| Akteur | Sichtbarkeit |
|---|---|
| Superadmin, Administrator, Fuhrparkleitung | global |
| Andere Rolle mit Standort | Fahrzeuge/Buchungen/Wartungen/Kosten/Buchungsanfragen des eigenen Standorts; Fahrzeuge ohne Standort bleiben sichtbar |
| Andere Rolle ohne Standort | global (Legacy/Übergang) |

Eigene Fahrten bleiben an die verknüpfte Fahrer:in gebunden; die Fahrzeugauswahl folgt der Standortregel.

## 3. Freigaberouting

- `isRequestVisibleToApprover` filtert zusätzlich nach Fahrzeugstandort: Manager mit Standort sehen nur Anfragen desselben Standorts; Manager ohne Standort und Administrator:innen sind global.
- E-Mail-/Teams-Empfänger für neue Buchungsanfragen werden mit derselben Standortregel gefiltert.
- Entscheidungsmails an die anfragende Person bleiben unverändert.

## 4. API und UI

- `POST /api/locations`, `PATCH /api/locations/:id`, `DELETE /api/locations/:id` nur `admin`/`superadmin`.
- Löschen nur ohne zugeordnete Benutzer/Fahrzeuge; sonst `409` und Deaktivieren.
- Standortkarte in **Einstellungen → Standorte** (nur bei Flag und privilegiert).
- Standortauswahl in Benutzer- und Fahrzeugformularen.
- State: `features.locationsEnabled`, `locations`, `locationId`/`locationName` an Benutzern und Fahrzeugen.
- Audit: `create/update/delete` für `location`, `assign_location` für Benutzer/Fahrzeuge.

## 5. Tests

- Migration 12→13 idempotent, FK und Spalten.
- Flag aus: keine Filterung, keine Verhaltensänderung.
- Flag an: Sichtbarkeit für Fahrzeuge/Buchungen/Kosten/Wartungen, global sichtbare Fahrzeuge ohne Standort.
- Approval-Routing und Empfängerfilter.
- API-CRUD, Zuordnung an Benutzer/Fahrzeug, Löschsperre.
- Bestehende 168 Tests bleiben grün.

## 6. Offene Punkte

- Produktive Standortnamen, Zuordnungen und Freigabeverantwortliche festlegen.
- Standortbasierte Sichtbarkeit für Benutzerverwaltung/Rollen ist bewusst nicht eingeschränkt; sie bleibt rang-/rechtbasiert.
- Rechtliche/organisatorische Freigabe der Standort-Sichtbarkeit und Approval-Policy vor Produktivbetrieb.
- Keine Löschung von Buchungen/Kosten/Fahrtenbuch durch Standorte.
