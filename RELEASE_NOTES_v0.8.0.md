# AWO Fuhrparkmanagement – Release Notes v0.8.0

**Stand:** 28.10.2026  
**Status:** QS-freigegeben (54/54 dynamische Checks + 9/9 Migrationstests, keine Findings)  
**Migration:** `user_version = 6` (idempotent)  
**Basis:** v0.7.1 (`d0134e1`)

## Inhalte

### Kostenstellen-Stammdaten
- Code (normalisiert: trim + Großschrift, eindeutig ohne Case-Unterschied), Bezeichnung, Beschreibung, Aktivstatus.
- Nutzungszählung über Fahrzeuge, Fahrer:innen, Benutzer, Buchungen, Buchungsanfragen und Kosten.
- Anlegen, Bearbeiten, Deaktivieren/Reaktivieren, Löschen nur ohne Referenzen (sonst 409 mit Hinweis auf Deaktivieren).
- Audit für Anlegen, Bearbeiten, Deaktivieren und Löschen.

### Zuordnungen und Defaults
- Fahrzeuge, Fahrer:innen und Benutzerkonten können eine Kostenstelle als Default tragen.
- Buchung/Anfrage: explizite Auswahl > Fahrer:in > Fahrzeug > Benutzerkonto > keine.
- Kosten: explizite Auswahl > Fahrzeug > Benutzerkonto > keine.
- Explizites Leerfeld überschreibt Defaults bewusst; inaktive Kostenstellen werden als Default übersprungen.
- Bestehende Buchungen/Kosten bleiben als Snapshot unverändert; Code/Name werden beim Lesen aus dem aktuellen Stammdatum aufgelöst.

### Rechte
- `cost_centers_view` und `cost_centers_manage`.
- Fuhrparkleitung erhält beide per Migration; Administrator automatisch; Delegation und Grant Ceiling werden berücksichtigt.
- Zuordnungen erfordern `cost_centers_view` plus das jeweilige Formularrecht.
- Ohne Sichtrecht keine Stammdatenliste; Snapshot-Code/Name bleibt an Buchungen/Kosten sichtbar.

### Anzeige und Export
- Einstellungen-Karte „Kostenstellen“, Auswahlfelder in allen relevanten Dialogen, Badges in Details.
- Kostenansicht: Filter, Spalte und Summenkarte „Top-Kostenstellen“.
- Fahrtenbuch: Filter und CSV-Spalte `Kostenstelle` am Ende.
- JSON-Export mit Kostenstellen-IDs/Code/Name.
- CSV-Filter `costCenter=<id>` und `costCenter=none`; Formel-Injection-Schutz bleibt aktiv.

## QS
- 54/54 dynamische Checks PASS, 9/9 Migrationstests PASS, keine Findings.
- Geprüft: Migration 5→6, CRUD/Code-Konflikte, Löschsperre, Default-Präzedenz in allen Kombinationen, Snapshots, Rechte/Delegation, State/Filter, CSV/JSON, UI, Regression QS-001/005/007/008 sowie Superadmin/Demotion/Bannerfix.

## Upgrade
- Migration läuft beim Start automatisch und ist idempotent (`user_version` 5 → 6).
- Bestandsdaten bleiben erhalten und zunächst „Ohne Kostenstelle“; keine automatische Rückfüllung.
- Keine Änderung an SMTP-, Leasing- oder Superadmin-Daten.
