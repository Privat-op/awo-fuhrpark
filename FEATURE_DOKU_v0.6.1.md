# AWO Fuhrparkmanagement
## Feature-Doku v0.6.1 – Own-Trip-Actions, Superadmin (Etappe 3), UI-Berechtigungs-Fix

**README-Baustein (fusionsbereit) – Release-Kandidat**

| | |
| --- | --- |
| **Stand** | 27.10.2026 · DEV `506b9f0` (vollständig freigegeben) · main/STABLE/Server weiterhin v0.6.0 |
| **Status** | **Freigegeben – QS-Finalfreigabe JA, keine Findings** |
| **QS-Ergebnis** | Own-Trip 45/45 · Superadmin 62/62 · Rolle ausgeblendet 21/21 · UI-Fix/Admin-Self-Link 35/35 + 15/15 DEV-Smoke |
| **Pflege** | Dokumentations-Session; baut auf `AWO_Fuhrparkmanagement_Feature_Doku_v0.6.0.md` auf |

> Keine Zugangsdaten, keine internen Server-Adressen, keine personenbezogenen Echtdaten.

---

### 1. Own-Trip-Actions (Start/Ende eigener Fahrten)

- Neues Recht `own_trips_execute`; Default für verknüpfte Fahrer:innen mit `own_trips_access=1` (explizite Benutzer-/Rollenregeln überschreiben wie bisher).
- Verknüpfte Fahrer:innen können in „Meine Fahrten" Start und Ende ihrer eigenen Fahrten erfassen.
- Fremde oder unverknüpfte Kontexte erhalten serverseitig 403.
- Km-/Statusregeln werden serverseitig geprüft.
- Alle Aktionen werden im Audit-Protokoll erfasst.

### 2. Superadmin (Etappe 3)

- Serverdatei-basierter Superadmin: konfigurierbar über `SUPERADMIN_FILE`; Inhalt als bcrypt-Hash (**kein Klartext**), Dateirechte 0600, außerhalb von Repo, Daten-Volume und Backup.
- Rank 2.000.000, oberhalb von Admin; Rolle systemgeschützt, nicht löschbar.
- **Die Superadmin-Rolle ist in der UI vollständig ausgeblendet** (Nutzerfeedback); intern bleibt sie systemgeschützt.
- Admin-Verwaltung (Anlegen, Bearbeiten, Deaktivieren anderer Admin-Konten) ausschließlich durch den Superadmin; die Admin-Übergangssperre aus Etappe 1 wird damit aufgelöst.
- Letzter-Admin-Schutz bleibt bestehen; der Superadmin selbst ist vor Deaktivierung/Anonymisierung/Löschung geschützt.
- Recovery: Superadmin-Datei ersetzen und Dienst/Container neu starten; keine UI-/API-Änderbarkeit.
- Migration auf `user_version = 4`.

### 3. UI-Berechtigungs-Fix

- Sidebar rendert ohne kurzes Aufblitzen (Flash) unerlaubter Punkte.
- Einstellungen zeigen nur die Karten, die erlaubt oder benötigt sind.
- „Konto" bleibt sichtbar.

### 4. Admin-Self-Driver-Link

- Administrator:innen können ausschließlich das **eigene** Konto mit einer Fahrer:in verknüpfen oder entknüpfen (nicht Konten anderer; nicht für Nicht-Admins).
- Anzeige und Bedienung unter „Einstellungen → Ihr Konto".
- Aktionen werden im Audit-Protokoll erfasst.

---

**Pflege:** Baustein ist mit dem QS-Abschluss zu v0.6.1 vervollständigt. Übernahme in das Projekt-README durch die Implementierung (Doku-Mandat: keine Repo-Änderungen).
