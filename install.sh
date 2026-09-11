#!/usr/bin/env bash
set -Eeuo pipefail

BUILD_DIR="src-tauri/target/release/bundle/macos"

cleanup_terminal() {
    # Scrollbereich auf komplettes Terminal zurücksetzen
    printf '\033[r'
    printf '\033[?25h'
}

trap cleanup_terminal EXIT INT TERM

echo "🔐 Benötige sudo-Rechte für die Installation ..."

if ! sudo -v; then
    echo "❌ Keine sudo-Rechte erhalten."
    exit 1
fi

ROWS="$(tput lines)"

clear

# Sticky Header
printf '\033[1;1H'
printf '🔨 Building...\033[K\n'

# Nur Zeile 2 bis Terminalende darf scrollen
printf '\033[2;%sr' "$ROWS"
printf '\033[2;1H'

# Build ausführen, ohne dass set -e sofort beendet
set +e
npm run tauri build -- --bundles app
BUILD_RESULT=$?
set -e

# Scrollbereich wieder freigeben
printf '\033[r'

# Cursor unter die bisherige Ausgabe setzen
ROWS="$(tput lines)"
printf '\033[%s;1H\n' "$ROWS"

if [[ "$BUILD_RESULT" -ne 0 ]]; then
    echo "❌ Build failed."
    exit "$BUILD_RESULT"
fi

echo "✅ Build complete"

# Gebaute .app suchen
APP_PATH="$(
    find "$BUILD_DIR" \
        -maxdepth 1 \
        -name '*.app' \
        -type d \
        -print \
        -quit
)"

if [[ -z "$APP_PATH" || ! -d "$APP_PATH" ]]; then
    echo "❌ Build war erfolgreich, aber keine .app wurde gefunden."
    exit 1
fi

APP_NAME="$(basename "$APP_PATH")"
TARGET="/Applications/$APP_NAME"

# Bestehende Installation ersetzen
sudo rm -rf "$TARGET"
sudo ditto "$APP_PATH" "$TARGET"

echo "✅ Installed."