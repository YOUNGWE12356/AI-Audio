#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"
PYTHON_BIN="${MUSIC_SEPARATION_BOOTSTRAP_PYTHON:-python3}"
TORCH_INDEX_URL="${TORCH_INDEX_URL:-https://download.pytorch.org/whl/cu124}"
MODEL_SLUG="roformer-model-bs-roformer-sw-by-jarredou"

if [[ ! -x "$VENV_DIR/bin/python" ]]; then
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

"$VENV_DIR/bin/python" -m pip install --upgrade pip setuptools wheel
"$VENV_DIR/bin/python" -m pip install --upgrade \
  "torch==2.6.0+cu124" "torchaudio==2.6.0+cu124" \
  --index-url "$TORCH_INDEX_URL"
"$VENV_DIR/bin/python" -m pip install --upgrade -r "$SCRIPT_DIR/requirements.txt"

mkdir -p "$SCRIPT_DIR/models"
"$VENV_DIR/bin/bs-roformer-download" \
  --model "$MODEL_SLUG" \
  --output-dir "$SCRIPT_DIR/models"

echo "Music separation setup complete. Restart the Node server."

