# AWO Fuhrparkmanagement – Release Notes v0.9.0

**Stand:** 28.10.2026  
**Status:** QS-freigegeben (54 Checks, Freigabe JA; ein niedriges Finding QS-012 im Backlog)  
**Migration:** `user_version = 7` (idempotent)  
**Basis:** v0.8.0 (`99c08d1`)

## Inhalte

### Dark Mode
- Drei Modi pro Nutzerkonto: `light`, `dark`, `auto`; `NULL` folgt dem globalen Default `light`.
- Globaler Default in den Einstellungen durch `settings_manage` änderbar; die Loginseite nutzt ausschließlich diesen Default.
- `auto` folgt der Systemeinstellung über `prefers-color-scheme`, ohne Reload.
- Kein Flackern: serverseitiges `data-color-mode` und Bootstrap-Script vor dem Stylesheet; CSP ohne `unsafe-inline` über Script-Hashes.
- Semantische Light-/Dark-Tokens für AWO und neutral: Karten, Topbar, Tabellen, Formulare, Modale, Charts, Toasts, Leerzustände und Login.
- Kompakter Header: ein Hell/Dunkel-Umschalter; die Drei-Wege-Auswahl bleibt in den Einstellungen. Der Header bleibt im Dark Mode dunkel.
- Fokusringe, `prefers-reduced-motion` und Druck/PDF (immer hell) berücksichtigt.
- Audit nur mit `colorMode` bzw. `defaultColorMode`.

## QS
- 54 Checks, alle prüfrelevanten PASS; Freigabe JA.
- Header-Fix separat: 17/17 Checks PASS, keine Findings.
- Ein niedriges Finding: **QS-012** – Fokusring-Kontrast rechnerisch unter 3:1 (halbtransparenter Ring); nicht blockierend, Backlog.
- Hinweis: kundenspezifische dunkle Akzentfarben werden im Dark Mode nicht automatisch aufgehellt (Backlog).

## Upgrade
- Migration läuft beim Start automatisch und ist idempotent (`user_version` 6 → 7).
- Bestandsnutzer erhalten `NULL` und damit zunächst den bisherigen hellen Look; der globale Default bleibt `light`.
- Keine Änderung an Fahrzeugen, Buchungen, Kostenstellen, Leasing, SMTP- oder Superadmin-Daten.
