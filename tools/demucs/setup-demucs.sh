#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${SCRIPT_DIR}/.venv"
VENV_PYTHON="${VENV_DIR}/bin/python"
TORCH_INDEX_URL="${TORCH_INDEX_URL:-https://download.pytorch.org/whl/cpu}"
PYTHON_BIN="${PYTHON_BIN:-}"

if [[ -z "${PYTHON_BIN}" ]]; then
  if command -v python3.11 >/dev/null 2>&1; then
    PYTHON_BIN="python3.11"
  elif command -v python3.10 >/dev/null 2>&1; then
    PYTHON_BIN="python3.10"
  elif command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="python3"
  else
    echo "Python 3.10/3.11 was not found. Install Python 3.11 first, or set PYTHON_BIN." >&2
    exit 1
  fi
fi

if [[ ! -x "${VENV_PYTHON}" ]]; then
  echo "Creating Demucs virtual environment at ${VENV_DIR}"
  "${PYTHON_BIN}" -m venv "${VENV_DIR}"
fi

echo "Upgrading pip"
"${VENV_PYTHON}" -m pip install --upgrade pip setuptools wheel

echo "Installing PyTorch / torchaudio"
"${VENV_PYTHON}" -m pip install --upgrade torch torchaudio --index-url "${TORCH_INDEX_URL}"

echo "Installing Demucs"
"${VENV_PYTHON}" -m pip install --upgrade demucs

echo ""
echo "Demucs setup complete."
echo "Restart the Node server. It will auto-detect:"
echo "${VENV_PYTHON}"
