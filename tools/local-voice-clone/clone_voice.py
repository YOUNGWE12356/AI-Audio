import argparse
import json
import os
import random
from pathlib import Path


TOOL_DIR = Path(__file__).resolve().parent
os.environ.setdefault("HF_HOME", str(TOOL_DIR / "models"))

import numpy as np
import perth
import soundfile as sf
import torch

if perth.PerthImplicitWatermarker is None:
    perth.PerthImplicitWatermarker = perth.DummyWatermarker

from chatterbox.mtl_tts import ChatterboxMultilingualTTS


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
    for job in jobs:
        seed = int(job.get("seed", 42))
        reference = Path(job["reference"])
        output = Path(job["output"])
        random.seed(seed)
        np.random.seed(seed)
        torch.manual_seed(seed)
        torch.cuda.manual_seed_all(seed)
        with torch.inference_mode():
            waveform = model.generate(
                job["text"],
                language_id=job["language"],
                audio_prompt_path=str(reference.resolve()),
                exaggeration=max(0.25, min(2.0, float(job.get("exaggeration", 0.5)))),
                cfg_weight=max(0.0, min(1.0, float(job.get("cfg_weight", 0.3)))),
                temperature=max(0.05, min(5.0, float(job.get("temperature", 0.8)))),
            )
        output.parent.mkdir(parents=True, exist_ok=True)
        audio = waveform.detach().float().cpu().squeeze().numpy()
        peak = float(np.max(np.abs(audio))) if audio.size else 0.0
        if peak > 0.95:
            audio = audio * (0.95 / peak)
        sf.write(output, audio, model.sr, subtype="PCM_16")
        results.append({
            "id": job.get("id"),
            "output": str(output.resolve()),
            "duration_seconds": round(len(audio) / model.sr, 3),
        })
    print(json.dumps({
        "output": results[0]["output"],
        "sample_rate": model.sr,
        "duration_seconds": results[0]["duration_seconds"],
        "language": jobs[0]["language"],
        "model": args.model,
        "gpu": torch.cuda.get_device_name(0),
        "jobs": results,
    }, ensure_ascii=True))


if __name__ == "__main__":
    main()
