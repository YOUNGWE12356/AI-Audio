import argparse
import json
import os
import random
from pathlib import Path


TOOL_DIR = Path(__file__).resolve().parent
os.environ.setdefault("HF_HOME", str(TOOL_DIR / "models"))

# Avoid httpx startup failures when the desktop has an unsupported SOCKS
# proxy configured. HTTP(S) proxies are still allowed for model downloads.
for _proxy_key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
    _proxy_value = os.environ.get(_proxy_key, "").strip().lower()
    if _proxy_value.startswith(("socks://", "socks4://", "socks5://")):
        os.environ.pop(_proxy_key, None)

import numpy as np
import librosa
import perth
import soundfile as sf
import torch

if perth.PerthImplicitWatermarker is None:
    perth.PerthImplicitWatermarker = perth.DummyWatermarker

from chatterbox.mtl_tts import ChatterboxMultilingualTTS


def speaker_similarity(
    model: ChatterboxMultilingualTTS,
    reference: Path,
    output: Path,
    reference_cache: dict[str, np.ndarray],
) -> float | None:
    """Return a diagnostic speaker-embedding cosine score without affecting synthesis."""
    try:
        reference_key = str(reference.resolve())
        if reference_key not in reference_cache:
            reference_audio, _ = librosa.load(reference_key, sr=16000, mono=True)
            reference_cache[reference_key] = np.asarray(
                model.ve.embeds_from_wavs([reference_audio], sample_rate=16000)[0],
                dtype=np.float32,
            )
        reference_embedding = reference_cache[reference_key]
        output_audio, _ = librosa.load(str(output.resolve()), sr=16000, mono=True)
        output_embedding = np.asarray(
            model.ve.embeds_from_wavs([output_audio], sample_rate=16000)[0],
            dtype=np.float32,
        )
        reference_norm = float(np.linalg.norm(reference_embedding))
        output_norm = float(np.linalg.norm(output_embedding))
        if reference_norm <= 1e-8 or output_norm <= 1e-8:
            return None
        score = float(np.dot(reference_embedding, output_embedding) / (reference_norm * output_norm))
        return round(max(-1.0, min(1.0, score)), 4)
    except Exception:
        # Diagnostics must never make an otherwise valid generation fail.
        return None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run local multilingual zero-shot voice cloning.")
    parser.add_argument("--reference", type=Path)
    parser.add_argument("--text")
    parser.add_argument("--language")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--batch-manifest", type=Path)
    parser.add_argument("--model", choices=("v2", "v3"), default="v3")
    parser.add_argument("--exaggeration", type=float, default=0.5)
    parser.add_argument("--cfg-weight", type=float, default=0.3)
    parser.add_argument("--temperature", type=float, default=0.8)
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is required for this local test.")
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
            "model": args.model,
            "exaggeration": args.exaggeration,
            "cfg_weight": args.cfg_weight,
            "temperature": args.temperature,
            "seed": args.seed,
            "diagnostic_similarity": True,
        }]
    if not jobs:
        raise ValueError("Batch manifest contains no jobs.")
    supported = ChatterboxMultilingualTTS.get_supported_languages()
    for job in jobs:
        reference = Path(job["reference"])
        if not reference.is_file():
            raise FileNotFoundError(f"Reference audio not found: {reference}")
        if job["language"] not in supported:
            raise ValueError(f"Unsupported language '{job['language']}'. Supported: {', '.join(supported)}")

    device = torch.device("cuda")
    model = ChatterboxMultilingualTTS.from_pretrained(device=device, t3_model=args.model)
    results = []
    reference_embedding_cache: dict[str, np.ndarray] = {}
    for job in jobs:
        seed = int(job.get("seed", 42))
        reference = Path(job["reference"])
        output = Path(job["output"])
        target_duration = max(0.0, float(job.get("target_duration", 0.0)))
        selected_audio = None
        selected_duration = 0.0
        selected_error = float("inf")
        attempts = 0
        for attempt in range(2):
            attempt_seed = seed + attempt * 104729
            random.seed(attempt_seed)
            np.random.seed(attempt_seed)
            torch.manual_seed(attempt_seed)
            torch.cuda.manual_seed_all(attempt_seed)
            with torch.inference_mode():
                waveform = model.generate(
                    job["text"],
                    language_id=job["language"],
                    audio_prompt_path=str(reference.resolve()),
                    exaggeration=max(0.25, min(2.0, float(job.get("exaggeration", 0.5)))),
                    cfg_weight=max(0.0, min(1.0, float(job.get("cfg_weight", 0.3)))),
                    temperature=max(0.05, min(5.0, float(job.get("temperature", 0.8)))),
                )
            candidate_audio = waveform.detach().float().cpu().squeeze().numpy()
            candidate_duration = len(candidate_audio) / model.sr
            duration_ratio = candidate_duration / target_duration if target_duration > 0 else 1.0
            duration_error = abs(np.log(max(duration_ratio, 1e-6))) if target_duration > 0 else 0.0
            attempts = attempt + 1
            if selected_audio is None or duration_error < selected_error:
                selected_audio = candidate_audio
                selected_duration = candidate_duration
                selected_error = duration_error
            if target_duration <= 0 or 0.6 <= duration_ratio <= 1.65:
                break
        output.parent.mkdir(parents=True, exist_ok=True)
        audio = selected_audio if selected_audio is not None else np.zeros(1, dtype=np.float32)
        peak = float(np.max(np.abs(audio))) if audio.size else 0.0
        if peak > 0.95:
            audio = audio * (0.95 / peak)
        sf.write(output, audio, model.sr, subtype="PCM_16")
        similarity = None
        if bool(job.get("diagnostic_similarity", False)):
            try:
                similarity = speaker_similarity(model, reference, output, reference_embedding_cache)
            except Exception:
                similarity = None
        results.append({
            "id": job.get("id"),
            "output": str(output.resolve()),
            "duration_seconds": round(selected_duration, 3),
            "target_duration_seconds": round(target_duration, 3) if target_duration > 0 else None,
            "attempts": attempts,
            "speaker_similarity": similarity,
        })
    print(json.dumps({
        "output": results[0]["output"],
        "sample_rate": model.sr,
        "duration_seconds": results[0]["duration_seconds"],
        "language": jobs[0]["language"],
        "model": args.model,
        "gpu": torch.cuda.get_device_name(0),
        # Keep the first job's diagnostic at the top level for the single-job API.
        "speaker_similarity": results[0].get("speaker_similarity"),
        "jobs": results,
    }, ensure_ascii=True))


if __name__ == "__main__":
    main()
