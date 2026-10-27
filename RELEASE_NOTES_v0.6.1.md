# AWO Fuhrparkmanagement
## Release Notes v0.6.1 – Own-Trip-Actions, Superadmin (Etappe 3), UI-Fix

**Final, fusionsbereit – QS-Freigabe erteilt**

| | |
| --- | --- |
| **Stand** | 27.10.2026 · DEV `506b9f0` · main/STABLE/Server weiterhin v0.6.0 |
| **Status** | **QS-Freigabe erteilt (JA, keine Findings) – Tag/Deploy durch die Implementierung** |
| **QS-Ergebnis** | Own-Trip 45/45 · Superadmin 62/62 · Rolle ausgeblendet 21/21 · UI-Fix/Admin-Self-Link 35/35 + 15/15 DEV-Smoke |
| **Pflege** | Dokumentations-Session; Übernahme in die repo-seitigen Release Notes durch die Implementierung |

> Keine Zugangsdaten, keine internen Server-Adressen, keine personenbezogenen Echtdaten.

---

## 1. Neu in v0.6.1

- **Own-Trip-Actions (`own_trips_execute`):** verknüpfte Fahrer:innen mit `own_trips_access=1` starten und beenden eigene Fahrten in „Meine Fahrten"; fremde/unverknüpfte Kontexte erhalten 403; Km-/Statusregeln serverseitig geprüft; Audit.
- **Superadmin (Etappe 3):** serverdateibasiert über `SUPERADMIN_FILE` (bcrypt-Hash, kein Klartext; Rechte 0600; außerhalb Repo/Volume/Backup); Rank 2.000.000, systemgeschützt; **in der UI vollständig ausgeblendet** (Nutzerfeedback; intern systemgeschützt); Admin-Verwaltung ausschließlich durch den Superadmin; letzter-Admin-Schutz; Recovery durch Datei-Ersetzen und Neustart.
- **UI-Berechtigungs-Fix:** Sidebar ohne Flash unerlaubter Punkte; Einstellungen nur mit erlaubten/benötigten Karten; „Konto" bleibt sichtbar.
- **Admin-Self-Driver-Link:** Admins verknüpfen/entknüpfen ausschließlich das eigene Konto mit einer Fahrer:in; Anzeige unter „Einstellungen → Ihr Konto"; Audit; nicht für Nicht-Admins.

## 2. Upgrade und Migration

- Schema-Version steigt auf `user_version = 4`; Migration und Defaults laufen beim Start.
- **Superadmin-Datei vor dem ersten Start separat einrichten:** Hash offline erzeugen, Datei mit Rechten 0600 ablegen, außerhalb von Repo, Daten-Volume und Backup; Änderungen nur durch Datei-Ersetzen und Neustart.
- Sicherung mit dem Sicherungsskript vor dem Update; Update über Docker-Image und Update-Skript.
- Hinweise aus v0.6.0 (Alt-Rollen einmalig neu speichern) bleiben bestehen.

## 3. Betriebsdoku

- **Admin-Verwaltung ab Etappe 3:** Andere Admin-Konten verwaltet ausschließlich der Superadmin (Datei-basiert); Administrator:innen untereinander weiterhin gesperrt.
- **Sichtbarkeit:** Die Superadmin-Rolle erscheint in keiner UI-Liste; sie ist ausschließlich intern/systemseitig vorhanden.
- **Recovery:** Fehlende oder ungültige Superadmin-Datei → Warnung im Log, Superadmin-Login gesperrt, System läuft weiter; Wiederherstellung durch gültige Datei und Neustart.

## 4. QS-Ergebnis und Abgrenzung

- **QS-Finalfreigabe: JA.** Own-Trip 45/45, Superadmin 62/62, Superadmin-Rolle ausgeblendet 21/21; UI-Berechtigungs-Fix und Admin-Self-Driver-Link mit 35/35 Checks + 15/15 DEV-Smoke, keine Findings.
- DEV `506b9f0` ist vollständig freigegeben; Tag und Deploy erfolgen durch die Implementierung auf Basis dieser finalen Doku-Dateien.
- **Backlog nach Release:** Dark Mode. Bestehende Backlog-Items (QS-010, QS-003/004/006) unverändert.
- Der Deploy selbst ist nicht Teil dieser Notes; die Freigabe bezieht sich auf den DEV-Stand `506b9f0`.
