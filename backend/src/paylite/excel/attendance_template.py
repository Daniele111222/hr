"""Attendance facts with source salary and deduction columns retained for traceability."""

from decimal import Decimal
from io import BytesIO

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from paylite.excel.employee_template import (
    MAX_ROWS,
    WorkbookFormatError,
    WorkbookRow,
    _value,
)
from paylite.excel.formulas import resolve_row_formulas

TEMPLATE_VERSION = "TPL-ATT-v3"
REFERENCE_TEMPLATE_VERSION = "TPL-ATT-v2"
LEGACY_TEMPLATE_VERSION = "TPL-ATT-v1"
SHEET_NAME = "月度考勤"
LEGACY_HEADERS = (
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
)
REFERENCE_HEADERS = (
    "身份证号",
    "姓名",
    "公司",
    "一级部门",
    "二级部门",
    "三级部门",
    "入职日期",
    "转正日期",
    "离职日期",
    "试用期固定薪资",
    "试用期绩效",
    "转正固定薪资",
    "转正绩效",
    "当月固定薪资标准",
    "当月绩效标准",
    "当期考勤基数",
    "当地最低工资",
    "试用期工作日天数",
    "转正工作日天数",
    "工作日天数合计",
    "实际出勤天数",
    "请假外未出勤天数（当月入离职）",
    "迟到时长",
    "早退时长",
    "缺卡次数",
    "旷工天数",
    "事假天数",
    "病假天数",
    "年假天数",
    "产假天数",
    "产检假天数",
    "陪产假天数",
    "育儿假天数",
    "婚假天数",
    "丧假天数",
    "其他福利假",
    "调休天数",
    "请假外未出勤扣款",
    "迟到/早退扣款",
    "缺卡扣款",
    "事假扣款",
    "病假扣款",
    "产假扣款",
    "旷工扣款",
    "总扣款",
    "转正标记",
    "效验",
    "转正后实际出勤",
)
HEADERS = (
    "身份证号",
    "姓名",
    "公司",
    "应出勤天数",
    "迟到分钟",
    "早退分钟",
    "未补卡次数",
    *REFERENCE_HEADERS[25:37],
)
TEMPLATE_HEADERS = {
    TEMPLATE_VERSION: HEADERS,
    REFERENCE_TEMPLATE_VERSION: REFERENCE_HEADERS,
    LEGACY_TEMPLATE_VERSION: LEGACY_HEADERS,
}


def input_fields(headers: tuple[str, ...]) -> set[str]:
    if headers == LEGACY_HEADERS:
        return set(LEGACY_HEADERS)
    return set(HEADERS) | {"工作日天数合计", "迟到时长", "早退时长", "缺卡次数"}


DATE_FIELDS = {"入职日期", "转正日期", "离职日期"}
NUMERIC_FIELDS = (
    set(REFERENCE_HEADERS[9:45])
    | {"效验", "转正后实际出勤"}
    | set(LEGACY_HEADERS[2:9])
    | set(HEADERS[3:])
)
INTEGER_FIELDS = {
    "迟到时长",
    "早退时长",
    "缺卡次数",
    "迟到分钟",
    "早退分钟",
    "忘打卡次数",
    "补卡次数",
    "未补卡次数",
}


def resolve_attendance_formulas(
    raw: dict[str, str], number: int, headers: tuple[str, ...]
) -> tuple[dict[str, str], list[dict[str, str]]]:
    formula_fields = {field for field, value in raw.items() if value.startswith("=")}
    targets = input_fields(headers)
    computed, errors = resolve_row_formulas(
        raw,
        number,
        headers,
        DATE_FIELDS,
        NUMERIC_FIELDS,
        formula_fields=formula_fields,
        target_fields=targets,
        blank_numeric_zero=True,
    )
    for field in formula_fields & INTEGER_FIELDS & targets:
        if not computed[field].startswith("="):
            value = Decimal(computed[field])
            if value == value.to_integral_value():
                computed[field] = format(value.to_integral_value(), "f")
    return computed, errors


def make_template() -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = SHEET_NAME
    sheet.append(HEADERS)
    sheet.freeze_panes = "C2"
    sheet.auto_filter.ref = f"A1:{get_column_letter(len(HEADERS))}1"
    for cell in sheet[1]:
        cell.font = Font(color="FFFFFF", bold=True)
        cell.fill = PatternFill("solid", fgColor="315FD1")
        cell.alignment = Alignment(vertical="center")
        sheet.column_dimensions[cell.column_letter].width = 26 if cell.column == 1 else 20
    sheet.column_dimensions["C"].width = 42
    # 预设文本格式，避免 Excel 将长身份证号存成丢失精度的数字。
    sheet.column_dimensions["A"].number_format = "@"
    output = BytesIO()
    workbook.save(output)
    return output.getvalue()


def parse_workbook(content: bytes) -> list[WorkbookRow]:
    try:
        workbook = load_workbook(
            BytesIO(content), read_only=False, data_only=False, keep_links=False
        )
    except Exception as exc:
        raise WorkbookFormatError("Excel 文件无法读取") from exc
    try:
        if workbook.sheetnames != [SHEET_NAME]:
            raise WorkbookFormatError("工作表不匹配，请使用月度考勤固定模板")
        sheet = workbook[SHEET_NAME]
        legacy = sheet["A1"].value == LEGACY_TEMPLATE_VERSION
        header_row = 2 if legacy else 1
        headers = tuple(cell.value for cell in sheet[header_row])
        if headers not in TEMPLATE_HEADERS.values() or (legacy and headers != LEGACY_HEADERS):
            raise WorkbookFormatError("模板表头或列顺序不匹配")
        if not legacy and headers == LEGACY_HEADERS:
            raise WorkbookFormatError("旧模板须包含 TPL-ATT-v1 版本行")
        if sheet.max_row - header_row > MAX_ROWS:
            raise WorkbookFormatError(f"单次最多导入 {MAX_ROWS} 行")
        rows = []
        for number in range(header_row + 1, sheet.max_row + 1):
            raw = {}
            errors = []
            formulas = {}
            for column, field in enumerate(headers, 1):
                cell = sheet.cell(number, column)
                value, error = _value(cell, field)
                raw[field] = value
                if cell.data_type == "f":
                    value = str(getattr(cell.value, "text", value))
                    raw[field] = value
                    formulas[field] = value
                elif error and field in input_fields(headers):
                    errors.append(error)
            if any(raw.values()):
                computed, formula_errors = resolve_attendance_formulas(raw, number, headers)
                rows.append(WorkbookRow(number, computed, [*errors, *formula_errors], formulas))
        if not rows:
            raise WorkbookFormatError("Excel 文件没有考勤数据行")
        return rows
    finally:
        workbook.close()
