"""Deployment orchestration tests; no real Docker/systemd/network calls."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


class DeployTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="ai-audio-deploy-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        project = Path(__file__).resolve().parents[1]
        for name in ("deploy.sh", "docker-deploy.sh", ".env.example"):
            (self.root / name).write_text((project / name).read_text())
        (self.root / ".env").write_text("PORT=3000\n")
        bin_dir = self.root / "bin"
        bin_dir.mkdir()
        mocks = {
            "uname": "echo Linux",
            "node": 'exit "$TEST_NODE_EXIT"',
            "git": 'if [ "$1" = status ]; then printf "%s" "$TEST_DIRTY"; fi',
            "sudo": 'if [ "$1" = -v ]; then exit 0; fi; exec "$@"',
            "flock": "exit 0",
            "systemctl": 'echo "systemctl $*" >> "$TEST_CALLS"; if [ "$1" = is-active ]; then exit "$TEST_SYSTEMD_EXIT"; fi',
            "docker": '''
echo "docker $*" >> "$TEST_CALLS"
case "$1" in
  ps) printf "%s" "$TEST_OLD" ;;
  build) exit "$TEST_BUILD_EXIT" ;;
  inspect)
    case "$3" in
      *Labels*) echo "$TEST_ROOT" ;;
      *Running*) echo true ;;
      *Health*) echo "$TEST_HEALTH" ;;
    esac ;;
esac
''',
        }
        for name, body in mocks.items():
            script = bin_dir / name
            script.write_text("#!/bin/bash\n" + body + "\n")
            script.chmod(0o755)
        self.env = dict(
            os.environ, PATH=f"{bin_dir}:{os.environ['PATH']}",
            TEST_ROOT=str(self.root), TEST_CALLS=str(self.root / "calls"),
            TEST_NODE_EXIT="1", TEST_DIRTY="", TEST_OLD="",
            TEST_BUILD_EXIT="0", TEST_HEALTH="healthy", SKIP_PULL="1",
            TEST_SYSTEMD_EXIT="1",
            DEPLOY_MODE="auto",
        )

    def run_deploy(self, **changes):
        return subprocess.run(
            ["bash", str(self.root / "deploy.sh")],
            env=dict(self.env, **changes), capture_output=True, text=True,
        )

    def calls(self):
        file = self.root / "calls"
        return file.read_text() if file.exists() else ""

    def test_broken_host_node_uses_docker(self):
        result = self.run_deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = self.calls()
        self.assertIn("docker build", calls)
        self.assertIn("-p 4030:4030", calls)
        self.assertIn("/app/.env:ro,Z", calls)
        self.assertIn("/app/data:Z", calls)
        self.assertEqual((self.root / ".env").read_text(), "PORT=3000\n")

    def test_forced_docker_with_working_node(self):
        result = self.run_deploy(TEST_NODE_EXIT="0", DEPLOY_MODE="docker")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_remembers_docker_backend(self):
        (self.root / ".deploy").mkdir()
        (self.root / ".deploy/backend").write_text("docker\n")
        result = self.run_deploy(TEST_NODE_EXIT="0")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("docker build", self.calls())

    def test_missing_env_stops_before_build(self):
        (self.root / ".env").unlink()
        result = self.run_deploy()
        self.assertEqual(result.returncode, 1)
        self.assertTrue((self.root / ".env").exists())
        self.assertNotIn("docker build", self.calls())

    def test_dirty_checkout_stops_before_build(self):
        result = self.run_deploy(SKIP_PULL="0", TEST_DIRTY=" M server.ts")
        self.assertEqual(result.returncode, 1)
        self.assertNotIn("docker build", self.calls())

    def test_build_failure_does_not_stop_previous_container(self):
        result = self.run_deploy(TEST_OLD="previous-id", TEST_BUILD_EXIT="1")
        self.assertEqual(result.returncode, 1)
        self.assertNotIn("docker stop", self.calls())

    def test_failed_health_check_restores_previous_container(self):
        result = self.run_deploy(TEST_OLD="previous-id", TEST_HEALTH="unhealthy")
        self.assertEqual(result.returncode, 1)
        calls = self.calls()
        self.assertIn("docker stop ai-audio", calls)
        self.assertIn("docker rm -f ai-audio", calls)
        self.assertIn("docker start ai-audio", calls)

    def test_failed_health_check_restores_systemd(self):
        result = self.run_deploy(TEST_SYSTEMD_EXIT="0", TEST_HEALTH="unhealthy")
        self.assertEqual(result.returncode, 1)
        self.assertIn("systemctl disable --now ai-audio", self.calls())
        self.assertIn("systemctl enable --now ai-audio", self.calls())


if __name__ == "__main__":
    unittest.main()
