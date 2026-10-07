from datetime import date, datetime
from io import BytesIO

import pytest
from openpyxl import load_workbook

from paylite.excel.employee_template import (
    HEADERS,
    LEGACY_HEADERS,
    LEGACY_TEMPLATE_VERSION,
    SHEET_NAME,
    make_template,
    parse_workbook,
)


def test_employee_template_round_trip_and_preserves_text_identifiers() -> None:
    workbook = load_workbook(BytesIO(make_template()))
    sheet = workbook[SHEET_NAME]
    assert tuple(cell.value for cell in sheet[2]) == (
        "证件号码",
        "姓名",
        "主体简称",
        "公司主体全称",
        "一级部门",
        "二级部门",
        "三级部门",
        "岗位",
        "职级",
        "一级岗位",
        "二级岗位",
        "直属上级",
        "入职时间",
        "转正日期",
        "离职时间",
        "手机号",
        "银行卡号",
        "开户行",
        "转正固定薪资",
        "转正绩效标准",
        "试用期底薪",
        "试用期绩效",
        "劳动合同类型",
        "绩效支付周期",
        "备注",
        "年薪（万元）",
        "企业微信邮箱",
    )
    assert sheet.auto_filter.ref == "A2:AA2"
    assert sheet.column_dimensions["A"].number_format == "@"
    assert sheet.column_dimensions["Q"].number_format == "@"
    sheet.append(
        [
            "11010119900101123X",
            "张三",
            "主主体",
            "测试有限公司",
            "研发",
            "",
            "",
            "工程师",
            "P6",
            "技术",
            "研发",
            "李四",
            "2026-01-01",
            "2026-07-01",
            "",
            "013800000000",
            "000012345678901234",
            "银行支行",
            "8000.00",
            "2000.00",
            "8000.00",
            "0.00",
            "劳动合同",
            "月度",
            "备注",
            "12.00",
            "zhangsan@example.com",
        ]
    )
    output = BytesIO()
    workbook.save(output)
    rows = parse_workbook(output.getvalue())

    assert rows[0].number == 3
    assert rows[0].raw["证件号码"] == "11010119900101123X"
    assert rows[0].raw["手机号"] == "013800000000"
    assert rows[0].raw["银行卡号"] == "000012345678901234"
    assert rows[0].raw["企业微信邮箱"] == "zhangsan@example.com"
    assert rows[0].errors == []


def test_employee_import_calculates_salary_references_and_arithmetic_chains() -> None:
    workbook = load_workbook(BytesIO(make_template()))
    sheet = workbook[SHEET_NAME]
    sheet["S71"] = "3803.01"
    sheet["U71"] = "=S71"
    sheet["S72"] = "=3048+755.01"
    sheet["T72"] = "1000"
    sheet["U72"] = "=$S$72"
    sheet["Z72"] = "=ROUND((S72+T72)*12/10000,2)"
    output = BytesIO()
    workbook.save(output)

    rows = parse_workbook(output.getvalue())
    assert [row.number for row in rows] == [71, 72]
    assert rows[0].raw["试用期底薪"] == "3803.01"
    assert rows[1].raw["转正固定薪资"] == "3803.01"
    assert rows[1].raw["试用期底薪"] == "3803.01"
    assert rows[1].raw["年薪（万元）"] == "5.76"
    assert all(row.errors == [] for row in rows)


def test_employee_import_records_formula_and_numeric_identifier_errors() -> None:
    workbook = load_workbook(BytesIO(make_template()))
    sheet = workbook[SHEET_NAME]
    sheet.append(["11010119900101123X"] + [None] * (len(HEADERS) - 1))
    sheet.cell(3, 17).value = 123456789012345678
    sheet.cell(3, 27).value = "=1+1"
    output = BytesIO()
    workbook.save(output)
    rows = parse_workbook(output.getvalue())

    codes = {error["code"] for error in rows[0].errors}
    assert "IDENTIFIER_NOT_TEXT" in codes
    assert "FORMULA_NOT_ALLOWED" in codes
    assert rows[0].errors[1]["column"] == "AA"


@pytest.mark.parametrize(
    ("hire_date", "formula", "expected"),
    [
        ("2026-01-31", "=EDATE(M3,3)", "2026-04-30"),
        (date(2023, 11, 30), "=EDATE(M3,3)", "2024-02-29"),
        (datetime(2024, 11, 30), "= edate( $M$3 , 3 )", "2025-02-28"),
        ("2026-01-15", "=EDATE(M3,3)", "2026-04-15"),
    ],
)
def test_employee_import_calculates_edate_probation_date(hire_date, formula, expected) -> None:
    workbook = load_workbook(BytesIO(make_template()))
    sheet = workbook[SHEET_NAME]
    sheet["M3"] = hire_date
    sheet["N3"] = formula
    output = BytesIO()
    workbook.save(output)

    row = parse_workbook(output.getvalue())[0]
    assert row.raw["转正日期"] == expected
    assert row.errors == []


@pytest.mark.parametrize(
    ("hire_date", "formula"),
    [
        (None, "=EDATE(M3,3)"),
        ("不是日期", "=EDATE(M3,3)"),
        ("=TODAY()", "=EDATE(M3,3)"),
        ("2026-01-31", "=EDATE(M4,3)"),
        ("2026-01-31", "=EDATE(L3,3)"),
        ("2026-01-31", "=EDATE(M3,999999)"),
        ("2026-01-31", "=TODAY()"),
    ],
)
def test_employee_import_rejects_invalid_probation_formulas(hire_date, formula) -> None:
    workbook = load_workbook(BytesIO(make_template()))
    sheet = workbook[SHEET_NAME]
    sheet["M3"] = hire_date
    sheet["N3"] = formula
    output = BytesIO()
    workbook.save(output)

    row = parse_workbook(output.getvalue())[0]
    assert row.raw["转正日期"] == formula
    assert any(error["cell"] == "N3" for error in row.errors)


def test_employee_import_calculates_legacy_edate_probation_date() -> None:
    workbook = load_workbook(BytesIO(make_template()))
    sheet = workbook[SHEET_NAME]
    sheet.delete_rows(2)
    sheet["A1"] = LEGACY_TEMPLATE_VERSION
    sheet.append(LEGACY_HEADERS)
    sheet["E3"] = date(2026, 1, 31)
    sheet["H3"] = "=EDATE(E3,3)"
    output = BytesIO()
    workbook.save(output)

    row = parse_workbook(output.getvalue())[0]
    assert row.raw["转正日期"] == "2026-04-30"
    assert row.errors == []


@pytest.mark.parametrize(
    ("fixed", "performance", "formula", "expected"),
    [
        (8000, 2000, "=ROUND((S3+T3)*12/10000,2)", "12.00"),
        ("1000.00", "4.17", "=ROUND((S3+T3)*12/10000,2)", "1.21"),
        ("1000.00", "4.16", "=ROUND((S3+T3)*12/10000,2)", "1.20"),
        ("837.50", "0", "= round( ($S$3 + $T3) * 12 / 10000 , 2 )", "1.01"),
        (0, 0, "=ROUND((S3+T3)*12/10000,2)", "0.00"),
        ("=1+1", 2000, "=ROUND((S3+T3)*12/10000,2)", "2.40"),
    ],
)
def test_employee_import_calculates_annual_salary(fixed, performance, formula, expected) -> None:
    workbook = load_workbook(BytesIO(make_template()))
    sheet = workbook[SHEET_NAME]
    sheet["S3"] = fixed
    sheet["T3"] = performance
    sheet["Z3"] = formula
    output = BytesIO()
    workbook.save(output)

    row = parse_workbook(output.getvalue())[0]
    assert row.raw["年薪（万元）"] == expected
    assert row.errors == []


@pytest.mark.parametrize(
    ("fixed", "performance", "formula", "code"),
    [
        (None, 2000, "=ROUND((S3+T3)*12/10000,2)", "INVALID_AMOUNT"),
        (8000, "不是金额", "=ROUND((S3+T3)*12/10000,2)", "INVALID_AMOUNT"),
        ("NaN", 2000, "=ROUND((S3+T3)*12/10000,2)", "INVALID_AMOUNT"),
        ("Infinity", 2000, "=ROUND((S3+T3)*12/10000,2)", "INVALID_AMOUNT"),
        (-8000, 2000, "=ROUND((S3+T3)*12/10000,2)", "INVALID_AMOUNT"),
        (8000, 2000, "=ROUND((S4+T4)*12/10000,2)", "FORMULA_NOT_ALLOWED"),
        (8000, 2000, "=ROUND((S3+U3)*12/10000,2)", "INVALID_AMOUNT"),
    ],
)
def test_employee_import_rejects_invalid_annual_salary_formulas(
    fixed, performance, formula, code
) -> None:
    workbook = load_workbook(BytesIO(make_template()))
    sheet = workbook[SHEET_NAME]
    sheet["S3"] = fixed
    sheet["T3"] = performance
    sheet["Z3"] = formula
    output = BytesIO()
    workbook.save(output)

    row = parse_workbook(output.getvalue())[0]
    assert row.raw["年薪（万元）"] == formula
    assert any(error["cell"] == "Z3" and error["code"] == code for error in row.errors)


@pytest.mark.parametrize(
    ("formula", "expected"),
    [
        ("=0.1+0.2", "0.3"),
        ("=(-5+15)*3/2", "15"),
        ("=round(2.675,2)", "2.68"),
        ("=ROUND(ROUND(1.2345,3),2)", "1.24"),
    ],
)
def test_employee_import_uses_decimal_for_supported_arithmetic(formula, expected) -> None:
    workbook = load_workbook(BytesIO(make_template()))
    workbook.active["S3"] = formula
    output = BytesIO()
    workbook.save(output)

    row = parse_workbook(output.getvalue())[0]
    assert row.raw["转正固定薪资"] == expected
    assert row.formulas["转正固定薪资"] == formula
    assert row.errors == []


@pytest.mark.parametrize(
    ("formula", "code"),
    [
        ("=S3", "INVALID_AMOUNT"),
        ("=1/0", "INVALID_AMOUNT"),
        ("=SUM(1,2)", "FORMULA_NOT_ALLOWED"),
        ("=S4", "FORMULA_NOT_ALLOWED"),
        ("=A3", "FORMULA_NOT_ALLOWED"),
        ("='员工资料'!T3", "FORMULA_NOT_ALLOWED"),
        ("=[other.xlsx]Sheet1!T3", "FORMULA_NOT_ALLOWED"),
        ("=__import__('os')", "FORMULA_NOT_ALLOWED"),
        ("=2**3", "FORMULA_NOT_ALLOWED"),
        ("=True", "FORMULA_NOT_ALLOWED"),
        ("=1_000", "FORMULA_NOT_ALLOWED"),
        ("=1 2", "FORMULA_NOT_ALLOWED"),
        ("=1)", "FORMULA_NOT_ALLOWED"),
        ("=ROUND(1,100000000)", "INVALID_AMOUNT"),
        ("=1+" + "1+" * 600, "FORMULA_NOT_ALLOWED"),
    ],
)
def test_employee_import_reports_formula_errors_without_executing_code(formula, code) -> None:
    workbook = load_workbook(BytesIO(make_template()))
    workbook.active["S3"] = formula
    output = BytesIO()
    workbook.save(output)

    row = parse_workbook(output.getvalue())[0]
    assert row.raw["转正固定薪资"] == formula
    assert row.errors[0]["cell"] == "S3"
    assert row.errors[0]["code"] == code


def test_employee_import_reports_circular_formula_dependencies() -> None:
    workbook = load_workbook(BytesIO(make_template()))
    workbook.active["S3"] = "=T3"
    workbook.active["T3"] = "=S3"
    output = BytesIO()
    workbook.save(output)

    row = parse_workbook(output.getvalue())[0]
    assert {error["cell"] for error in row.errors} == {"S3", "T3"}
    assert all("循环引用" in error["message"] for error in row.errors)
