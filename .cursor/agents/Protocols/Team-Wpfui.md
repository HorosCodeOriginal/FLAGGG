# Team-Wpfui – Koordinator-Protokoll

Fuer **forge**, **rail**, **meridian** wenn der Auftrag **WPF UI** (lepoco / `Wpf.Ui*`) betrifft.
HorosAgent-Kern / Werkzeug → weiterhin `Team-Horos.md`.

## Tiefe

- Max. Spawn-Tiefe **2** (Koordinator → Blatt)
- Blaetter: **spark**, **sonar** (und nur diese, sofern nicht anders im Agent erlaubt)
- Nie Koordinatoren untereinander spawnen (`forge`/`rail`/`meridian`/`scalpel` als Spawn-Ziel verboten)
- Spawn-Modell immer `inherit`

## Verantwortung

- Ergebnisse der Blaetter **pruefen**, nicht blind uebernehmen
- Verify selbst: Build/Tests laut `entscheidungen.mdc` und Skill `wpf-ui-coding`
- Multi-TFM und oeffentliche API nicht „nebenbei“ brechen

## Nicht

- HorosAgent-/WTG-Annahmen in die WPF-Library druecken
- Subagent-Kaskaden „zur Sicherheit“
- Commits ohne User-Auftrag
