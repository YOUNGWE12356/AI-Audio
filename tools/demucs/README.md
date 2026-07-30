# Local/server Demucs separation

The video soundtrack splitter can use Demucs for real server-side stem separation. Users do not need Demucs installed on their own computers when this app is deployed to a server; only the server needs the environment.

## Automatic venv paths

The Node server auto-detects these project-local Python environments:

```text
tools/demucs/.venv/Scripts/python.exe  # Windows
tools/demucs/.venv/bin/python          # Linux/macOS
```

## One-command setup

Windows:

```powershell
powershell -ExecutionPolicy Bypass -File tools/demucs/setup-demucs.ps1
```

Linux server:

```bash
bash tools/demucs/setup-demucs.sh
```

The scripts install CPU PyTorch by default. For a CUDA server, set `TORCH_INDEX_URL` on Linux or pass `-TorchIndexUrl` on Windows using the PyTorch wheel index that matches the server GPU/CUDA stack.

## Optional environment variables

```text
DEMUCS_PYTHON=/absolute/path/to/python
DEMUCS_COMMAND="/absolute/path/to/python -m demucs"
DEMUCS_MODEL=htdemucs
DEMUCS_TIMEOUT_MS=1200000
```

`DEMUCS_PYTHON` and `DEMUCS_COMMAND` override auto-detection. `DEMUCS_MODEL` defaults to `htdemucs`. `DEMUCS_TIMEOUT_MS` defaults to 20 minutes.

## Deployment check

After restarting the Node server, open:

```text
/api/video/separation-engines
```

If Demucs is ready, it returns `preferred: "demucs-local"`. If not, the app continues to use the FFmpeg fallback so splitting remains playable.
