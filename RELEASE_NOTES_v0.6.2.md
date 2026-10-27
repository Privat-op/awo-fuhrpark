# AWO Fuhrparkmanagement – Release Notes v0.6.2

**Patch-Release:** 27.10.2026  
**Basis:** `8a4a81b` (Encoding-Fix)  
**Änderung:** Reparatur doppelt kodierter UTF-8-Texte in Frontend, README und ausgewählten Hilfsskripten.

## Behoben

- Umlaute und Sonderzeichen wurden in einzelnen UI-Texten als `Ã…`/`Â…` angezeigt, z. B. „Nicht verknüpft“.
- Betroffene Dateien:
  - `public/views.js`
  - `README.md`
  - `package.json`
  - `scripts/superadmin-setup.js`

## Nicht geändert

- Keine Änderung an Berechtigungen, Datenmodell, API, Audit oder Superadmin-Logik.
- Keine Datenbankmigration über `user_version = 4` hinaus.
- Kein neues Feature.

## Upgrade

Bestehendes Image/Container-Verfahren mit persistentem Daten-Volume verwenden. Vor dem Update eine Sicherung erstellen.
