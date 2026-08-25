# Marky

Marky ist ein fokussierter Markdown-Editor für macOS 26. Die App kombiniert einen Dateibaum, einen Raw-Editor mit Syntaxhervorhebung und eine Live-Vorschau in einem Fenster.

Über der Texteingabe bietet eine kompakte Werkzeugleiste Formatierungen für Fett, Kursiv, Durchgestrichen, Inline-Code, Überschriften, Listen, Aufgabenlisten, Zitate, Links, Bilder und Tabellen. Markierter Text wird direkt mit der passenden Markdown-Syntax umschlossen; `⌘B` und `⌘I` funktionieren zusätzlich als Tastenkürzel.

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
