#!/bin/bash
# start-astra.command — startet die DeepSeek-Harness-Desktop-App mit dem Astra-Profil.
# Doppelklick im Finder (oder: bash mac-setup/start-astra.command)
# Voraussetzungen: ~/.dsh/profiles/astra existiert, ASTRA_API_KEY in ~/.dsh/.credentials.yaml,
# fr-gateway (Docker) + Dienste laufen (siehe mac-setup/README.md).
set -euo pipefail

PROFILE_NAME="astra"
APP_PATH="${DSH_APP_PATH:-/Applications/DeepSeek Harness.app}"
PROFILE_DIR="$HOME/.dsh/profiles/$PROFILE_NAME"
USER_DATA_DIR="$HOME/Library/Application Support/Dsh-$PROFILE_NAME"

if [ ! -d "$PROFILE_DIR" ]; then
  echo "FEHLER: Profil '$PROFILE_DIR' fehlt. Erst ausführen:"
  echo "  cp -R mac-setup/profiles/astra ~/.dsh/profiles/astra"
  exit 1
fi

if [ ! -d "$APP_PATH" ]; then
  echo "FEHLER: DeepSeek Harness App nicht gefunden unter '$APP_PATH'."
  echo "Setze DSH_APP_PATH auf den App-Pfad, z.B.:"
  echo "  DSH_APP_PATH=\"/Applications/DeepSeek Harness.app\" bash mac-setup/start-astra.command"
  exit 1
fi

export DSH_PROFILE="$PROFILE_NAME"
export DSH_PROFILE_DIR="$PROFILE_DIR"

echo "Starte Astra-Harness (Profil=$PROFILE_NAME, App=$APP_PATH)"
open "$APP_PATH" --args --user-data-dir="$USER_DATA_DIR"
