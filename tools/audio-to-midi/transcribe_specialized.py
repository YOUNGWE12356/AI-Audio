from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import sys
import types
from typing import Final

import requests


ROOT = Path(__file__).resolve().parent
TRANSFORMERS_COMPAT_DIR: Final = ROOT / "vendor" / "transformers438"
PIANO_CHECKPOINT_URL: Final = (
    "https://zenodo.org/records/4034264/files/"
    "CRNN_note_F1%3D0.9677_pedal_F1%3D0.9186.pth?download=1"
)
PIANO_CHECKPOINT_BYTES: Final = 171_966_578
PIANO_CHECKPOINT_SHA256: Final = "c3fa9730725bf4a762f1c14bc80cd5986eacda01b026f5a4a2525cd607876141"


def piano_checkpoint_path() -> Path:
    configured = os.environ.get("PIANO_TRANSCRIPTION_CHECKPOINT", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    return ROOT / "models" / "piano" / "note_F1=0.9677_pedal_F1=0.9186.pth"


def file_sha256(file_path: Path) -> str:
    digest = hashlib.sha256()
    with file_path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ensure_piano_checkpoint() -> Path:
    checkpoint_path = piano_checkpoint_path()
    if checkpoint_path.is_file() and checkpoint_path.stat().st_size == PIANO_CHECKPOINT_BYTES:
        return checkpoint_path

    checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = checkpoint_path.with_suffix(f"{checkpoint_path.suffix}.download")
    print(f"Downloading ByteDance piano checkpoint to {checkpoint_path} (~165 MB)...", flush=True)
    try:
        with requests.get(PIANO_CHECKPOINT_URL, stream=True, timeout=(30, 120)) as response:
            response.raise_for_status()
            with temporary_path.open("wb") as checkpoint_file:
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    if chunk:
                        checkpoint_file.write(chunk)

        downloaded_bytes = temporary_path.stat().st_size
        if downloaded_bytes != PIANO_CHECKPOINT_BYTES:
            raise RuntimeError(
                f"Piano checkpoint size mismatch: expected {PIANO_CHECKPOINT_BYTES}, got {downloaded_bytes} bytes"
            )
        digest = file_sha256(temporary_path)
        if digest != PIANO_CHECKPOINT_SHA256:
            raise RuntimeError(f"Piano checkpoint checksum mismatch: {digest}")
        temporary_path.replace(checkpoint_path)
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise

    return checkpoint_path


def select_device() -> str:
    import torch

    return "cuda" if torch.cuda.is_available() else "cpu"


def trim_midi_to_duration(midi_path: Path, duration_seconds: float) -> None:
    import pretty_midi

    midi = pretty_midi.PrettyMIDI(str(midi_path))
    for instrument in midi.instruments:
        instrument.notes = [note for note in instrument.notes if note.start < duration_seconds]
        for note in instrument.notes:
            note.end = min(note.end, duration_seconds)
        instrument.control_changes = [
            event for event in instrument.control_changes if event.time <= duration_seconds
        ]
        instrument.pitch_bends = [
            event for event in instrument.pitch_bends if event.time <= duration_seconds
        ]
    midi.write(str(midi_path))


def transcribe_piano(input_path: Path, output_path: Path) -> str:
    import librosa
    from piano_transcription_inference import PianoTranscription, sample_rate

    audio, _ = librosa.load(input_path, sr=sample_rate, mono=True)
    transcriptor = PianoTranscription(
        device=select_device(),
        checkpoint_path=str(ensure_piano_checkpoint()),
    )
    transcriptor.transcribe(audio, str(output_path))
    trim_midi_to_duration(output_path, len(audio) / sample_rate)
    return "ByteDance Piano Transcription"


def transcribe_drums(input_path: Path, output_path: Path) -> str:
    from adtof_pytorch import transcribe_to_midi

    transcribe_to_midi(input_path, output_path, device=select_device())
    return "ADTOF PyTorch"


def install_yourmt3_transformers_compat() -> None:
    """Restore a legacy import removed by Transformers 5 for vendored YourMT3 code."""
    if not TRANSFORMERS_COMPAT_DIR.is_dir():
        raise RuntimeError(
            "YourMT3 compatibility packages are missing. Run "
            "tools/audio-to-midi/setup-audio-to-midi.ps1 first."
        )
    compat_path = str(TRANSFORMERS_COMPAT_DIR)
    if compat_path not in sys.path:
        sys.path.insert(0, compat_path)

    import torch
    from transformers import pytorch_utils

    module_name = "transformers.utils.model_parallel_utils"
    if module_name not in sys.modules:
        try:
            __import__(module_name)
        except ModuleNotFoundError:
            legacy_utils = types.ModuleType(module_name)
            legacy_utils.assert_device_map = lambda *_args, **_kwargs: None
            legacy_utils.get_device_map = lambda *_args, **_kwargs: {}
            sys.modules[module_name] = legacy_utils

    if not hasattr(pytorch_utils, "find_pruneable_heads_and_indices"):
        def find_pruneable_heads_and_indices(
            heads: list[int],
            n_heads: int,
            head_size: int,
            already_pruned_heads: set[int],
        ) -> tuple[set[int], torch.LongTensor]:
            remaining_heads = set(heads) - already_pruned_heads
            mask = torch.ones(n_heads, head_size)
            for head in remaining_heads:
                adjusted_head = head - sum(1 for pruned in already_pruned_heads if pruned < head)
                mask[adjusted_head] = 0
            index = torch.arange(mask.numel())[mask.view(-1).contiguous().eq(1)].long()
            return remaining_heads, index

        pytorch_utils.find_pruneable_heads_and_indices = find_pruneable_heads_and_indices


def transcribe_multitrack(input_path: Path, output_path: Path) -> str:
    checkpoint_dir = ROOT / "models" / "mt3"
    checkpoint_dir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("MT3_CHECKPOINT_DIR", str(checkpoint_dir))

    install_yourmt3_transformers_compat()

    import librosa
    from mt3_infer import transcribe

    audio, _ = librosa.load(input_path, sr=16000, mono=True)
    midi = transcribe(audio, sr=16000, model="yourmt3", device=select_device())
    midi.save(str(output_path))
    return "YourMT3"


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a configured local audio-to-MIDI engine.")
    parser.add_argument("mode", choices=("piano", "drums", "multitrack", "download-piano"))
    parser.add_argument("input", type=Path, nargs="?")
    parser.add_argument("output", type=Path, nargs="?")
    args = parser.parse_args()

    if args.mode == "download-piano":
        print(ensure_piano_checkpoint())
        return

    if args.input is None or args.output is None:
        parser.error(f"mode {args.mode} requires input and output paths")

    input_path = args.input.resolve()
    output_path = args.output.resolve()
    if not input_path.is_file():
        raise FileNotFoundError(f"Input audio does not exist: {input_path}")
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if args.mode == "piano":
        engine = transcribe_piano(input_path, output_path)
    elif args.mode == "drums":
        engine = transcribe_drums(input_path, output_path)
    else:
        engine = transcribe_multitrack(input_path, output_path)

    if not output_path.is_file() or output_path.stat().st_size <= 0:
        raise RuntimeError(f"{engine} did not create a MIDI file")
    print(f"{engine}: {output_path}")


if __name__ == "__main__":
    main()
