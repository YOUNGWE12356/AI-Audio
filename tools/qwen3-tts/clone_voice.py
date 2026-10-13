import argparse
import json
import os
import random
from pathlib import Path


TOOL_DIR = Path(__file__).resolve().parent
DEFAULT_MODEL_DIR = TOOL_DIR / "models" / "Qwen3-TTS-12Hz-0.6B-Base"
SUPPORTED_LANGUAGES = {
    "zh": "Chinese",
    "en": "English",
    "ja": "Japanese",
    "ko": "Korean",
    "de": "German",
    "fr": "French",
    "ru": "Russian",
    "pt": "Portuguese",
    "es": "Spanish",
    "it": "Italian",
}

for _proxy_key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
    _proxy_value = os.environ.get(_proxy_key, "").strip().lower()
    if _proxy_value.startswith(("socks://", "socks4://", "socks5://")):
        os.environ.pop(_proxy_key, None)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Qwen3-TTS local voice cloning.")
    parser.add_argument("--reference", type=Path)
    parser.add_argument("--reference-text", default="")
    parser.add_argument("--text")
    parser.add_argument("--language")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--batch-manifest", type=Path)
    parser.add_argument("--model-dir", type=Path, default=DEFAULT_MODEL_DIR)
    parser.add_argument("--temperature", type=float, default=0.9)
    parser.add_argument("--seed", type=int, default=42)
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
            "prompt_text": args.reference_text,
            "text": args.text,
            "language": args.language,
            "output": str(args.output),
            "temperature": args.temperature,
            "seed": args.seed,
            "diagnostic_similarity": True,
        }]
    if not jobs:
        raise ValueError("Batch manifest contains no jobs.")
    if not (args.model_dir / "config.json").is_file():
        raise FileNotFoundError(f"Qwen3-TTS model not found: {args.model_dir}")
    for job in jobs:
        reference = Path(job["reference"])
        if not reference.is_file():
            raise FileNotFoundError(f"Reference audio not found: {reference}")
        if job["language"] not in SUPPORTED_LANGUAGES:
            raise ValueError(f"Unsupported language '{job['language']}'.")

    import librosa
    import numpy as np
    import soundfile as sf
    import torch
    import torch.nn.functional as torch_functional
    from qwen_tts import Qwen3TTSModel

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is required for Qwen3-TTS local inference.")

    model = Qwen3TTSModel.from_pretrained(
        str(args.model_dir.resolve()),
        device_map="cuda:0",
        dtype=torch.bfloat16,
        attn_implementation="sdpa",
    )
    prompt_cache = {}
    results = []

    for job in jobs:
        seed = int(job.get("seed", 42))
        random.seed(seed)
        np.random.seed(seed)
        torch.manual_seed(seed)
        torch.cuda.manual_seed_all(seed)

        reference = Path(job["reference"]).resolve()
        prompt_text = str(job.get("prompt_text", "")).strip()
        prompt_key = (str(reference), prompt_text)
        prompt = prompt_cache.get(prompt_key)
        if prompt is None:
            prompt = model.create_voice_clone_prompt(
                ref_audio=str(reference),
                ref_text=prompt_text or None,
                x_vector_only_mode=not bool(prompt_text),
            )
            prompt_cache[prompt_key] = prompt

        temperature = max(0.3, min(1.4, float(job.get("temperature", 0.9))))
        waveforms, sample_rate = model.generate_voice_clone(
            text=str(job["text"]),
            language=SUPPORTED_LANGUAGES[job["language"]],
            voice_clone_prompt=prompt,
            non_streaming_mode=True,
            temperature=temperature,
            subtalker_temperature=temperature,
        )
        if not waveforms:
            raise RuntimeError(f"Qwen3-TTS returned no audio for job {job.get('id')}.")
        audio = np.asarray(waveforms[0], dtype=np.float32).squeeze()
        if audio.size == 0 or not np.isfinite(audio).all():
            raise RuntimeError(f"Qwen3-TTS returned invalid audio for job {job.get('id')}.")
        peak = float(np.max(np.abs(audio)))
        if peak > 0.95:
            audio = audio * (0.95 / peak)

        output = Path(job["output"])
        output.parent.mkdir(parents=True, exist_ok=True)
        sf.write(output, audio, sample_rate, subtype="PCM_16")

        similarity = None
        if bool(job.get("diagnostic_similarity", False)):
            try:
                encoder_rate = int(model.model.speaker_encoder_sample_rate)
                output_audio, _ = librosa.load(output, sr=encoder_rate, mono=True)
                generated_embedding = model.model.extract_speaker_embedding(
                    audio=output_audio.astype(np.float32),
                    sr=encoder_rate,
                )
                reference_embedding = prompt[0].ref_spk_embedding
                similarity = float(torch_functional.cosine_similarity(
                    reference_embedding.float().reshape(1, -1),
                    generated_embedding.float().reshape(1, -1),
                ).item())
                similarity = round(max(-1.0, min(1.0, similarity)), 4)
            except Exception:
                similarity = None

        results.append({
            "id": job.get("id"),
            "output": str(output.resolve()),
            "duration_seconds": round(len(audio) / sample_rate, 3),
            "target_duration_seconds": round(max(0.0, float(job.get("target_duration", 0.0))), 3),
            "speed": 1.0,
            "temperature": temperature,
            "prompt_mode": "icl" if prompt_text else "speaker_embedding",
            "speaker_similarity": similarity,
        })

    print(json.dumps({
        "output": results[0]["output"],
        "sample_rate": sample_rate,
        "duration_seconds": results[0]["duration_seconds"],
        "language": jobs[0]["language"],
        "model": "Qwen3-TTS-12Hz-0.6B-Base",
        "gpu": torch.cuda.get_device_name(0),
        "speaker_similarity": results[0].get("speaker_similarity"),
        "jobs": results,
    }, ensure_ascii=True))


if __name__ == "__main__":
    main()
