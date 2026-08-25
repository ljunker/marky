# Marky 0.2.0

Marky ist ein fokussierter Markdown-Editor für macOS 26. Die App kombiniert einen Dateibaum, einen Raw-Editor mit Syntaxhervorhebung und eine Live-Vorschau in einem Fenster.

Über der Texteingabe bietet eine kompakte Werkzeugleiste Formatierungen für Fett, Kursiv, Durchgestrichen, Inline-Code, Überschriften, Listen, Aufgabenlisten, Zitate, Links, Bilder und Tabellen. Markierter Text wird direkt mit der passenden Markdown-Syntax umschlossen; `⌘B` und `⌘I` funktionieren zusätzlich als Tastenkürzel.

Version 0.2 ergänzt unbenannte Dokumente mit „Speichern unter“, eine Schnellöffnen-Palette, eine live aktualisierte Gliederung, Text- und Auswahlstatistiken sowie den Import gezogener oder eingefügter Bilder in einen lokalen `assets`-Ordner. Listen werden beim Drücken von Enter intelligent fortgeführt und markierte Texte lassen sich durch Einfügen einer Webadresse direkt verlinken.

## Tastenkürzel

| Kürzel | Aktion |
| --- | --- |
| `⌘N` | Neue Datei |
| `⌘O` | Datei öffnen |
| `⇧⌘O` | Ordner öffnen |
| `⌘P` | Schnell öffnen |
| `⌘S` | Speichern |
| `⇧⌘S` | Speichern unter |
| `⌘F` | Im Dokument suchen |
| `⌘B` | Auswahl fett formatieren |
| `⌘I` | Auswahl kursiv formatieren |

## Entwicklung

Voraussetzungen sind Node.js, Rust und die Xcode Command Line Tools.

```bash
npm install
npm run tauri dev
```

Qualitätsprüfungen:

```bash
npm run check
npm test
cd src-tauri && cargo test && cargo clippy --all-targets --all-features
```

## Lokale macOS-App bauen

```bash
npm run tauri build -- --bundles app
```

Das Bundle liegt anschließend unter `src-tauri/target/release/bundle/macos/Marky.app`. Kopiere es bei Bedarf nach `/Applications` und starte es einmal. Danach wird Marky im Finder für `.md`- und `.markdown`-Dateien unter „Öffnen mit“ angeboten.

Die lokale Version ist nicht mit einer Apple-Developer-ID signiert oder notarisiert.

## GitHub-Release erstellen

Die Release-Version wird ausschließlich unter `package.version` in `src-tauri/Cargo.toml` gepflegt. Nach dem Commit und Push der gewünschten Version lässt sich unter **Actions → macOS-Release erstellen → Run workflow** ein Release manuell starten.

Der Workflow führt die Tests aus, baut `Marky.app` auf macOS 26 für Apple Silicon und erstellt den Tag `v<Version>`. Die App wird als `Marky-<Version>-macos-arm64.zip` an das GitHub-Release angehängt. Existiert der Versions-Tag bereits, bricht der Workflow ab, damit ein vorhandenes Release nicht überschrieben wird.
