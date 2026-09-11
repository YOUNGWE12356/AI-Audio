# High-quality local music separation

This isolated runtime powers the `Audio Tools > High Quality Music Separation` page. It uses the recommended BS-RoFormer-SW checkpoint and produces six aligned float32 WAV stems:

- vocals
- drums
- bass
- guitar
- piano
- other

The application intentionally does not expose a two-stem or reduced-quality mode. GPU jobs are queued and executed one at a time so the model fits reliably on a 12 GB RTX 3060.

## Windows setup

```powershell
powershell -ExecutionPolicy Bypass -File tools/music-separation/setup-music-separation.ps1
```

The setup installs CUDA 12.4 PyTorch into `tools/music-separation/.venv` and downloads the checksum-verified model into `tools/music-separation/models`. Both directories are ignored by Git.

## Linux setup

```bash
bash tools/music-separation/setup-music-separation.sh
```

Override `TORCH_INDEX_URL` when the deployment GPU requires a different official PyTorch wheel index.

## Optional environment variables

```text
MUSIC_SEPARATION_PYTHON=/absolute/path/to/python
MUSIC_SEPARATION_SCRIPT=/absolute/path/to/separate_stems.py
MUSIC_SEPARATION_MODELS_DIR=/absolute/path/to/models
MUSIC_SEPARATION_TIMEOUT_MS=7200000
```

The server health endpoint reports installation, CUDA, checkpoint cache, and readiness separately. It never substitutes an FFmpeg approximation when the model is unavailable.

