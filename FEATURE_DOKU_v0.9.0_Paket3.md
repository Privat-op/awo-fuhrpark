# AWO Fuhrparkmanagement – Feature-Doku v0.9.0 Paket 3

**Stand:** 28.10.2026  
**Branch:** `feature/v090-darkmode`  
**Basis:** `main` / `99c08d1` (v0.8.0)  
**Status:** implementiert, lokal getestet, **nicht deployed**

## 1. Ziel

Pro Nutzerkonto ein helles, dunkles oder automatisches Farbschema; ein globaler Default für neue bzw. nicht gesetzte Konten und die Loginseite; konsistente Darstellung in AWO- und neutralem Theme inklusive Tabellen, Karten, Formularen, Modalen, Charts, Toasts, Leerzuständen und Login. Druck/PDF bleibt immer hell.

## 2. Datenmodell und Migration

Migration `server/lib/color-mode-schema.js`, `COLOR_MODE_SCHEMA_VERSION = 7`, idempotent.

| Tabelle | Feld | Regel |
|---|---|---|
| `users` | `color_mode` | TEXT nullable, Check `light|dark|auto`; `NULL` = globaler Default |
| `settings` | `default_color_mode` | TEXT NOT NULL DEFAULT `light`, Check `light|dark|auto` |

Bestandsnutzer erhalten `NULL`; es findet keine Rückfüllung statt. Der globale Default bleibt `light`, bis er geändert wird.

## 3. Auflösung und API

- `settings.defaultColorMode` im State.
- `user.colorMode` (`null|light|dark|auto`) und `user.resolvedColorMode` (`light|dark`) in `/api/session` und im Benutzer-State.
- `auto` wird serverseitig nicht fest aufgelöst; `resolvedColorMode` ist der sichere Fallback `light`. Der Client löst `auto` über `matchMedia('(prefers-color-scheme: dark)')` auf.
- `PATCH /api/me/preferences` mit `{ colorMode }`:
  - nur eigenes Konto; `userId`, `email` oder andere Ziel-IDs im Body werden ignoriert.
  - ungültige Modi: 400.
  - Audit `update`/`user` mit ausschließlich `{ colorMode }`.
- `PATCH /api/settings` ergänzt optional `defaultColorMode`; bestehende `settings_manage`-Prüfung bleibt. Audit enthält `defaultColorMode`.
- Loginseite nutzt ausschließlich `settings.default_color_mode`; kein localStorage und kein Umschalter ohne Konto.

## 4. Rendering ohne Flackern

- `index.html` und `login.html` rendern `data-color-mode` und `data-color-mode-preference` bereits am `<html>`-Element.
- Ein CSP-konformes Inline-Script **vor dem Stylesheet** löst nur `auto` per `prefers-color-scheme` auf und setzt `color-scheme`.
- Die CSP-`script-src`-Direktive enthält den berechneten SHA-256-Hash des Bootstrap-Scripts; kein `unsafe-inline`.
- `matchMedia`-Listener aktualisieren `auto` ohne Reload; die App setzt beim Umschalten `data-color-mode-preference` und`data-color-mode` sofort.
- Login nutzt den globalen Default; die App nutzt die Nutzerpräferenz, sonst den Default.

## 5. CSS-Tokens und Darstellung

`public/styles.css` und `public/login.css` definieren semantische Tokens:

- Flächen/Typografie: `--bg`, `--surface`, `--surface-2`, `--ink`, `--ink-2`, `--muted`, `--subtle`, `--line`, `--line-soft`.
- Status: `--green`, `--amber`, `--red`, `--blue`, `--violet`, `--teal` plus Soft-Varianten.
- Semantische Zusätze: `--on-accent`, `--track`, `--scrollbar`, `--danger-*`, `--warning-*`, `--info-*`, `--green-border`.
- Fokus: `--focus-ring` aus `--brand-rgb`; `:focus-visible` verwendet einen 3px-Ring mit Offset.
- Dark-Block `:root[data-color-mode="dark"]` mit `color-scheme: dark`; AWO-Akzent wird für dunklen Grund aufgehellt, neutrale Akzente bleiben aus dem Branding.
- Bestehende Komponenten wurden auf Tokens umgestellt; harte Light-Hintergründe in Karten, Topbar, Tabellen, Formularen, Modalen, Empty States, Charts und Leasing-/Kostenstellen-Komponenten wurden ersetzt. Verbleibende harte Weißwerte sind Logo-/Theme-Vorschauflächen.
- `@media print` erzwingt helle Tokens, weißen Hintergrund und schwarzen Text; Farbschema-Umschalter werden ausgeblendet.
- `prefers-reduced-motion` bleibt unverändert.

## 6. UI

- Header: dreiteilige Segmented-Control „Hell / Dunkel / Auto“ mit Icons, `aria-pressed`, Tastaturbedienung und Tooltips.
- Einstellungen → Ihr Konto: gleiche Steuerung mit sichtbaren Labels und Hinweis zu Automatik.
- Einstellungen → Organisation: Standard-Farbschema (Hell/Dunkel/Automatik) für `settings_manage`.
- Umschalten ist optimistisch: sofortige Anwendung, Persistenz per API, Rollback und Fehlermeldung bei Fehler.
- Login bleibt ohne Umschalter und verwendet den globalen Default.

## 7. Tests

**Neu:** `tests/color-mode.test.js` (6 Tests) und `tests/color-mode-api.test.js` (5 Tests).

Abgedeckt:

- Helfer/Validierung: `light`, `dark`, `auto`, `NULL`, ungültige Werte, Default-/Resolved-Fallback.
- Migration 6→7 idempotent, Spalten, Check-Constraints, Default `light`.
- API: eigene Präferenz, fremde User-ID ignoriert, ungültige Modi 400, Default nur mit `settings_manage`, Manager/Viewer-Matrix.
- State/Session: Default, Nutzerpräferenz, `NULL`-Fallback, `auto`, `resolvedColorMode`.
- Rendering: serverseitiges `data-color-mode`, `data-color-mode-preference`, Bootstrap-Script vor Stylesheet, Login-Default.
- Audit: Präferenz nur `colorMode`, Settings mit `defaultColorMode`.
- CSS-Vertrag: Light-/Dark-Tokens, `color-scheme`, Fokusring, Print, zentrale Komponenten ohne alte Light-Hardcodes.
- Kontrast: zentrale Text-/Muted-/Subtle-Tokens Light/Dark ≥ AA sowie AWO-Akzent ≥ 3:1.
- Regression: bestehende 69 Tests (UI/Rollen/Leasing/Kostenstellen/Superadmin) bleiben grün; Gesamtsuite **80/80**.

**UI-Smoke (temporärer Lokalserver, kein Deploy):** Header-Umschalter Hell/Dunkel/Auto, sofortige Dark-Anwendung (`body`, Karten, Inputs), `auto` mit emulierter Systemeinstellung, Login im globalen Dark-Default, Einstellungen-Standardfeld und Dark-Modal geprüft; keine CSP-/Konsolenfehler, keine verbliebenen hellen Hauptflächen.

## 8. Betrieb und Grenzen

- Kein Deploy, kein Merge nach `main`, keine STABLE-Änderung.
- Kein High-Contrast-Modus, keine freien Nutzerfarbschemata, keine Druckoptimierung über das erzwungene helle Schema hinaus.
- `auto` wird clientseitig aufgelöst; serverseitig ist `resolvedColorMode` der Fallback `light`.
- Der globale Default greift für Nutzer ohne explizite Präferenz und für die Loginseite.
- Die Loginseite bietet bewusst keinen Modus-Umschalter.

## 9. QS-Übergabe

Bitte prüfen:

1. Migration v0.8.0 (`user_version = 6`) → 7, Idempotenz, Check-Constraints, Bestandsnutzer `NULL`.
2. Eigene Präferenz, fremde IDs, ungültige Modi, Default-Recht und Audit.
3. Serverseitiges Rendering/Bootstrap/CSP-Hash und kein Flackern.
4. Light/Dark in AWO und neutral, Login, Modale, Tabellen, Charts, Toasts, Druck.
5. Kontrast/Fokus/`prefers-reduced-motion`.
6. Regression der 69 Bestandstests.
