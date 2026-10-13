# Qwen3-TTS local voice cloning

This adapter adds `Qwen/Qwen3-TTS-12Hz-0.6B-Base` as an optional third local
voice-cloning engine. It keeps the Qwen Python dependencies isolated from the
existing Chatterbox and CosyVoice runtimes.

The default runtime is `tools/qwen3-tts/.venv` and the default model directory
is `tools/qwen3-tts/models/Qwen3-TTS-12Hz-0.6B-Base`.

The adapter accepts either a single job or the same JSON batch manifest used by
the app's timeline renderer. When an exact reference transcript is supplied it
uses Qwen's ICL prompt; otherwise it falls back to speaker-embedding-only mode.

Supported target languages: Chinese, English, Japanese, Korean, German,
French, Russian, Portuguese, Spanish, and Italian.

Qwen3-TTS and the adapter are licensed under Apache-2.0. Model files are not
committed to this repository.
