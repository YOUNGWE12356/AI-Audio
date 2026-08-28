# SeamlessExpressive local runtime

This directory connects AI Audio to Meta's official SeamlessExpressive speech-to-speech translation implementation.

## Restrictions

- The gated model files require approval from Meta and Hugging Face.
- The Seamless model license permits noncommercial research use only.
- The official `fairseq2` binary runtime supports Linux x86-64 and Apple Silicon, not native Windows.
- On this Windows workstation, run the whole AI Audio server inside WSL 2 after installing a Linux distribution and NVIDIA CUDA support.

## Required model files

After approval, place these files in `tools/seamless-expressive/models/`:

```text
m2m_expressive_unity.pt
pretssel_melhifigan_wm-final.pt
```

The optional 16 kHz vocoder file is `pretssel_melhifigan_wm-16khz.pt`.

## Linux / WSL setup

Use Python 3.10 in Linux. From the project root:

```bash
git clone --depth 1 https://github.com/facebookresearch/seamless_communication.git tools/seamless-expressive/repo
python3.10 -m venv tools/seamless-expressive/.venv
source tools/seamless-expressive/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e tools/seamless-expressive/repo
```

If the runtime or model locations differ, configure:

```text
SEAMLESS_EXPRESSIVE_PYTHON
SEAMLESS_EXPRESSIVE_SCRIPT
SEAMLESS_EXPRESSIVE_REPO_DIR
SEAMLESS_EXPRESSIVE_MODEL_DIR
```

The application status endpoint validates the platform, Python environment, repository, CUDA runtime, and both required gated checkpoints before enabling conversion. The Windows Node server can stay on Windows; once WSL 2 is installed, it invokes the Linux venv through `wsl.exe` and shares the project files through `/mnt/<drive>/...`.
