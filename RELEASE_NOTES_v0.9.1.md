# AWO Fuhrparkmanagement – Release Notes v0.9.1

**Stand:** 28.10.2026  
**Status:** QS-freigegeben (22/22 UI-Fix + 23/23 QS-013-Nachprüfung; keine blockierenden Findings)  
**Migration:** keine (bleibt `user_version = 7`)  
**Basis:** v0.9.0 (`d039fdf`)

## Änderungen

- **QS-012 geschlossen:** Der Fokusring nutzt jetzt `var(--ink)` und erreicht in Light und Dark deutlich über 3:1 Kontrast.
- **Custom-Akzent im Dark Mode:** Dunkle kundenspezifische Akzentfarben werden serverseitig und clientseitig aufgehellt (`--awo-on-dark`, `--brand-rgb-on-dark`, `--awo-soft-on-dark`). Light Mode behält das Original, AWO-Dark bleibt `#ff5a6a`.
- **Fahrzeug-Objekt-Deny:** Fahrzeuge mit `vehicles_view`-Deny sind im Buchungsanfrage-Dropdown unsichtbar und können auch per `POST /api/booking-requests` nicht angefragt werden (403). User-Regel vor Rollen-Regel, Allow vor Deny.
- **Fallback für Fahrer ohne globales `vehicles_view`:** Alle Fahrzeuge außer explizit verweigerten bleiben anfragbar.

## QS

- QS-012 / Custom-Akzent: 22/22 Checks PASS.
- QS-013 (Dropdown + serverseitige Durchsetzung): 23/23 Checks PASS, Finding geschlossen.
- Regression: 84/84 Tests, keine neuen Findings.

## Upgrade

- Keine Schemaänderung; `user_version` bleibt 7.
- Keine Änderung an Bestandsdaten, Rollen oder Objekt-Ausnahmen.
