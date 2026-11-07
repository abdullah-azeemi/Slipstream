"""Run model-written Python in an isolated container.

The model never gets a shell, the network, secrets or the database: it only
sees files the loaders staged into a per-run workspace. The Sandbox protocol
is the seam where a production runner (e.g. Fly Machines) plugs in.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
import uuid
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Protocol

IMAGE = "pitwall-sandbox"
MAX_OUTPUT_CHARS = 6000
_F1LAB_SRC = Path(__file__).resolve().parents[1] / "f1lab"
_LIB_SRC = Path(__file__).parent / "sandbox_lib"
# data.py needs SQLAlchemy and the database: never ship it into the sandbox
_F1LAB_EXCLUDE = {"data.py", "__pycache__"}


@dataclass(frozen=True)
class SandboxResult:
    ok: bool
    stdout: str
    stderr: str
    duration_s: float
    timed_out: bool = False
    charts: list[dict] = field(default_factory=list)
    files: list[str] = field(default_factory=list)


class Sandbox(Protocol):
    def run(
        self, code: str, workspace: "Workspace", *, timeout_s: int = 20
    ) -> SandboxResult: ...


class Workspace:
    """Per-run directory: data/ (loaders write it, scripts may add files), out/ (charts)."""

    def __init__(self, root: Path | None = None) -> None:
        self.root = root or Path(tempfile.mkdtemp(prefix="pitwall-run-"))
        self.data = self.root / "data"
        self.out = self.root / "out"
        self.code = self.root / "code"
        for d in (self.data, self.out, self.code):
            d.mkdir(parents=True, exist_ok=True)
        # the container runs as an unprivileged user and may save intermediate files in data/
        self.out.chmod(0o777)
        self.data.chmod(0o777)

    def write_json(self, name: str, obj: object) -> Path:
        import json

        if "/" in name or name.startswith("."):
            raise ValueError(f"bad data file name: {name!r}")
        path = self.data / name
        path.write_text(json.dumps(obj, default=str))
        return path

    def data_files(self) -> list[str]:
        return sorted(p.name for p in self.data.iterdir())

    def cleanup(self) -> None:
        shutil.rmtree(self.root, ignore_errors=True)


@lru_cache(maxsize=1)
def _lib_dir() -> Path:
    """Build the read-only lib mounted at /pylib: pitwall.py + f1lab (no DB code)."""
    lib = Path(tempfile.mkdtemp(prefix="pitwall-lib-"))
    shutil.copy(_LIB_SRC / "pitwall.py", lib / "pitwall.py")
    pkg = lib / "backend"
    pkg.mkdir()
    (pkg / "__init__.py").write_text("")  # stub: the real one imports Flask
    shutil.copytree(
        _F1LAB_SRC, pkg / "f1lab", ignore=shutil.ignore_patterns(*_F1LAB_EXCLUDE)
    )
    return lib


def _clip(text: str) -> str:
    if len(text) <= MAX_OUTPUT_CHARS:
        return text
    return (
        text[:MAX_OUTPUT_CHARS]
        + f"\n... [truncated {len(text) - MAX_OUTPUT_CHARS} chars]"
    )


class DockerSandbox:
    def __init__(
        self, image: str = IMAGE, memory: str = "512m", cpus: str = "1"
    ) -> None:
        self.image = image
        self.memory = memory
        self.cpus = cpus

    @staticmethod
    def available(image: str = IMAGE) -> bool:
        """True when docker is reachable and the sandbox image exists."""
        try:
            done = subprocess.run(
                ["docker", "image", "inspect", image],
                capture_output=True,
                timeout=10,
            )
            return done.returncode == 0
        except (OSError, subprocess.SubprocessError):
            return False

    def run(
        self, code: str, workspace: Workspace, *, timeout_s: int = 20
    ) -> SandboxResult:
        script = workspace.code / f"run_{uuid.uuid4().hex[:8]}.py"
        script.write_text("from pitwall import *\n" + code)
        name = f"pw-sandbox-{uuid.uuid4().hex[:10]}"
        cmd = [
            "docker", "run", "--rm", "--name", name,
            "--network", "none",
            "--memory", self.memory, "--cpus", self.cpus, "--pids-limit", "128",
            "--read-only", "--tmpfs", "/tmp:size=64m",
            "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
            "--user", "65534:65534",
            "-v", f"{workspace.data}:/data",
            "-v", f"{workspace.out}:/out",
            "-v", f"{script.parent}:/code:ro",
            "-v", f"{_lib_dir()}:/pylib:ro",
            "-e", "PYTHONPATH=/pylib",
            "-w", "/data",
            self.image, "python", f"/code/{script.name}",
        ]  # fmt: skip
        import time

        started = time.perf_counter()
        before = set(workspace.out.iterdir())
        try:
            done = subprocess.run(
                cmd, capture_output=True, text=True, timeout=timeout_s
            )
            timed_out, stdout, stderr, ok = (
                False,
                done.stdout,
                done.stderr,
                done.returncode == 0,
            )
        except subprocess.TimeoutExpired as exc:
            subprocess.run(["docker", "kill", name], capture_output=True)
            timed_out, ok = True, False
            stdout = (
                (exc.stdout or b"").decode()
                if isinstance(exc.stdout, bytes)
                else (exc.stdout or "")
            )
            stderr = f"timed out after {timeout_s}s"
        duration = round(time.perf_counter() - started, 2)

        charts, files = [], []
        for path in sorted(set(workspace.out.iterdir()) - before):
            if path.name.startswith("chart_") and path.suffix == ".json":
                import json

                try:
                    charts.append(json.loads(path.read_text()))
                except ValueError:
                    pass
            else:
                files.append(path.name)
        return SandboxResult(
            ok, _clip(stdout), _clip(stderr), duration, timed_out, charts, files
        )
