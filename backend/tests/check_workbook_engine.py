"""Run explicitly inside the pinned deployment runtime, using synthetic data only."""

import json
import os
import subprocess
from datetime import date
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from xml.etree import ElementTree
from zipfile import ZIP_DEFLATED, ZipFile

from openpyxl import load_workbook
from openpyxl.worksheet.formula import ArrayFormula

from paylite.excel.engine import recalculate
from paylite.excel.workbook_import import parse_workbook, prepare_evaluation
from workbook_fixture import source_workbook


def with_stale_cache(content: bytes) -> bytes:
    output = BytesIO()
    ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    with ZipFile(BytesIO(content)) as source, ZipFile(output, "w", ZIP_DEFLATED) as target:
        for info in source.infolist():
            value = source.read(info)
            if info.filename.startswith("xl/worksheets/"):
                root = ElementTree.fromstring(value)
                for cell in root.iter(f"{ns}c"):
                    if cell.attrib.get("r") == "T3" and cell.find(f"{ns}f") is not None:
                        cell.find(f"{ns}v").text = "999"
                value = ElementTree.tostring(root)
            target.writestr(info, value)
    return output.getvalue()


def check_recalculation():
    parsed = parse_workbook(source_workbook(), date(2026, 8, 1))
    calendar = parsed.workbook.create_sheet("法定假日列表")
    calendar["B2"] = date(2026, 8, 12)
    calendar["F2"] = date(2026, 8, 15)
    parsed.populated_cells[calendar.title] = {"B2", "F2"}
    attendance = parsed.workbook["考勤表"]
    attendance["R3"] = ArrayFormula(
        "R3",
        '=_xlfn.IFS(A3<>"",NETWORKDAYS(Q1,P1,法定假日列表!B2:B31)+COUNTIFS(法定假日列表!F2:F7,">="&Q1,法定假日列表!F2:F7,"<="&P1),TRUE,0)',
    )
    attendance["T3"] = "=R3"
    parsed.populated_cells["考勤表"].add("R3")
    plan = prepare_evaluation(parsed)
    assert not plan.errors
    for stale in (False, True):
        result = recalculate(with_stale_cache(plan.content) if stale else plan.content)
        output = load_workbook(BytesIO(result.content), data_only=True)
        assert output["考勤表"]["T3"].value == 21, output["考勤表"]["T3"].value
        assert output["考勤表"]["A3"].value == "11010120000101002X"
        assert output["考勤表"]["B3"].value == "合成员工"
        assert output["考勤表"]["C3"].value == "北京合成有限公司"
        assert output["花名册"]["O2"].value.date() == date(2026, 11, 12)
        assert output["花名册"]["R2"].value == "000123456789012345"
    calendar["B3"] = date(2026, 8, 13)
    parsed.populated_cells[calendar.title].add("B3")
    parsed.workbook["花名册"]["C2"] = "修正合成员工"
    changed = recalculate(prepare_evaluation(parsed).content)
    output = load_workbook(BytesIO(changed.content), data_only=True)
    assert output["考勤表"]["T3"].value == 20
    assert output["考勤表"]["B3"].value == "修正合成员工"
    helper = parsed.workbook.create_sheet("辅助")
    helper["B2"] = "11010120000101002X"
    helper["A2"], helper["A3"] = 10, 21
    parsed.populated_cells[helper.title] = {"B2", "A2", "A3"}
    attendance["T3"] = "=INDEX(辅助!A:A,MATCH(A3,辅助!B:B,0)+1)"
    expression = recalculate(prepare_evaluation(parsed).content)
    assert load_workbook(BytesIO(expression.content), data_only=True)["考勤表"]["T3"].value == 21
    print(json.dumps({"fresh": 21, "stale_999": 21, "changed": 20, "version": changed.version}))


def check_sandbox():
    with TemporaryDirectory(prefix="paylite-check-") as directory:
        task = Path(directory)
        outside = Path("/tmp/paylite-engine-denied.txt")
        outside.write_text("synthetic secret")
        outside.chmod(0o644)
        try:
            program = """
import sys,socket
from pathlib import Path
from paylite.excel._uno_worker import sandbox
task=Path(sys.argv[1]);sandbox(task)
(task/"allowed.txt").write_text("allowed")
for action in (
    lambda: Path("/tmp/paylite-engine-denied.txt").read_text(),
    lambda: Path("/tmp/paylite-engine-denied.txt").write_text("overwritten"),
    lambda: socket.socket(socket.AF_INET,socket.SOCK_STREAM),
    lambda: socket.socket(socket.AF_INET6,socket.SOCK_STREAM),
    lambda: socket.socket(socket.AF_INET,socket.SOCK_DGRAM),
):
    try: action()
    except PermissionError: pass
    else: raise AssertionError("sandbox allowed forbidden access")
print("filesystem/TCP/UDP denied")
"""
            # This trusted self-check imports the worker before applying its restrictions.
            subprocess.run(["/usr/local/bin/python", "-c", program, str(task)], check=True)
            assert outside.read_text() == "synthetic secret"
        finally:
            outside.unlink()


if __name__ == "__main__":
    assert os.name == "posix" and Path("/usr/bin/libreoffice").exists()
    assert not os.access("/tmp", os.W_OK, effective_ids=True) or os.getuid() == 0
    check_sandbox()
    check_recalculation()
