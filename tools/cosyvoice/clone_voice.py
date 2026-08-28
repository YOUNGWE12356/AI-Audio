import argparse
import json
import os
import random
import sys
from pathlib import Path


TOOL_DIR = Path(__file__).resolve().parent
DEFAULT_REPO_DIR = TOOL_DIR / "repo"
DEFAULT_MODEL_DIR = TOOL_DIR / "models" / "Fun-CosyVoice3-0.5B"

for _proxy_key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
    _proxy_value = os.environ.get(_proxy_key, "").strip().lower()
    if _proxy_value.startswith(("socks://", "socks4://", "socks5://")):
        os.environ.pop(_proxy_key, None)

SUPPORTED_LANGUAGES = {"zh", "en", "ja", "ko", "de", "es", "fr", "it", "ru"}
PERFORMANCE_INSTRUCTIONS = {
    "natural": "You are a helpful assistant. 请保持参考音色，自然地朗读。<|endofprompt|>",
    "expressive": "You are a helpful assistant. 请保持参考音色，用富有情绪的语气朗读。<|endofprompt|>",
    "stable": "You are a helpful assistant. 请保持参考音色，用清晰、平稳的语气朗读。<|endofprompt|>",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run CosyVoice 3 cross-language voice cloning.")
    parser.add_argument("--reference", type=Path)
    parser.add_argument("--text")
    parser.add_argument("--language")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--batch-manifest", type=Path)
    parser.add_argument("--performance", choices=tuple(PERFORMANCE_INSTRUCTIONS), default="natural")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--repo-dir", type=Path, default=DEFAULT_REPO_DIR)
    parser.add_argument("--model-dir", type=Path, default=DEFAULT_MODEL_DIR)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.batch_manifest:
        manifest = json.loads(args.batch_manifest.read_text(encoding="utf-8"))
        jobs = manifest.get("jobs", [])
    else:
        if not all((args.reference, args.text, args.language, args.output)):
            raise ValueError("Single generation requires reference, text, language, and output.")
        jobs = [{
            "id": "single",
            "reference": str(args.reference),
            "text": args.text,
            "language": args.language,
            "output": str(args.output),
            "performance": args.performance,
            "seed": args.seed,
        }]
    if not jobs:
        raise ValueError("Batch manifest contains no jobs.")
    for job in jobs:
        reference = Path(job["reference"])
        if not reference.is_file():
            raise FileNotFoundError(f"Reference audio not found: {reference}")
        if job["language"] not in SUPPORTED_LANGUAGES:
            raise ValueError(f"Unsupported language '{job['language']}'.")
    if not (args.repo_dir / "cosyvoice").is_dir():
        raise FileNotFoundError(f"CosyVoice repository not found: {args.repo_dir}")
    if not (args.model_dir / "cosyvoice3.yaml").is_file():
        raise FileNotFoundError(f"CosyVoice 3 model not found: {args.model_dir}")

    repo_dir = str(args.repo_dir.resolve())
    matcha_dir = str((args.repo_dir / "third_party" / "Matcha-TTS").resolve())
    sys.path.insert(0, matcha_dir)
    sys.path.insert(0, repo_dir)
    os.environ.setdefault("PYTHONUTF8", "1")

    import numpy as np
    import soundfile as sf
    import torch
    from cosyvoice.cli.cosyvoice import AutoModel

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is required for CosyVoice 3 local inference.")

    model = AutoModel(model_dir=str(args.model_dir.resolve()), fp16=True)
    results = []
    for job in jobs:
        performance = job.get("performance", "natural")
        seed = int(job.get("seed", 42))
        reference = Path(job["reference"])
        output = Path(job["output"])
        instruction = PERFORMANCE_INSTRUCTIONS[performance]
        prompt_text = str(job.get("prompt_text", "")).strip()

        def infer(speed: float):
            random.seed(seed)
            np.random.seed(seed)
            torch.manual_seed(seed)
            torch.cuda.manual_seed_all(seed)
            with torch.inference_mode():
                if prompt_text:
                    chunks = model.inference_zero_shot(
                        f"You are a helpful assistant.<|endofprompt|>{job['text']}",
                        f"You are a helpful assistant.<|endofprompt|>{prompt_text}",
                        str(reference.resolve()),
                        stream=False,
                        speed=speed,
                    )
                elif performance == "natural" or bool(job.get("event_only")):
                    chunks = model.inference_cross_lingual(
                        f"You are a helpful assistant.<|endofprompt|>{job['text']}",
                        str(reference.resolve()),
                        stream=False,
                        speed=speed,
                    )
                else:
                    chunks = model.inference_instruct2(
                        job["text"],
                        instruction,
                        str(reference.resolve()),
                        stream=False,
                        speed=speed,
                    )
                waveforms = [chunk["tts_speech"].detach().float().cpu() for chunk in chunks]
            if not waveforms:
                raise RuntimeError(f"CosyVoice 3 returned no audio for job {job.get('id')}.")
            return torch.cat(waveforms, dim=-1).squeeze().numpy()

        audio = infer(1.0)
        natural_duration = len(audio) / model.sample_rate
        target_duration = max(0.0, float(job.get("target_duration", 0.0)))
        speed = 1.0
        if target_duration >= 0.35 and natural_duration > 0:
            requested_speed = natural_duration / target_duration
            if abs(requested_speed - 1.0) >= 0.035:
                speed = max(0.92, min(1.08, requested_speed))
                audio = infer(speed)
        if bool(job.get("event_only")) and audio.size:
            fade_samples = min(int(model.sample_rate * 0.12), len(audio) // 4)
            if fade_samples > 1:
                audio[:fade_samples] *= np.linspace(0.0, 1.0, fade_samples, dtype=audio.dtype)
                audio[-fade_samples:] *= np.linspace(1.0, 0.0, fade_samples, dtype=audio.dtype)
        peak = float(np.max(np.abs(audio))) if audio.size else 0.0
        if peak > 0.95:
            audio = audio * (0.95 / peak)
        output.parent.mkdir(parents=True, exist_ok=True)
        sf.write(output, audio, model.sample_rate, subtype="PCM_16")
        results.append({
            "id": job.get("id"),
            "output": str(output.resolve()),
            "duration_seconds": round(len(audio) / model.sample_rate, 3),
            "natural_duration_seconds": round(natural_duration, 3),
            "target_duration_seconds": round(target_duration, 3),
            "speed": round(speed, 4),
            "performance": performance,
        })
    print(json.dumps({
        "output": results[0]["output"],
        "sample_rate": model.sample_rate,
        "duration_seconds": results[0]["duration_seconds"],
        "language": jobs[0]["language"],
        "model": "Fun-CosyVoice3-0.5B-2512",
        "performance": results[0]["performance"],
        "gpu": torch.cuda.get_device_name(0),
        "jobs": results,
    }, ensure_ascii=True))


if __name__ == "__main__":
    main()
