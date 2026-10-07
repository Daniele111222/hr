from io import BytesIO

from openpyxl import load_workbook

from paylite.excel.employee_template import (
    HEADERS,
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


def test_employee_import_records_formula_and_numeric_identifier_errors() -> None:
    workbook = load_workbook(BytesIO(make_template()))
    sheet = workbook[SHEET_NAME]
    sheet.append(["11010119900101123X"] + [None] * (len(HEADERS) - 1))
    sheet.cell(3, 17).value = 123456789012345678
    sheet.cell(3, 26).value = "=1+1"
    output = BytesIO()
    workbook.save(output)
    rows = parse_workbook(output.getvalue())

    codes = {error["code"] for error in rows[0].errors}
    assert "IDENTIFIER_NOT_TEXT" in codes
    assert "FORMULA_NOT_ALLOWED" in codes
    assert rows[0].errors[1]["column"] == "Z"
