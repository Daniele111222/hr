"""One isolated LibreOffice/UNO execution, never a cached-result fallback."""

import json
import os
import signal
import subprocess
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory


class EngineFailure(ValueError):
    pass


@dataclass(frozen=True)
class EngineResult:
    content: bytes
    version: str


def recalculate(
    content: bytes, *, python_path: str = "/usr/bin/python3", timeout: float = 45
) -> EngineResult:
    with TemporaryDirectory(prefix="paylite-calc-") as directory:
        task = Path(directory)
        (task / "input.xlsx").write_bytes(content)
        environment = {
            "PATH": "/usr/bin:/bin",
            "HOME": directory,
            "TMPDIR": directory,
            "SAL_TMPDIR": directory,
            "OSL_SOCKET_PATH": directory,
            "LANG": "C.UTF-8",
            "PYTHONDONTWRITEBYTECODE": "1",
        }
        try:
            process = subprocess.Popen(
                [python_path, str(Path(__file__).with_name("_uno_worker.py")), directory],
                cwd=directory,
                env=environment,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                start_new_session=True,
            )
        except OSError as exc:
            raise EngineFailure("本机 Excel 引擎不可用，本次没有导入业务数据") from exc
        try:
            process.communicate(timeout=timeout)
        except subprocess.TimeoutExpired as exc:
            os.killpg(process.pid, signal.SIGKILL)
            process.communicate()
            raise EngineFailure("Excel 引擎求值超时，本次没有导入业务数据") from exc
        finally:
            # Includes orphaned Calc descendants after a worker crash.
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        try:
            if process.returncode:
                raise ValueError("worker failed")
            metadata = json.loads((task / "result.json").read_text())
            if not metadata["version"].startswith("LibreOffice 25.2.3.2 "):
                raise ValueError("unverified engine version")
            output = (task / "output.xlsx").read_bytes()
            if not output:
                raise ValueError("missing output")
        except (OSError, ValueError, KeyError) as exc:
            raise EngineFailure("Excel 引擎或隔离环境不可用，本次没有导入业务数据") from exc
        return EngineResult(output, metadata["version"])
