"""Fixed employee workbook format. No business decisions live in this adapter."""

from dataclasses import dataclass
from dataclasses import field as dataclass_field
from datetime import date, datetime
from decimal import Decimal, DecimalException
from io import BytesIO
from typing import Any

from openpyxl import Workbook, load_workbook
from openpyxl.cell.cell import Cell
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.utils.cell import column_index_from_string, coordinate_from_string

from paylite.excel.formulas import FormulaValue, UnsupportedFormula, evaluate_formula

TEMPLATE_VERSION = "TPL-EMP-v3"
SHEET_NAME = "员工资料"
MAX_FILE_SIZE = 20 * 1024 * 1024
MAX_ROWS = 5000
HEADERS = (
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
LEGACY_TEMPLATE_VERSION = "TPL-EMP-v2.4"
LEGACY_HEADERS = (
    "身份证号",
    "员工编号",
    "姓名",
    "员工类型",
    "入职日期",
    "离职日期",
    "转正状态",
    "转正日期",
    "是否正式",
    "主体编码",
    "部门编码",
    "职位",
    "职级",
    "职级数字",
    "固定薪资",
    "绩效基数",
    "base城市编码",
    "银行卡号",
    "开户名",
    "银行名称",
    "支行名称",
    "生效日期",
)
# 身份证号仍用于考勤、绩效模板的共享单元格解析。
TEXT_IDENTIFIERS = {"身份证号", "员工编号", "证件号码", "银行卡号", "手机号"}


class WorkbookFormatError(ValueError):
    pass


@dataclass(frozen=True)
class WorkbookRow:
    number: int
    raw: dict[str, str]
    errors: list[dict[str, str]]
    formulas: dict[str, str] = dataclass_field(default_factory=dict)


def make_template() -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = SHEET_NAME
    sheet.append([TEMPLATE_VERSION])
    sheet.append(HEADERS)
    sheet.freeze_panes = "A3"
    sheet.auto_filter.ref = "A2:AA2"
    for cell in sheet[2]:
        cell.font = Font(color="FFFFFF", bold=True)
        cell.fill = PatternFill("solid", fgColor="315FD1")
        cell.alignment = Alignment(vertical="center")
    sheet.row_dimensions[2].height = 24
    for index, header in enumerate(HEADERS, 1):
        letter = sheet.cell(2, index).column_letter
        sheet.column_dimensions[letter].width = 21 if header not in TEXT_IDENTIFIERS else 27
        if header in TEXT_IDENTIFIERS:
            sheet.column_dimensions[letter].number_format = "@"
    output = BytesIO()
    workbook.save(output)
    return output.getvalue()


def _value(cell: Cell, field: str) -> tuple[str, dict[str, str] | None]:
    if cell.value is None:
        return "", None
    if cell.data_type == "f":
        return str(cell.value), {
            "code": "FORMULA_NOT_ALLOWED",
            "field": field,
            "column": cell.column_letter,
            "cell": cell.coordinate,
            "message": "导入模板不接受公式，请填写实际值",
        }
    if cell.data_type == "e":
        return str(cell.value), {
            "code": "EXCEL_ERROR",
            "field": field,
            "column": cell.column_letter,
            "cell": cell.coordinate,
            "message": "Excel 单元格含错误值",
        }
    if field in TEXT_IDENTIFIERS and cell.data_type != "s":
        return str(cell.value), {
            "code": "IDENTIFIER_NOT_TEXT",
            "field": field,
            "column": cell.column_letter,
            "cell": cell.coordinate,
            "message": f"{field}必须按文本填写，避免前导零或长数字丢失",
        }
    value: Any = cell.value
    if isinstance(value, (date, datetime)):
        return value.date().isoformat() if isinstance(value, datetime) else value.isoformat(), None
    return str(value).strip(), None


DATE_FIELDS = {"入职时间", "入职日期", "转正日期", "离职时间", "离职日期", "生效日期"}
AMOUNT_FIELDS = {
    "转正固定薪资",
    "转正绩效标准",
    "试用期底薪",
    "试用期绩效",
    "年薪（万元）",
    "固定薪资",
    "绩效基数",
}


def resolve_employee_formulas(
    raw: dict[str, str],
    number: int,
    headers: tuple[str, ...],
    formula_fields: set[str] | None = None,
) -> tuple[dict[str, str], list[dict[str, str]]]:
    """Resolve one employee row, also used when correcting persisted import errors."""
    fields = (
        formula_fields
        if formula_fields is not None
        else {
            field
            for field, value in raw.items()
            if field in DATE_FIELDS | AMOUNT_FIELDS and value.startswith("=")
        }
    )
    resolved = dict(raw)
    results: dict[str, FormulaValue] = {}
    visiting: set[str] = set()

    def resolve(field: str) -> FormulaValue:
        if field not in DATE_FIELDS | AMOUNT_FIELDS:
            raise UnsupportedFormula("公式只能引用本行日期或薪资列")
        if field in results:
            return results[field]
        if field in visiting:
            raise ValueError("公式存在循环引用")
        visiting.add(field)
        try:
            if field in fields:
                value = evaluate_formula(raw[field], reference)
            elif field in DATE_FIELDS:
                value = date.fromisoformat(raw[field])
            else:
                value = Decimal(raw[field])
            if field in DATE_FIELDS:
                if not isinstance(value, date):
                    raise ValueError("公式结果须为日期")
            elif not isinstance(value, Decimal) or not value.is_finite() or value < 0:
                raise ValueError("公式来源和结果须为非负有效金额")
            results[field] = value
            return value
        finally:
            visiting.remove(field)

    def reference(coordinate: str) -> FormulaValue:
        column, row = coordinate_from_string(coordinate)
        index = column_index_from_string(column) - 1
        if row != number or index >= len(headers):
            raise UnsupportedFormula("公式只能引用同一行的模板单元格")
        return resolve(headers[index])

    errors = []
    for field in headers:
        if field not in fields:
            continue
        try:
            result = resolve(field)
            resolved[field] = result.isoformat() if isinstance(result, date) else str(result)
        except (ValueError, DecimalException, OverflowError) as exc:
            letter = get_column_letter(headers.index(field) + 1)
            errors.append(
                {
                    "code": "FORMULA_NOT_ALLOWED"
                    if isinstance(exc, UnsupportedFormula)
                    else "INVALID_DATE"
                    if field in DATE_FIELDS
                    else "INVALID_AMOUNT",
                    "field": field,
                    "column": letter,
                    "cell": f"{letter}{number}",
                    "message": "公式无法计算：来源不是有效数值、除数为零或数值超出范围"
                    if isinstance(exc, DecimalException)
                    else f"公式无法计算：{exc}",
                }
            )
    return resolved, errors


def parse_workbook(content: bytes) -> list[WorkbookRow]:
    try:
        workbook = load_workbook(
            BytesIO(content), read_only=False, data_only=False, keep_links=False
        )
    except Exception as exc:
        raise WorkbookFormatError("Excel 文件无法读取") from exc
    try:
        if workbook.sheetnames != [SHEET_NAME]:
            raise WorkbookFormatError("工作表不匹配，请使用员工资料固定模板")
        sheet = workbook[SHEET_NAME]
        headers = {
            TEMPLATE_VERSION: HEADERS,
            LEGACY_TEMPLATE_VERSION: LEGACY_HEADERS,
        }.get(sheet["A1"].value)
        if headers is None:
            raise WorkbookFormatError(f"模板版本不匹配，需要 {TEMPLATE_VERSION}")
        if tuple(sheet.cell(2, col).value for col in range(1, len(headers) + 1)) != headers:
            raise WorkbookFormatError("模板表头或列顺序不匹配")
        if any(
            sheet.cell(2, col).value is not None
            for col in range(len(headers) + 1, sheet.max_column + 1)
        ):
            raise WorkbookFormatError("模板表头或列顺序不匹配")
        if sheet.max_row - 2 > MAX_ROWS:
            raise WorkbookFormatError(f"单次最多导入 {MAX_ROWS} 行")
        rows = []
        for number in range(3, sheet.max_row + 1):
            raw: dict[str, str] = {}
            errors = []
            formulas = {}
            for column, field in enumerate(headers, 1):
                cell = sheet.cell(number, column)
                value, error = _value(cell, field)
                if cell.data_type == "f":
                    formulas[field] = value
                raw[field] = value
                if error and cell.data_type != "f":
                    errors.append(error)
            if any(raw.values()):
                raw, formula_errors = resolve_employee_formulas(raw, number, headers, set(formulas))
                rows.append(WorkbookRow(number, raw, [*errors, *formula_errors], formulas))
        if not rows:
            raise WorkbookFormatError("Excel 文件没有员工数据行")
        return rows
    finally:
        workbook.close()
