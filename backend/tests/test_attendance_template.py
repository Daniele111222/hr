from io import BytesIO
from urllib.parse import unquote

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook, load_workbook

from paylite.application import create_app
from paylite.excel.attendance_template import make_template, parse_workbook

REFERENCE_HEADERS = tuple(
    "身份证号 姓名 公司 一级部门 二级部门 三级部门 入职日期 转正日期 离职日期 "
    "试用期固定薪资 试用期绩效 转正固定薪资 转正绩效 当月固定薪资标准 当月绩效标准 "
    "当期考勤基数 当地最低工资 试用期工作日天数 转正工作日天数 工作日天数合计 "
    "实际出勤天数 请假外未出勤天数（当月入离职） 迟到时长 早退时长 缺卡次数 "
    "旷工天数 事假天数 病假天数 年假天数 产假天数 产检假天数 陪产假天数 育儿假天数 "
    "婚假天数 丧假天数 其他福利假 调休天数 请假外未出勤扣款 迟到/早退扣款 缺卡扣款 "
    "事假扣款 病假扣款 产假扣款 旷工扣款 总扣款 转正标记 效验 转正后实际出勤".split()
)
FACT_HEADERS = tuple(
    "身份证号 姓名 公司 应出勤天数 迟到分钟 早退分钟 未补卡次数 旷工天数 事假天数 "
    "病假天数 年假天数 产假天数 产检假天数 陪产假天数 育儿假天数 婚假天数 丧假天数 "
    "其他福利假 调休天数".split()
)


def reference_workbook() -> Workbook:
    workbook = Workbook()
    workbook.active.title = "月度考勤"
    workbook.active.append(REFERENCE_HEADERS)
    return workbook


def test_attendance_template_matches_reference_and_download_name() -> None:
    with TestClient(create_app()) as client:
        response = client.get("/imports/attendance-template")
    assert response.status_code == 200
    assert "filename*=UTF-8''考勤导入模版.xlsx" in unquote(response.headers["content-disposition"])
    workbook = load_workbook(BytesIO(response.content))
    sheet = workbook.active
    assert tuple(cell.value for cell in sheet[1]) == FACT_HEADERS
    assert sheet.max_row == 1
    assert sheet.column_dimensions["A"].number_format == "@"


def test_reference_attendance_preserves_all_columns_and_error_coordinates() -> None:
    workbook = reference_workbook()
    sheet = workbook.active
    values = {
        "身份证号": "11010119900101123X",
        "姓名": "张三",
        "公司": "测试主体",
        "工作日天数合计": 21,
        "实际出勤天数": 21,
        "迟到时长": 62,
        "病假天数": "0.5",
        "产假天数": 2,
        "迟到/早退扣款": "125.66",
        "总扣款": "125.66",
        "转正标记": "转正",
    }
    sheet.append([values.get(field) for field in REFERENCE_HEADERS])
    values["旷工天数"] = "=SUM(1,1)"
    sheet.append([values.get(field) for field in REFERENCE_HEADERS])
    output = BytesIO()
    workbook.save(output)
    rows = parse_workbook(output.getvalue())
    assert rows[0].number == 2
    assert rows[0].raw["迟到时长"] == "62"
    assert rows[0].raw["总扣款"] == "125.66"
    assert rows[0].raw["病假天数"] == "0.5"
    assert rows[0].errors == []
    assert rows[1].errors[0]["cell"] == "Z3"


def test_attendance_template_preserves_identity_and_calculates_legacy_formula() -> None:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "月度考勤"
    sheet.append(["TPL-ATT-v1"])
    sheet.append(
        [
            "身份证号",
            "姓名",
            "应出勤天数",
            "迟到分钟",
            "早退分钟",
            "有薪请假天数",
            "无薪请假天数",
            "忘打卡次数",
            "补卡次数",
            "来源说明",
        ]
    )
    sheet.append(["11010119900101123X", "张三", "20", 15, 0, "1.5", "0.5", 2, 1, "考勤系统"])
    sheet.append([110101199001011250, "李四", "=20", 0, 0, 0, 0, 0, 0, "考勤系统"])
    output = BytesIO()
    workbook.save(output)

    rows = parse_workbook(output.getvalue())
    assert rows[0].raw["身份证号"] == "11010119900101123X"
    assert rows[0].errors == []
    assert rows[1].raw["应出勤天数"] == "20"
    assert {item["code"] for item in rows[1].errors} == {"IDENTIFIER_NOT_TEXT"}


def test_attendance_formulas_calculate_dependencies_without_excel_cache() -> None:
    workbook = reference_workbook()
    values = {
        "身份证号": "11010119900101123X",
        "姓名": "测试员工",
        "公司": "测试主体",
        "入职日期": "2026-01-31",
        "转正日期": "=EDATE(G2,3)",
        "试用期工作日天数": "3",
        "转正工作日天数": "18",
        "工作日天数合计": "=$R2+S$2",
        "迟到时长": "=ROUND(62.0,2)",
        "缺卡次数": "=1.0+1.0",
        "病假天数": "=1/2",
        "当月固定薪资标准": "8000",
        "迟到/早退扣款": "=ROUND(N2/T2/8/60*W2,2)",
        "总扣款": "=AM2+AN2+AO2+AP2+AQ2+AR2",
    }
    workbook.active.append([values.get(field) for field in REFERENCE_HEADERS])
    output = BytesIO()
    workbook.save(output)
    row = parse_workbook(output.getvalue())[0]
    assert row.errors == []
    assert row.raw["工作日天数合计"] == "21"
    assert row.raw["迟到时长"] == "62"
    assert row.raw["缺卡次数"] == "2"
    assert row.raw["病假天数"] == "0.5"
    assert row.raw["转正日期"] == values["转正日期"]
    assert row.raw["总扣款"] == values["总扣款"]
    assert row.raw["迟到/早退扣款"] == values["迟到/早退扣款"]
    assert row.formulas["总扣款"] == values["总扣款"]
    assert row.raw["缺卡扣款"] == ""


@pytest.mark.parametrize(
    "formula",
    [
        "=T2",
        "=1/0",
        "=S3",
        "=SUM(R2:S2)",
        "=IF(1,1,0)",
        "='月度考勤'!S2",
        "=[other.xlsx]Sheet1!S2",
        "=A2",
        "=-1",
    ],
)
def test_attendance_rejects_invalid_formula_with_source_location(formula) -> None:
    workbook = reference_workbook()
    workbook.active["T2"] = formula
    output = BytesIO()
    workbook.save(output)
    row = parse_workbook(output.getvalue())[0]
    assert row.errors[0]["field"] == "工作日天数合计"
    assert row.errors[0]["cell"] == "T2"
    assert row.formulas["工作日天数合计"] == formula


def test_trace_only_errors_do_not_block_facts_but_required_dependencies_do() -> None:
    workbook = reference_workbook()
    values = {
        "身份证号": "11010119900101123X",
        "姓名": "测试员工",
        "公司": "测试主体",
        "工作日天数合计": "=R2+S2",
        "试用期工作日天数": "=ROUND(3,0)",
        "转正工作日天数": "18",
        "当月固定薪资标准": "=花名册!T2",
        "总扣款": "=SUM(AL2:AR2)",
        "实际出勤天数": "#REF!",
        "一级部门": "=花名册!F2",
    }
    workbook.active.append([values.get(field) for field in REFERENCE_HEADERS])
    values["工作日天数合计"] = "=R3+S3"
    values["试用期工作日天数"] = "=SUM(3,0)"
    workbook.active.append([values.get(field) for field in REFERENCE_HEADERS])
    output = BytesIO()
    workbook.save(output)
    first, second = parse_workbook(output.getvalue())
    assert first.errors == []
    assert first.raw["工作日天数合计"] == "21"
    assert first.raw["总扣款"] == values["总扣款"]
    assert first.raw["实际出勤天数"] == "#REF!"
    assert second.errors[0]["cell"] == "T3"
    assert second.errors[0]["code"] == "FORMULA_NOT_ALLOWED"


def test_fact_template_resolves_inputs_and_rejects_text_formulas() -> None:
    workbook = load_workbook(BytesIO(make_template()))
    values = {
        "身份证号": "11010119900101123X",
        "姓名": "测试员工",
        "公司": "测试主体",
        "应出勤天数": "=10+11",
        "迟到分钟": "=ROUND(62,2)",
        "未补卡次数": "=1+1",
        "病假天数": "=1/2",
    }
    workbook.active.append([values.get(field) for field in FACT_HEADERS])
    values["公司"] = "=A3"
    workbook.active.append([values.get(field) for field in FACT_HEADERS])
    output = BytesIO()
    workbook.save(output)
    first, second = parse_workbook(output.getvalue())
    assert first.errors == []
    assert first.raw["应出勤天数"] == "21"
    assert first.raw["迟到分钟"] == "62"
    assert first.raw["未补卡次数"] == "2"
    assert first.raw["病假天数"] == "0.5"
    assert second.errors[0]["cell"] == "C3"
    assert second.errors[0]["code"] == "FORMULA_NOT_ALLOWED"
