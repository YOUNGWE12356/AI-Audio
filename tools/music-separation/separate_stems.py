#!/usr/bin/env python3
"""Run one checksum-verified BS-RoFormer 6-stem separation job."""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path


MODEL_SLUG = "roformer-model-bs-roformer-sw-by-jarredou"
STEM_ORDER = ("vocals", "drums", "bass", "guitar", "piano", "other")
STEM_LABELS = {
    "vocals": "人声",
    "drums": "鼓",
    "bass": "贝斯",
    "guitar": "吉他",
    "piano": "钢琴",
    "other": "其他乐器",
}
EVENT_PREFIX = "__MUSIC_SEPARATION__"
WAVEFORM_POINTS = 96


def emit(event_type: str, **payload: object) -> None:
    print(
        EVENT_PREFIX + json.dumps({"type": event_type, **payload}, ensure_ascii=False),
        flush=True,
    )


def audio_metrics(file_path: Path) -> dict[str, object]:
    import numpy as np
    import soundfile as sf

    info = sf.info(file_path)
    sum_squares = 0.0
    peak = 0.0
    sample_count = 0
    frame_offset = 0
    waveform = np.zeros(WAVEFORM_POINTS, dtype=np.float32)
    total_frames = max(1, int(info.frames))
    with sf.SoundFile(file_path) as source:
        for block in source.blocks(blocksize=262_144, dtype="float32", always_2d=True):
            absolute = np.abs(block)
            peak = max(peak, float(np.max(absolute, initial=0.0)))
            sum_squares += float(np.sum(np.square(block, dtype=np.float64)))
            sample_count += int(block.size)
            block_end = frame_offset + len(block)
            first_point = min(WAVEFORM_POINTS - 1, (frame_offset * WAVEFORM_POINTS) // total_frames)
            last_point = min(WAVEFORM_POINTS - 1, (max(frame_offset, block_end - 1) * WAVEFORM_POINTS) // total_frames)
            for point_index in range(first_point, last_point + 1):
                point_start = (point_index * total_frames) // WAVEFORM_POINTS
                point_end = max(point_start + 1, ((point_index + 1) * total_frames) // WAVEFORM_POINTS)
                local_start = max(0, point_start - frame_offset)
                local_end = min(len(block), point_end - frame_offset)
                if local_end > local_start:
                    waveform[point_index] = max(
                        waveform[point_index],
                        float(np.max(absolute[local_start:local_end], initial=0.0)),
                    )
            frame_offset = block_end
    rms = math.sqrt(sum_squares / sample_count) if sample_count else 0.0
    rms_db = 20.0 * math.log10(max(rms, 1e-12))
    peak_db = 20.0 * math.log10(max(peak, 1e-12))
    return {
        "duration": float(info.duration),
        "sampleRate": float(info.samplerate),
        "rmsDb": rms_db,
        "peakDb": peak_db,
        "waveform": [round(float(value), 6) for value in waveform],
    }


def enforce_mix_consistency(input_file: Path, stem_paths: list[Path]) -> None:
    """Project the stems back onto the original mixture, block by block."""
    import numpy as np
    import soundfile as sf

    temporary_paths = [path.with_name(f"{path.stem}.consistent.wav") for path in stem_paths]
    try:
        with sf.SoundFile(input_file) as mixture_source:
            stem_sources = [sf.SoundFile(path) for path in stem_paths]
            stem_outputs = [
                sf.SoundFile(
                    temporary,
                    mode="w",
                    samplerate=mixture_source.samplerate,
                    channels=mixture_source.channels,
                    subtype="FLOAT",
                )
                for temporary in temporary_paths
            ]
            try:
                while True:
                    mixture = mixture_source.read(262_144, dtype="float32", always_2d=True)
                    if mixture.size == 0:
                        break
                    stem_blocks = [
                        source.read(len(mixture), dtype="float32", always_2d=True)
                        for source in stem_sources
                    ]
                    if any(block.shape != mixture.shape for block in stem_blocks):
                        raise RuntimeError("输出轨道采样长度不一致，无法执行混合一致性校正。")
                    stacked = np.stack(stem_blocks, axis=0)
                    residual = mixture - np.sum(stacked, axis=0)
                    magnitudes = np.abs(stacked)
                    denominator = np.sum(magnitudes, axis=0, keepdims=True)
                    weights = np.full_like(stacked, 1.0 / len(stem_paths))
                    np.divide(magnitudes, denominator, out=weights, where=denominator > 1e-8)
                    corrected = stacked + weights * residual
                    for output, block in zip(stem_outputs, corrected, strict=True):
                        output.write(block)
            finally:
                for source in stem_sources:
                    source.close()
                for output in stem_outputs:
                    output.close()
        for source, temporary in zip(stem_paths, temporary_paths, strict=True):
            temporary.replace(source)
    finally:
        for temporary in temporary_paths:
            temporary.unlink(missing_ok=True)


def run_probe(models_dir: Path) -> int:
    try:
        import torch
        from bs_roformer import __version__, ensure_model_assets

        model_cached = False
        checkpoint_path = ""
        try:
            checkpoint, _config = ensure_model_assets(
                MODEL_SLUG,
                models_dir=models_dir,
                download_missing=False,
            )
            model_cached = checkpoint.is_file()
            checkpoint_path = str(checkpoint)
        except FileNotFoundError:
            pass

        cuda_available = bool(torch.cuda.is_available())
        emit(
            "probe",
            installed=True,
            cudaAvailable=cuda_available,
            modelCached=model_cached,
            ready=cuda_available and model_cached,
            packageVersion=__version__,
            torchVersion=torch.__version__,
            cudaVersion=torch.version.cuda,
            gpuName=torch.cuda.get_device_name(0) if cuda_available else None,
            checkpointPath=checkpoint_path or None,
        )
        return 0
    except Exception as error:  # Probe must always return actionable JSON.
        emit(
            "probe",
            installed=False,
            cudaAvailable=False,
            modelCached=False,
            ready=False,
            error=str(error),
        )
        return 1


def run_separation(input_file: Path, output_dir: Path, models_dir: Path) -> int:
    import soundfile as sf
    import torch
    from bs_roformer import ensure_model_assets
    from bs_roformer.inference import proc_folder

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA 不可用。请运行本地分轨安装脚本并确认 NVIDIA 驱动正常。")

    ensure_model_assets(MODEL_SLUG, models_dir=models_dir, download_missing=False)
    output_dir.mkdir(parents=True, exist_ok=True)
    emit("stage", stage="loading-model", progress=12, message="正在加载高质量 6 轨模型")
    emit("stage", stage="separating", progress=24, message="正在进行高质量频谱分轨")

    proc_folder(
        [
            "--model",
            MODEL_SLUG,
            "--models_dir",
            str(models_dir),
            "--input_folder",
            str(input_file.parent),
            "--store_dir",
            str(output_dir),
            "--device",
            "cuda:0",
        ]
    )

    emit("stage", stage="analyzing", progress=88, message="正在检查轨道内容与时间对齐")
    mix_info = sf.info(input_file)
    mix_metrics = audio_metrics(input_file)
    minimum_rms_db = max(-70.0, mix_metrics["rmsDb"] - 45.0)
    audible_stems: list[tuple[str, Path]] = []

    for stem_id in STEM_ORDER:
        stem_path = output_dir / f"{input_file.stem}_{stem_id}.wav"
        if not stem_path.is_file():
            continue
        metrics = audio_metrics(stem_path)
        has_content = metrics["rmsDb"] >= minimum_rms_db or metrics["peakDb"] >= -48.0
        if not has_content:
            stem_path.unlink(missing_ok=True)
            continue
        audible_stems.append((stem_id, stem_path))

    instrumental_path = output_dir / f"{input_file.stem}_instrumental.wav"
    instrumental_path.unlink(missing_ok=True)
    if not audible_stems:
        raise RuntimeError("模型没有生成可用的非静音轨道，请检查输入文件是否包含音乐。")

    emit("stage", stage="analyzing", progress=91, message="正在执行混合一致性校正")
    enforce_mix_consistency(input_file, [stem_path for _stem_id, stem_path in audible_stems])

    stems: list[dict[str, object]] = []
    for stem_id, stem_path in audible_stems:
        metrics = audio_metrics(stem_path)
        stems.append(
            {
                "id": stem_id,
                "name": STEM_LABELS[stem_id],
                "filePath": str(stem_path),
                "duration": metrics["duration"],
                "sampleRate": int(metrics["sampleRate"]),
                "rmsDb": round(metrics["rmsDb"], 2),
                "peakDb": round(metrics["peakDb"], 2),
                "waveform": metrics["waveform"],
                "size": stem_path.stat().st_size,
            }
        )

    max_duration_error = max(abs(float(stem["duration"]) - mix_info.duration) for stem in stems)
    if max_duration_error > 0.05:
        raise RuntimeError("输出轨道与原曲时间长度不一致，已停止交付以避免错位。")

    emit(
        "result",
        progress=100,
        duration=float(mix_info.duration),
        sampleRate=int(mix_info.samplerate),
        stems=stems,
    )
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="High-quality local music separation runner")
    parser.add_argument("--probe", action="store_true")
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--models-dir", type=Path, required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.probe:
        return run_probe(args.models_dir.resolve())
    if args.input is None or args.output_dir is None:
        raise ValueError("--input and --output-dir are required for separation")
    return run_separation(args.input.resolve(), args.output_dir.resolve(), args.models_dir.resolve())


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as error:
        emit("error", message=str(error), errorType=type(error).__name__)
        raise SystemExit(1)
