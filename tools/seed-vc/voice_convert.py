"""Small server adapter for the official Seed-VC inference scripts.

The adapter intentionally keeps model loading inside the configured Seed-VC
checkout. It does not silently fall back to another voice model.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


for _proxy_key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
    _proxy_value = os.environ.get(_proxy_key, "").strip().lower()
    if _proxy_value.startswith(("socks://", "socks4://", "socks5://")):
        os.environ.pop(_proxy_key, None)


def parse_bool(value: str) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", choices=("v1", "v2"), default="v2")
    parser.add_argument("--repo-dir", default=os.environ.get("SEED_VC_REPO_DIR", "tools/seed-vc/repo"))
    parser.add_argument("--diffusion-steps", type=int, default=25)
    parser.add_argument("--length-adjust", type=float, default=1.0)
    parser.add_argument("--intelligibility-cfg-rate", type=float, default=0.7)
    parser.add_argument("--similarity-cfg-rate", type=float, default=0.7)
    parser.add_argument("--convert-style", action="store_true")
    parser.add_argument("--temperature", type=float, default=0.7)
    parser.add_argument("--top-p", type=float, default=0.9)
    parser.add_argument("--repetition-penalty", type=float, default=1.1)
    args = parser.parse_args()

    repo = Path(args.repo_dir).resolve()
    inference = repo / ("inference_v2.py" if args.model == "v2" else "inference.py")
    if not inference.is_file():
        raise RuntimeError(f"未找到 Seed-VC {args.model} 推理脚本: {inference}")

    output_file = Path(args.output).resolve()
    output_file.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="seed-vc-output-") as output_dir:
        bootstrap = (
            "import runpy, sys; "
            f"sys.path.insert(0, {str(repo)!r}); "
            f"runpy.run_path({str(inference)!r}, run_name='__main__')"
        )
        command = [
            sys.executable,
            "-c", bootstrap,
            "--source", str(Path(args.source).resolve()),
            "--target", str(Path(args.target).resolve()),
            "--output", output_dir,
            "--diffusion-steps", str(args.diffusion_steps),
            "--length-adjust", str(args.length_adjust),
        ]
        if args.model == "v2":
            command += [
                "--intelligibility-cfg-rate", str(args.intelligibility_cfg_rate),
                "--similarity-cfg-rate", str(args.similarity_cfg_rate),
                "--convert-style", str(args.convert_style).lower(),
                "--top-p", str(args.top_p),
                "--temperature", str(args.temperature),
                "--repetition-penalty", str(args.repetition_penalty),
            ]
        else:
            command += [
                "--inference-cfg-rate", str(args.similarity_cfg_rate),
                "--f0-condition", "false",
                "--auto-f0-adjust", "false",
                "--semi-tone-shift", "0",
            ]
        child_env = os.environ.copy()
        child_env["PYTHONPATH"] = str(repo) + os.pathsep + child_env.get("PYTHONPATH", "")
        ffmpeg_dir = Path(__file__).resolve().parents[2] / "node_modules" / "ffmpeg-static"
        child_env["PATH"] = str(ffmpeg_dir) + os.pathsep + child_env.get("PATH", "")
        completed = subprocess.run(command, cwd=repo, env=child_env, check=False, text=True, capture_output=True)
        if completed.returncode != 0:
            detail = (completed.stderr or completed.stdout).strip().splitlines()[-4:]
            raise RuntimeError("Seed-VC 推理失败: " + " ".join(detail))
        candidates = sorted(Path(output_dir).rglob("*.wav"), key=lambda item: item.stat().st_mtime, reverse=True)
        if not candidates:
            raise RuntimeError("Seed-VC 推理完成但没有找到 WAV 输出文件")
        shutil.copyfile(candidates[0], output_file)
        duration = None
        try:
            import soundfile as sf  # type: ignore
            duration = float(sf.info(str(output_file)).duration)
        except Exception:
            pass
        print(json.dumps({"model": f"Seed-VC {args.model.upper()}", "duration_seconds": duration}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
