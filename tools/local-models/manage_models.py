"""Package, verify and restore only AI-Audio's installed model assets.

The manifest contains portable paths and SHA-256 checksums, never credentials.
Large objects are managed by Git LFS. Python's standard library is sufficient.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import tempfile

BUNDLE = Path(__file__).resolve().parent
PROJECT = BUNDLE.parents[1]
BLOCKED = {".cache", ".git", ".locks", "__pycache__", "xet", "logs", "trees", ".no_exist"}
EXTENSIONS = {".pt", ".pth", ".ckpt", ".safetensors", ".onnx", ".bin", ".json", ".yaml", ".yml", ".txt", ".md"}
CHUNK_BYTES = 16 * 1024 * 1024


def checksum(file: Path) -> str:
    digest = hashlib.sha256()
    with file.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def below(root: Path, relative: str) -> Path:
    parts = PurePosixPath(relative)
    if parts.is_absolute() or ".." in parts.parts or "\\" in relative or ":" in relative:
        raise ValueError(f"Invalid relative path: {relative}")
    result = root.joinpath(*parts.parts).resolve()
    if not result.is_relative_to(root.resolve()):
        raise ValueError(f"Path escapes its destination: {relative}")
    return result


def hf_cache() -> Path:
    configured = os.environ.get("HF_HUB_CACHE") or os.environ.get("HUGGINGFACE_HUB_CACHE")
    if configured:
        return Path(configured).expanduser()
    return Path(os.environ.get("HF_HOME", str(Path.home() / ".cache" / "huggingface"))) / "hub"


def files_in(directory: Path):
    if not directory.is_dir():
        return
    for file in sorted(directory.rglob("*")):
        relative = file.relative_to(directory)
        if file.is_file() and not any(part in BLOCKED or part.startswith(".") for part in relative.parts):
            if file.suffix.lower() in EXTENSIONS or file.name.startswith(("LICENSE", "NOTICE")):
                yield file


def object_path(digest: str) -> Path:
    if not isinstance(digest, str) or len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
        raise ValueError("Invalid SHA-256 in manifest")
    return BUNDLE / "objects" / digest[:2] / f"{digest}.bin"


def package_file(file: Path) -> dict:
    whole = hashlib.sha256()
    chunks = []
    size = 0
    before = file.stat()
    with file.open("rb") as source:
        while content := source.read(CHUNK_BYTES):
            digest = hashlib.sha256(content).hexdigest()
            destination = object_path(digest)
            destination.parent.mkdir(parents=True, exist_ok=True)
            if destination.exists():
                if destination.stat().st_size != len(content) or checksum(destination) != digest:
                    raise RuntimeError(f"Invalid existing model object: {digest}")
            else:
                with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False, suffix=".partial") as temporary:
                    temporary_path = Path(temporary.name)
                    temporary.write(content)
                try:
                    if checksum(temporary_path) != digest:
                        raise RuntimeError(f"Invalid copied model object: {digest}")
                    temporary_path.replace(destination)
                finally:
                    temporary_path.unlink(missing_ok=True)
            whole.update(content)
            size += len(content)
            chunks.append({"sha256": digest, "bytes": len(content)})
    after = file.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise RuntimeError(f"Source changed while packaging: {file.name}")
    return {"bytes": size, "sha256": whole.hexdigest(), "chunks": chunks}


def save_manifest(manifest: dict) -> None:
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=BUNDLE, delete=False, suffix=".partial") as temporary:
        path = Path(temporary.name)
        json.dump(manifest, temporary, ensure_ascii=False, indent=2)
        temporary.write("\n")
    try:
        path.replace(BUNDLE / "manifest.json")
    finally:
        path.unlink(missing_ok=True)


def build(project: Path, cache: Path) -> None:
    entries = []
    groups = []

    def group(name: str, source: str, selected: list[tuple[Path, str, str]]) -> None:
        if not selected:
            return
        print(f"Packaging {name}: {len(selected)} files", flush=True)
        for file, root, target in selected:
            entries.append({"group": name, "root": root, "path": target, **package_file(file)})
        groups.append({"name": name, "source": source, "files": len(selected)})

    direct = [
        ("CosyVoice3", "tools/cosyvoice/models/Fun-CosyVoice3-0.5B", "https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512"),
        ("Qwen3-TTS", "tools/qwen3-tts/models/Qwen3-TTS-12Hz-0.6B-Base", "https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base"),
        ("BS-RoFormer", "tools/music-separation/models", "https://github.com/nomadkaraoke/python-audio-separator"),
        ("Audio-to-MIDI", "tools/audio-to-midi/models", "https://github.com/mimbres/YourMT3"),
    ]
    for name, relative, source in direct:
        group(name, source, [(file, "project", file.relative_to(project).as_posix()) for file in files_in(project / relative)])

    def cached(name: str, repository: str, base: Path, root: str, prefix: str) -> None:
        ref = base / "refs" / "main"
        if not ref.is_file():
            return
        revision = ref.read_text(encoding="utf-8").strip()
        if len(revision) != 40 or any(c not in "0123456789abcdef" for c in revision):
            raise ValueError(f"Invalid model revision for {name}")
        selected = [(ref, root, f"{prefix}/refs/main")]
        selected.extend((file, root, f"{prefix}/{file.relative_to(base).as_posix()}") for file in files_in(base / "snapshots" / revision))
        group(name, f"https://huggingface.co/{repository}/tree/{revision}", selected)

    chatterbox = "tools/local-voice-clone/models/hub/models--ResembleAI--chatterbox"
    # Only the actual snapshot files, not recursively nested download cache copies.
    base = project / chatterbox
    ref = base / "refs/main"
    if ref.is_file():
        revision = ref.read_text(encoding="utf-8").strip()
        snapshot = base / "snapshots" / revision
        selected = [(ref, "project", f"{chatterbox}/refs/main")]
        allowed = {"ve.pt", "s3gen.pt", "t3_mtl23ls_v2.safetensors", "t3_mtl23ls_v3.safetensors", "conds.pt", "Cangjie5_TC.json", "grapheme_mtl_merged_expanded_v1.json", "README.md", "LICENSE"}
        selected.extend((file, "project", file.relative_to(project).as_posix()) for file in sorted(snapshot.iterdir()) if file.is_file() and file.name in allowed)
        group("Chatterbox", f"https://huggingface.co/ResembleAI/chatterbox/tree/{revision}", selected)

    seed = project / "tools/seed-vc/repo/checkpoints"
    if seed.is_dir():
        for model in sorted(seed.glob("models--*")):
            repository = model.name.removeprefix("models--").replace("--", "/")
            cached(f"Seed-VC: {repository}", repository, model, "project", model.relative_to(project).as_posix())

    # Public dependencies named by Seed-VC and the app's Demucs separation engine.
    for repository in ("facebook/hubert-large-ll60k", "nvidia/bigvgan_v2_22khz_80band_256x", "openai/whisper-small", "adefossez/HTDemucs", "adefossez/HTDemucs-6s"):
        folder = "models--" + repository.replace("/", "--")
        cached(repository, repository, cache / folder, "huggingface", folder)

    basic_pitch = ".venvs/basic-pitch/Lib/site-packages/basic_pitch/saved_models/icassp_2022/nmp.onnx"
    if (project / basic_pitch).is_file():
        group("Basic Pitch ONNX", "https://github.com/spotify/basic-pitch", [(project / basic_pitch, "project", basic_pitch)])

    manifest = {"version": 2, "chunk_bytes": CHUNK_BYTES, "groups": groups, "files": entries}
    save_manifest(manifest)
    print(f"Packaged {len(entries)} files in {len(groups)} model groups.", flush=True)


def verify() -> list[dict]:
    manifest = json.loads((BUNDLE / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("version") not in {1, 2}:
        raise ValueError("Unsupported model manifest version")
    seen = set()
    destinations = set()
    for entry in manifest["files"]:
        digest = entry["sha256"]
        object_path(digest)
        if type(entry["bytes"]) is not int or entry["bytes"] < 0:
            raise ValueError("Invalid model size")
        if entry["root"] not in {"project", "huggingface"}:
            raise ValueError("Unknown destination root")
        below(PROJECT, entry["path"])
        target = (entry["root"], entry["path"])
        if target in destinations:
            raise ValueError(f"Duplicate target: {target}")
        destinations.add(target)
        chunks = entry["chunks"] if manifest["version"] == 2 else [{"sha256": digest, "bytes": entry["bytes"]}]
        whole = hashlib.sha256()
        size = 0
        for chunk in chunks:
            path = object_path(chunk["sha256"])
            if type(chunk["bytes"]) is not int or chunk["bytes"] < 0 or not path.is_file() or path.stat().st_size != chunk["bytes"]:
                raise RuntimeError(f"Model missing or corrupt: {entry['path']}. Run git lfs pull first.")
            part = hashlib.sha256()
            with path.open("rb") as stream:
                for content in iter(lambda: stream.read(8 * 1024 * 1024), b""):
                    whole.update(content)
                    part.update(content)
                    size += len(content)
            if part.hexdigest() != chunk["sha256"]:
                raise RuntimeError(f"Model missing or corrupt: {entry['path']}. Run git lfs pull first.")
            seen.add(chunk["sha256"])
        if size != entry["bytes"] or whole.hexdigest() != digest:
            raise RuntimeError(f"Model missing or corrupt: {entry['path']}. Invalid chunk order or file checksum.")
    print(f"Verified {len(manifest['files'])} files, {len(seen)} unique model objects.", flush=True)
    return manifest["files"]


def chunk_bundle() -> None:
    manifest = json.loads((BUNDLE / "manifest.json").read_text(encoding="utf-8"))
    entries = verify()
    if manifest["version"] == 2:
        return
    for entry in entries:
        print(f"Chunking {entry['group']}: {entry['path']}", flush=True)
        packed = package_file(object_path(entry["sha256"]))
        if packed["sha256"] != entry["sha256"] or packed["bytes"] != entry["bytes"]:
            raise RuntimeError("Model changed while chunking")
        entry.update(packed)
    manifest.update(version=2, chunk_bytes=CHUNK_BYTES, files=entries)
    save_manifest(manifest)
    verify()


def restore(project: Path, cache: Path) -> None:
    entries = verify()
    pending = []
    # Preflight all targets before copying; never overwrite differing local files.
    for entry in entries:
        root = project if entry["root"] == "project" else cache
        target = below(root, entry["path"])
        if target.exists():
            if not target.is_file() or target.stat().st_size != entry["bytes"] or checksum(target) != entry["sha256"]:
                raise RuntimeError(f"Existing file differs; not overwritten: {target}")
        else:
            pending.append((entry, target))
    for entry, target in pending:
        target.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=target.parent, delete=False, suffix=".partial") as output:
            temporary_path = Path(output.name)
            try:
                for chunk in entry.get("chunks", [{"sha256": entry["sha256"]}]):
                    with object_path(chunk["sha256"]).open("rb") as source:
                        shutil.copyfileobj(source, output, 8 * 1024 * 1024)
            except BaseException:
                output.close()
                temporary_path.unlink(missing_ok=True)
                raise
        try:
            if checksum(temporary_path) != entry["sha256"]:
                raise RuntimeError(f"Model changed while restoring: {entry['path']}")
            os.link(temporary_path, target)  # Atomic installation, refuses an existing target.
        finally:
            temporary_path.unlink(missing_ok=True)
    print(f"Restored {len(pending)} missing files; existing matching files preserved.", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("build", "chunk", "verify", "restore"))
    parser.add_argument("--project-root", type=Path, default=PROJECT)
    parser.add_argument("--hf-hub-cache", type=Path, default=hf_cache())
    args = parser.parse_args()
    if args.command == "build":
        build(args.project_root.resolve(), args.hf_hub_cache.resolve())
    elif args.command == "chunk":
        chunk_bundle()
    elif args.command == "verify":
        verify()
    else:
        restore(args.project_root.resolve(), args.hf_hub_cache.resolve())


if __name__ == "__main__":
    main()
