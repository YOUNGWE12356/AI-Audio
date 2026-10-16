import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import manage_models as models


class ModelBundleTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.bundle = self.root / "bundle"
        self.bundle.mkdir()
        self.project = self.root / "project"
        self.cache = self.root / "hub"
        original_bundle, original_project = models.BUNDLE, models.PROJECT
        models.BUNDLE, models.PROJECT = self.bundle, self.project
        self.addCleanup(setattr, models, "BUNDLE", original_bundle)
        self.addCleanup(setattr, models, "PROJECT", original_project)

    def fixture(self, path="tools/example/model.pt", root="project", content=b"model-weight"):
        digest = hashlib.sha256(content).hexdigest()
        file = self.bundle / "objects" / digest[:2] / f"{digest}.bin"
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(content)
        entry = {"group": "example", "root": root, "path": path, "bytes": len(content), "sha256": digest}
        (self.bundle / "manifest.json").write_text(json.dumps({"version": 1, "files": [entry]}), encoding="utf-8")
        return entry, file

    def test_restore_reconstructs_exact_files_and_is_repeatable(self):
        entry, _ = self.fixture()
        models.restore(self.project, self.cache)
        target = self.project / entry["path"]
        self.assertEqual(target.read_bytes(), b"model-weight")
        models.restore(self.project, self.cache)
        self.assertEqual(target.read_bytes(), b"model-weight")

    def test_corrupt_objects_and_lfs_pointer_placeholders_fail_before_restore(self):
        _, file = self.fixture()
        file.write_bytes(b"version https://git-lfs.github.com/spec/v1\n")
        with self.assertRaisesRegex(RuntimeError, "missing or corrupt"):
            models.restore(self.project, self.cache)
        self.assertFalse(self.project.exists())

    def test_differing_existing_model_is_not_overwritten(self):
        entry, _ = self.fixture()
        target = self.project / entry["path"]
        target.parent.mkdir(parents=True)
        target.write_bytes(b"my-local-model")
        with self.assertRaisesRegex(RuntimeError, "not overwritten"):
            models.restore(self.project, self.cache)
        self.assertEqual(target.read_bytes(), b"my-local-model")

    def test_traversal_and_absolute_destinations_are_rejected(self):
        for path in ("../outside.pt", "/absolute.pt", "C:/private.pt", "tools\\..\\outside.pt"):
            with self.subTest(path=path):
                self.fixture(path=path)
                with self.assertRaises(ValueError):
                    models.restore(self.project, self.cache)

    def test_shared_model_is_restored_to_explicit_cache_only(self):
        entry, _ = self.fixture(path="models--org--model/refs/main", root="huggingface", content=b"revision")
        models.restore(self.project, self.cache)
        self.assertEqual((self.cache / entry["path"]).read_bytes(), b"revision")
        self.assertFalse(self.project.exists())

    def test_asset_scan_excludes_secrets_download_cache_logs_and_user_audio(self):
        source = self.root / "input"
        for path in ("model.pt", "config.json", ".env", ".cache/model.bin", "output.wav", "download.log", ".agent_harnesses.json"):
            file = source / path
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(b"test")
        self.assertEqual({file.name for file in models.files_in(source)}, {"model.pt", "config.json"})

    def test_chunk_conversion_restores_exact_bytes_and_deduplicates(self):
        entry, _ = self.fixture(content=b"abcdabcdxyz")
        original = models.CHUNK_BYTES
        models.CHUNK_BYTES = 4
        self.addCleanup(setattr, models, "CHUNK_BYTES", original)
        models.chunk_bundle()
        manifest = json.loads((self.bundle / "manifest.json").read_text())
        self.assertEqual(manifest["version"], 2)
        chunks = manifest["files"][0]["chunks"]
        self.assertEqual([part["bytes"] for part in chunks], [4, 4, 3])
        self.assertEqual(chunks[0], chunks[1])
        models.restore(self.project, self.cache)
        self.assertEqual((self.project / entry["path"]).read_bytes(), b"abcdabcdxyz")
        models.chunk_bundle()

    def test_missing_corrupt_or_reordered_chunks_fail_before_restore(self):
        original = models.CHUNK_BYTES
        models.CHUNK_BYTES = 4
        self.addCleanup(setattr, models, "CHUNK_BYTES", original)
        for fault in ("missing", "corrupt", "reordered"):
            with self.subTest(fault=fault):
                self.fixture(content=b"abcd1234xyz")
                models.chunk_bundle()
                manifest_path = self.bundle / "manifest.json"
                manifest = json.loads(manifest_path.read_text())
                chunks = manifest["files"][0]["chunks"]
                if fault == "missing":
                    models.object_path(chunks[0]["sha256"]).unlink()
                elif fault == "corrupt":
                    models.object_path(chunks[0]["sha256"]).write_bytes(b"oops")
                else:
                    chunks.reverse()
                    manifest_path.write_text(json.dumps(manifest))
                with self.assertRaisesRegex(RuntimeError, "missing or corrupt"):
                    models.restore(self.project, self.cache)
                self.assertFalse(self.project.exists())
                # Reset the intentionally corrupted chunk before the next fixture.
                models.object_path(hashlib.sha256(b"abcd").hexdigest()).unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
