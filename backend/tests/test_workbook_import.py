"""Whole-workbook adapter behavior at the original-file boundary."""

import json
from datetime import date
from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

import pytest
from openpyxl import load_workbook

from paylite.excel.employee_template import WorkbookFormatError
from paylite.excel.engine import EngineFailure, recalculate
from paylite.excel.workbook_import import (
    changed_dependencies,
    parse_workbook,
    prepare_evaluation,
    read_evaluated,
)
from workbook_fixture import source_workbook


def test_fixed_workbook_keeps_original_positions_and_ignores_formatted_rows():
    parsed = parse_workbook(source_workbook(oversized_dimension=True), date(2026, 8, 1))
    assert [row.number for row in parsed.employees] == [2, 3]
    assert parsed.employees[0].raw["证件号码"] == "11010120000101002X"
    assert parsed.employees[0].raw["转正日期"] == "=EDATE(N2,3)"
    assert parsed.employee_mapping["转正固定薪资"] == "T"
    assert [row.number for row in parsed.attendance] == [3]
    assert parsed.attendance_mapping["应出勤天数"] == "T"
    assert parsed.attendance[0].raw["应出勤天数"] == "=NETWORKDAYS(Q1,P1)"
    assert "总扣款" not in parsed.attendance[0].raw
    assert parsed.employees[1].raw["证件号码"] == ""
    assert parsed.attendance[0].raw["身份证号"] == "=花名册!B2"
    assert parsed.period == date(2026, 8, 1)


def test_workbook_rejects_wrong_period_before_any_evaluation():
    with pytest.raises(WorkbookFormatError, match="月份"):
        parse_workbook(source_workbook(), date(2026, 9, 1))


def test_evaluation_copy_contains_only_safe_required_dependencies():
    parsed = parse_workbook(source_workbook(), date(2026, 8, 1))
    plan = prepare_evaluation(parsed)
    safe = load_workbook(BytesIO(plan.content))
    assert plan.errors == {}
    assert safe["考勤表"]["T3"].value == "=NETWORKDAYS(Q1,P1)"
    assert safe["考勤表"]["AV3"].value is None
    assert "工资表明细" not in safe.sheetnames
    assert safe["花名册"]["B2"].value == "11010120000101002X"
    assert changed_dependencies(plan, ["考勤表!身份证号!3"], {"花名册!B2"})
    parsed.workbook["考勤表"]["T3"] = '=WEBSERVICE("https://example.invalid")'
    rejected = prepare_evaluation(parsed)
    error = rejected.errors["考勤表!应出勤天数!3"][0]
    assert error["cell"] == "T3"
    assert error["sheet_name"] == "考勤表"
    assert error["code"] == "UNSAFE_DEPENDENCY"
    assert "WEBSERVICE" in error["message"]
    assert load_workbook(BytesIO(rejected.content))["考勤表"]["T3"].value is None


def test_engine_unavailable_has_no_cached_result(tmp_path):
    with pytest.raises(EngineFailure, match="不可用"):
        recalculate(b"old workbook cache", python_path=str(tmp_path / "missing-python"))


def test_engine_timeout_and_crash_do_not_return_output(tmp_path):
    executable = tmp_path / "worker"
    executable.write_text("#!/bin/sh\nsleep 10 &\nwait\n")
    executable.chmod(0o755)
    with pytest.raises(EngineFailure, match="超时"):
        recalculate(b"ignored", python_path=str(executable), timeout=0.1)
    executable.write_text("#!/bin/sh\nprintf old > output.xlsx\nexit 7\n")
    with pytest.raises(EngineFailure, match="不可用"):
        recalculate(b"ignored", python_path=str(executable))


def test_evaluation_errors_use_original_cells_and_preserve_formulas():
    parsed = parse_workbook(source_workbook(), date(2026, 8, 1))
    plan = prepare_evaluation(parsed)
    output = load_workbook(BytesIO(plan.content))
    output["考勤表"]["T3"] = "#VALUE!"
    output["考勤表"]["A3"] = "11010120000101002X"
    output["考勤表"]["B3"] = "合成员工"
    output["考勤表"]["C3"] = "北京合成有限公司"
    saved = BytesIO()
    output.save(saved)
    employees, attendance = read_evaluated(parsed, plan, saved.getvalue())
    assert attendance[0].raw["身份证号"] == "11010120000101002X"
    assert attendance[0].formulas["身份证号"] == "=花名册!B2"
    issue = next(e for e in attendance[0].errors if e["field"] == "应出勤天数")
    assert issue["cell"] == "T3"
    assert issue["code"] == "EXCEL_ERROR"
    assert issue["sheet_name"] == "考勤表"
    assert employees[0].raw["证件号码"] == "11010120000101002X"


def test_invalid_engine_workbook_does_not_become_empty_inputs():
    parsed = parse_workbook(source_workbook(), date(2026, 8, 1))
    with pytest.raises(WorkbookFormatError, match="引擎输出无法读取"):
        read_evaluated(parsed, prepare_evaluation(parsed), b"invalid engine output")


@pytest.mark.parametrize(
    "formula",
    [
        "='[foreign.xlsx]Sheet1'!A1",
        '=INDIRECT("花名册!B2")',
        '=DDE("program","file","range")',
        '=RTD("program","server","topic")',
        '=HYPERLINK("file:///tmp/private")',
        "=NamedExternalData",
        "=T3",
    ],
)
def test_required_external_dynamic_named_or_cyclic_reference_is_rejected(formula):
    parsed = parse_workbook(source_workbook(), date(2026, 8, 1))
    parsed.workbook["考勤表"]["T3"] = formula
    plan = prepare_evaluation(parsed)
    assert plan.errors["考勤表!应出勤天数!3"][0]["cell"] == "T3"
    assert plan.errors["考勤表!应出勤天数!3"][0]["code"] == "UNSAFE_DEPENDENCY"
    assert "考勤表!身份证号!3" not in plan.errors
    assert load_workbook(BytesIO(plan.content))["考勤表"]["T3"].value is None


def test_unrelated_macro_parts_are_not_passed_to_the_engine():
    output = BytesIO()
    with (
        ZipFile(BytesIO(source_workbook())) as original,
        ZipFile(output, "w", ZIP_DEFLATED) as target,
    ):
        for item in original.infolist():
            target.writestr(item, original.read(item.filename))
        target.writestr("xl/vbaProject.bin", b"synthetic inert macro bytes")
        target.writestr("xl/externalLinks/unrelated.xml", b"synthetic inert external link")
    plan = prepare_evaluation(parse_workbook(output.getvalue(), date(2026, 8, 1)))
    assert not plan.errors
    with ZipFile(BytesIO(plan.content)) as safe:
        assert not any("vba" in name.lower() or "externalLinks" in name for name in safe.namelist())


def test_effective_row_limit_is_checked_before_engine_evaluation():
    workbook = load_workbook(BytesIO(source_workbook()))
    for number in range(4, 5003):
        workbook["花名册"].cell(number, 3, "合成非空输入")
    output = BytesIO()
    workbook.save(output)
    with pytest.raises(WorkbookFormatError, match="5,000|5000"):
        parse_workbook(output.getvalue(), date(2026, 8, 1))


def test_trace_only_employee_data_does_not_block_monthly_inputs():
    workbook = load_workbook(BytesIO(source_workbook()))
    workbook["花名册"]["Q2"] = 12345678901
    workbook["花名册"]["U2"] = "#REF!"
    workbook["花名册"]["U4"] = 2000
    output = BytesIO()
    workbook.save(output)
    parsed = parse_workbook(output.getvalue(), date(2026, 8, 1))
    assert [row.number for row in parsed.employees] == [2, 3]
    assert parsed.employees[0].errors == []
    assert parsed.employees[0].raw["手机号"] == "12345678901"
    assert parsed.employees[0].raw["转正绩效标准"] == "#REF!"


def test_lookup_excludes_unread_columns_and_other_return_rows():
    workbook = load_workbook(BytesIO(source_workbook()))
    workbook["考勤表"]["B3"] = '=VLOOKUP(A3&"*",花名册!B:AB,2,0)'
    workbook["花名册"]["U2"] = '=WEBSERVICE("https://example.invalid")'
    workbook["花名册"]["C3"] = '=WEBSERVICE("https://example.invalid")'
    output = BytesIO()
    workbook.save(output)
    plan = prepare_evaluation(parse_workbook(output.getvalue(), date(2026, 8, 1)))
    assert "考勤表!姓名!3" not in plan.errors
    assert "花名册!姓名!3" in plan.errors
    safe = load_workbook(BytesIO(plan.content))
    assert safe["花名册"]["U2"].value is None
    assert safe["花名册"]["C3"].value is None
    assert safe["花名册"]["C2"].value == "合成员工"


@pytest.mark.parametrize("count", [200, 5000])
def test_whole_column_lookup_dependencies_remain_bounded_for_large_inputs(count):
    workbook = load_workbook(BytesIO(source_workbook()))
    roster, attendance = workbook["花名册"], workbook["考勤表"]
    source = [cell.value for cell in roster[2]]
    for number in range(2, count + 2):
        for column, value in enumerate(source, 1):
            roster.cell(number, column, value)
        roster[f"B{number}"] = f"110101200001{number:05d}X"
        attendance[f"A{number + 1}"] = f"=花名册!B{number}"
        attendance[f"B{number + 1}"] = f'=VLOOKUP(A{number + 1}&"*",花名册!B:C,2,0)'
        attendance[f"C{number + 1}"] = f"=INDEX(花名册!E:E,MATCH(A{number + 1},花名册!B:B,0))"
        attendance[f"T{number + 1}"] = "=NETWORKDAYS($Q$1,$P$1)"
    output = BytesIO()
    workbook.save(output)
    plan = prepare_evaluation(parse_workbook(output.getvalue(), date(2026, 8, 1)))
    assert not plan.errors
    assert len(plan.content) < 5 * 1024**2
    assert len(json.dumps(plan.dependencies, ensure_ascii=False).encode()) < 8 * 1024**2


def test_index_match_expression_keeps_possible_return_rows():
    workbook = load_workbook(BytesIO(source_workbook()))
    helper = workbook.create_sheet("辅助")
    helper["B2"] = "11010120000101002X"
    helper["A2"] = 10
    helper["A3"] = 21
    workbook["考勤表"]["T3"] = "=INDEX(辅助!A:A,MATCH(A3,辅助!B:B,0)+1)"
    output = BytesIO()
    workbook.save(output)
    plan = prepare_evaluation(parse_workbook(output.getvalue(), date(2026, 8, 1)))
    assert not plan.errors
    assert load_workbook(BytesIO(plan.content))["辅助"]["A3"].value == 21


def test_cleared_corrected_input_row_is_preserved_for_required_validation():
    parsed = parse_workbook(source_workbook(), date(2026, 8, 1), {("花名册", 3): {"姓名": ""}})
    row = next(row for row in parsed.employees if row.number == 3)
    assert row.raw["姓名"] == ""
