# AWO Fuhrparkmanagement – Release Notes v0.6.0

**Release-Basis:** `4a18ec2` (QS-getestete DEV-Integration)  
**Stand:** 27.10.2026  
**QS-Freigaben:** Etappe 2 JA (112/112 + Migration), Audit JA (36/36 + Migration), Sidebar/STABLE `d69755b` JA, DEV-Preview JA. QS-009 im DEV-Merge behoben; QS-010 offen im Backlog.

## 1. Own Trips und Buchungsanfragen

- Fahrer:innen werden 1:1 mit Benutzerkonten verknüpft (`drivers.user_id`; ein Benutzer maximal einem Fahrer, ein Fahrer maximal einem Benutzer).
- Neue Rechte: `own_trips_view` und `own_trips_request` (Request impliziert View). Die Verknüpfungspflege fällt unter `users_manage`; `own_trips_access` steuert den Fahrer-Default.
- Vorrang: Benutzer-Objekt → Benutzer global → Rollen-Objekt → Rollenrecht → Fahrer-Default. Explizite Allow-/Deny-Regeln überschreiben den Default.
- „Meine Fahrten“ ist eine eigene, schlanke Read-only-Ansicht für eigene Buchungen und Anfragen; keine fremden Fahrten, keine Stammdatenverwaltung, kein Export.
- Verknüpfte Fahrer:innen mit explizitem `bookings_create` dürfen weiterhin direkt buchen; ohne dieses Recht nur per Anfrage.
- `booking_requests_manage` (Default Fuhrparkleitung) steuert das Verwalten von Anfragen. Pro Rolle gilt eine Allow-/Deny-Policy: leere Allow-Liste = alle zulässigen unteren Rollen; Deny gewinnt; nur strikt niedrigere Ränge; keine Selbstgenehmigung.
- Anfragen reservieren kein Fahrzeug. Die Genehmigung ist transaktional: Status erneut prüfen, Doppelbelegung prüfen, genau eine geplante Buchung anlegen. Konflikt oder zweite Genehmigung → 409, Request bleibt offen.
- Reject mit optionaler Begründung; Cancel nur durch Antragsteller:innen im Status `requested`.
- Offene Anfragen werden bei Deaktivierung/Anonymisierung des Requesters automatisch storniert und auditiert. Bereits entschiedene/gebuchte Anfragen bleiben erhalten.
- Audit für Create, Approve, Reject und Cancel.

## 2. Dauerhafte Fahrzeug-Sperre

- Fahrzeuge können über die Fahrzeugverwaltung (`vehicles_manage`) dauerhaft gesperrt und entsperrt werden; Begründung optional.
- `POST /api/bookings` und `POST /api/booking-requests` antworten für gesperrte Fahrzeuge mit 409 und klarer Meldung.
- Bestehende Buchungen sowie Start/Ende bleiben unverändert.
- Sperren, Entsperren und Begründungsänderungen werden auditiert.

## 3. Audit-Log

- Für alle angemeldeten Nutzer:innen erreichbar.
- Sichtbarkeit ausschließlich serverseitig: ohne Audit-Recht nur eigene Aktionen; mit `audit_view` zusätzlich Aktionen von Personen mit strikt niedrigerem Rang; mit `audit_view_all` alle Einträge. Kein Switch und kein `all`-Parameter.
- `audit_view_all` impliziert `audit_view`, ist innerhalb Grant Ceiling und Rang-Gate delegierbar. Fuhrparkleitung erhält per Default `audit_view`, nicht `audit_view_all`.
- Rolle, Rollenname und Rang werden beim Schreiben als Snapshot gespeichert; spätere Änderungen wirken nicht rückwirkend.
- Suche und Filter (`q`, Akteur, Aktion, Zieltyp, Ziel, Zeitraum) arbeiten nur auf dem serverseitig eingeschränkten Bereich. Pagination: Standard 25, Maximum 100; Sortierung `created_at DESC, id DESC`.
- Maskierung: fremde Einträge mit `audit_view` zeigen Name und Rolle, E-Mail/Telefon maskiert; `audit_view_all` unmaskiert. Ziel-Labels nur bei Objektberechtigung, sonst Typ + gekürzte ID.
- Details nur als serverseitig erzeugte Allowlist; keine Passwörter, Hashes, Tokens, Cookies, Session-IDs oder IPs.
- Meta-Audit: Lesezugriffe werden ohne Inhalte protokolliert; Meta-Einträge nur für `audit_view_all`/Admin.
- Kein Export, keine Lösch-/Rotationslogik; Retention unverändert.

## 4. Oberfläche

- Neue Navigation „Meine Fahrten“, „Buchungsanfragen“ und „Audit-Log“.
- „Buchung anfragen“ nur mit `own_trips_request`.
- Zahnrad-Settings-Einstieg als zentraler Einstieg; User-Block löst keine Navigation mehr aus.
- Info-Box „Rang und Grant Ceiling“ im Rollenformular entfernt.

## 5. Migration und Upgrade

- Schema-Version steigt auf `user_version = 3`; die Migration läuft beim Start und ist idempotent.
- Bestehende Fuhrparkleitung erhält die neuen Defaults einmalig (`users_manage`, `roles_manage`, `booking_requests_manage`, `audit_view`); danach über Rolle oder Benutzer-Ausnahme anpassbar.
- Bestehende Audit-Einträge werden mit Rolle/Rang-Snapshot nachbefüllt; nicht auflösbare Altzeilen bleiben nur für Self bzw. All/Admin sichtbar.
- Vor einem Update Sicherung mit dem Sicherungsskript erstellen; Docker-Image und Update-Skript mit persistentem Daten-Volume verwenden.
- Bestandshinweis aus v0.5.2 bleibt: Bestandsrollen mit eingebrannten Alt-Implications werden nicht rückwirkend reduziert; einmaliges Neinspeichern normalisiert.

## 6. Betrieb

- Admin-Übergangsregel bis Etappe 3: Admin-Konten sind weder via API anlegbar noch änderbar; das eigene Profil umfasst nur den Passwortwechsel.
- STABLE-Stand nach QS-Freigabe: `d69755b` (Sidebar-Fix).
- DEV-Stand: `origin/dev` mit der integrierten QS-Basis `4a18ec2`.
- Kein Server-Deploy im Rahmen dieser Release-Vorbereitung; Deploy erst nach Freigabe durch die Koordination.

## 7. Bekannte Einschränkungen / Backlog

- QS-010 (niedrig): `PATCH /api/roles/:id` ohne `permissions` – offen im Backlog.
- QS-003/004/006 – offen im Backlog.
- Audit-Log in v0.6.x ohne Export und ohne Löschung; Retention unverändert.
- E-Mail-/Teams-Benachrichtigungen folgen später.
- Superadmin gehört zu Etappe 3 und ist nicht Teil von v0.6.0.
