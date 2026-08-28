#!/usr/bin/env python3
"""Thin adapter around Meta's official SeamlessExpressive inference CLI."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import wave


SUPPORTED_LANGUAGES = {"eng", "spa", "fra", "deu", "cmn", "ita"}

for _proxy_key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
    _proxy_value = os.environ.get(_proxy_key, "").strip().lower()
    if _proxy_value.startswith(("socks://", "socks4://", "socks5://")):
        os.environ.pop(_proxy_key, None)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run SeamlessExpressive speech translation.")
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--target-language", required=True, choices=sorted(SUPPORTED_LANGUAGES))
    parser.add_argument("--duration-factor", type=float, default=1.0)
    parser.add_argument("--repo-dir", required=True, type=Path)
    parser.add_argument("--model-dir", required=True, type=Path)
    return parser.parse_args()


def wav_duration(path: Path) -> float | None:
    try:
        with wave.open(str(path), "rb") as audio:
            return audio.getnframes() / float(audio.getframerate())
    except (OSError, wave.Error, ZeroDivisionError):
        return None


def main() -> None:
    args = parse_args()
    repo_dir = args.repo_dir.resolve()
    input_path = args.input.resolve()
    output_path = args.output.resolve()
    model_dir = args.model_dir.resolve()

    required_paths = [
        input_path,
        repo_dir / "src" / "seamless_communication",
        model_dir / "m2m_expressive_unity.pt",
        model_dir / "pretssel_melhifigan_wm.pt",
    ]
    missing = [str(item) for item in required_paths if not item.exists()]
    if missing:
        raise FileNotFoundError("Missing SeamlessExpressive files: " + ", ".join(missing))
    if not 0.7 <= args.duration_factor <= 1.5:
        raise ValueError("duration-factor must be between 0.7 and 1.5")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    repo_src = str(repo_dir / "src")
    env["PYTHONPATH"] = repo_src + os.pathsep + env.get("PYTHONPATH", "")
    command = [
        sys.executable,
        "-m",
        "seamless_communication.cli.expressivity.predict.predict",
        str(input_path),
        "--task",
        "S2ST",
        "--tgt_lang",
        args.target_language,
        "--model_name",
        "seamless_expressivity",
        "--vocoder_name",
        "vocoder_pretssel",
        "--gated-model-dir",
        str(model_dir),
        "--duration_factor",
        str(args.duration_factor),
        "--text_unk_blocking",
        "True",
        "--output_path",
        str(output_path),
    ]
    completed = subprocess.run(command, env=env, text=True, capture_output=True, check=False)
    combined_output = "\n".join(part for part in (completed.stdout, completed.stderr) if part)
    if completed.returncode != 0:
        tail = " ".join(combined_output.strip().splitlines()[-8:])
        raise RuntimeError(tail or f"Official inference exited with code {completed.returncode}")
    if not output_path.exists() or output_path.stat().st_size == 0:
        raise RuntimeError("Official inference completed without an output audio file")

    translated_match = re.findall(r"Translated text in [^:]+:\s*(.+)", combined_output)
    print(json.dumps({
        "model": "SeamlessExpressive",
        "target_language": args.target_language,
        "duration_factor": args.duration_factor,
        "duration_seconds": wav_duration(output_path),
        "translated_text": translated_match[-1].strip() if translated_match else None,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
