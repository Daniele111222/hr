"""Fixed original-workbook mapping; computed salaries never become monthly inputs."""

import re
import time
from copy import copy
from dataclasses import dataclass
from dataclasses import field as dataclass_field
from datetime import date, datetime
from io import BytesIO
from pathlib import PurePosixPath
from xml.etree import ElementTree
from zipfile import BadZipFile, ZipFile

from openpyxl import Workbook, load_workbook
from openpyxl.formula import Tokenizer
from openpyxl.utils import get_column_letter, range_boundaries

from paylite.excel.attendance_template import HEADERS as ATTENDANCE_HEADERS
from paylite.excel.attendance_template import REFERENCE_HEADERS
from paylite.excel.employee_template import (
    DATE_FIELDS,
    HEADERS,
    MAX_FILE_SIZE,
    MAX_ROWS,
    WorkbookFormatError,
    WorkbookRow,
    _value,
)

TEMPLATE_VERSION = "TPL-WORKBOOK-v1"
EMPLOYEE_SHEET = "花名册"
ATTENDANCE_SHEET = "考勤表"
NS = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
SOURCE_ATTENDANCE_HEADERS = (
    *REFERENCE_HEADERS[:37],
    "工作日加班时长",
    "休息日加班时长",
    "法定节假日加班时长",
    *REFERENCE_HEADERS[37:45],
    "工作日加班费",
    "休息日加班费",
    "法定节假日加班费",
    "全勤奖",
    "合计",
    *REFERENCE_HEADERS[45:],
)
ATTENDANCE_SOURCE_FIELDS = {
    "应出勤天数": "工作日天数合计",
    "迟到分钟": "迟到时长",
    "早退分钟": "早退时长",
    "未补卡次数": "缺卡次数",
}


@dataclass
class ParsedWorkbook:
    workbook: Workbook
    period: date
    employees: list[WorkbookRow]
    attendance: list[WorkbookRow]
    employee_mapping: dict[str, str]
    attendance_mapping: dict[str, str]
    populated_cells: dict[str, set[str]]


@dataclass
class EvaluationPlan:
    content: bytes
    dependencies: dict[str, list[str]]
    errors: dict[str, list[dict[str, str]]]
    lookup_roots: set[str]
    dependency_graph: dict[str, list[str]] = dataclass_field(default_factory=dict)


# Fixed source formulas only; unknown functions and dynamic/external references fail closed.
SAFE_FUNCTIONS = {
    "VLOOKUP",
    "INDEX",
    "MATCH",
    "IF",
    "IFS",
    "IFERROR",
    "AND",
    "OR",
    "NOT",
    "ROUND",
    "EDATE",
    "EOMONTH",
    "DATE",
    "YEAR",
    "MONTH",
    "DAY",
    "NETWORKDAYS",
    "COUNTIFS",
    "SUM",
    "MIN",
    "MAX",
    "COUNT",
    "COUNTA",
}
EMPLOYEE_INPUTS = {
    "证件号码",
    "姓名",
    "公司主体全称",
    "一级部门",
    "二级部门",
    "三级部门",
    "岗位",
    "职级",
    "入职时间",
    "转正日期",
    "离职时间",
    "银行卡号",
    "开户行",
    "转正固定薪资",
    "试用期底薪",
}
REFERENCE = re.compile(
    r"\$?[A-Za-z]{1,3}(?:\$?[1-9][0-9]{0,6})?"
    r"(?::\$?[A-Za-z]{1,3}(?:\$?[1-9][0-9]{0,6})?)?\Z"
)


def _formula(cell) -> str | None:
    if cell.data_type != "f":
        return None
    return cell.value if isinstance(cell.value, str) else cell.value.text


def _location(parsed: ParsedWorkbook, sheet: str, value: str) -> tuple[str, str]:
    if "!" in value:
        sheet, value = value.rsplit("!", 1)
        sheet = sheet.strip("'").replace("''", "'")
    if sheet not in parsed.populated_cells or not REFERENCE.fullmatch(value):
        raise ValueError(f"不支持的引用 {value}")
    left, _, right, bottom = range_boundaries(value)
    if not left or not right or right > 16_384 or (bottom or 1) > 1_048_576:
        raise ValueError(f"无效引用 {value}")
    return sheet, value.replace("$", "").upper()


def _range_cells(parsed: ParsedWorkbook, key: tuple[str, str], ranges: dict) -> list[str]:
    if key not in ranges:
        name, location = key
        left, top, right, bottom = range_boundaries(location)
        ranges[key] = [
            coordinate
            for coordinate in parsed.populated_cells[name]
            if left <= parsed.workbook[name][coordinate].column <= right
            and (top or 1) <= parsed.workbook[name][coordinate].row <= (bottom or 1_048_576)
        ]
    return ranges[key]


def _arguments(tokens, start):
    arguments, current, depth = [], [], 1
    for index in range(start + 1, len(tokens)):
        token = tokens[index]
        if token.subtype == "OPEN":
            depth += 1
        elif token.subtype == "CLOSE":
            depth -= 1
            if depth == 0:
                return [*arguments, current], index
        if token.type == "SEP" and token.subtype == "ARG" and depth == 1:
            arguments.append(current)
            current = []
        elif token.type != "WHITE-SPACE":
            current.append((index, token))
    raise ValueError("公式参数无效")


def _text_query(parsed: ParsedWorkbook, sheet: str, argument, seen=frozenset()):
    if len(seen) > 32:
        return None
    result, operand = "", True
    for _, token in argument:
        if not operand and token.type == "OPERATOR-INFIX" and token.value == "&":
            operand = True
            continue
        if not operand or token.type != "OPERAND":
            return None
        if token.subtype == "TEXT":
            value = token.value[1:-1].replace('""', '"')
        elif token.subtype == "RANGE":
            key = _location(parsed, sheet, token.value)
            if ":" in key[1] or key in seen:
                return None
            cell = parsed.workbook[key[0]][key[1]]
            if not hasattr(cell, "data_type"):
                return None
            value = cell.value
            if cell.data_type == "f":
                value = _text_query(
                    parsed, key[0], list(enumerate(Tokenizer(_formula(cell)).items)), seen | {key}
                )
        else:
            return None
        if not isinstance(value, str):
            return None
        result += value
        operand = False
    return result if not operand else None


def _lookup_rows(parsed, key, query, ranges, indexes):
    if query is None:
        return None
    if key not in indexes:
        exact, prefixes = {}, {}
        for coordinate in _range_cells(parsed, key, ranges):
            cell = parsed.workbook[key[0]][coordinate]
            if cell.data_type in {"f", "e"}:
                indexes[key] = None
                break
            if isinstance(cell.value, str):
                text = cell.value.casefold()
                exact.setdefault(text, []).append(cell.row)
                prefixes.setdefault(text[:18], []).append(cell.row)
        else:
            indexes[key] = (exact, prefixes)
    index = indexes[key]
    if index is None:
        return None
    if query.endswith("*") and len(query) == 19 and "?" not in query:
        return index[1].get(query[:-1].casefold(), [])
    if "*" in query or "?" in query or "~" in query:
        return None
    return index[0].get(query.casefold(), [])


def _references(parsed: ParsedWorkbook, sheet: str, formula: str, ranges: dict, indexes: dict):
    if len(formula) > 4096:
        raise ValueError("公式过长")
    tokens = Tokenizer(formula).items
    if len(tokens) > 512:
        raise ValueError("公式过于复杂")
    references, lookup, overrides = set(), False, {}
    for index, token in enumerate(tokens):
        if token.type == "FUNC" and token.subtype == "OPEN":
            function = token.value[:-1].removeprefix("_xlfn.").upper()
            if function not in SAFE_FUNCTIONS:
                raise ValueError(f"不支持的函数 {function}")
            lookup |= function in {"VLOOKUP", "MATCH"}
            arguments, _ = _arguments(tokens, index)
            if function not in {"VLOOKUP", "INDEX"} or len(arguments) < 2:
                continue
            table_arg = arguments[1] if function == "VLOOKUP" else arguments[0]
            if len(table_arg) != 1 or table_arg[0][1].subtype != "RANGE":
                continue
            table_index, table_token = table_arg[0]
            target, location = _location(parsed, sheet, table_token.value)
            left, top, right, bottom = range_boundaries(location)
            rows = None
            if function == "VLOOKUP" and len(arguments) >= 3 and len(arguments[2]) == 1:
                value = arguments[2][0][1]
                if value.subtype != "NUMBER" or not value.value.isdecimal():
                    continue
                column = left + int(value.value) - 1
                if not left <= column <= right:
                    raise ValueError("查找返回列超出范围")
                letter = get_column_letter(left)
                key = (target, f"{letter}{top or 1}:{letter}{bottom or 1_048_576}")
                query = _text_query(parsed, sheet, arguments[0])
                if (
                    len(arguments) == 4
                    and len(arguments[3]) == 1
                    and arguments[3][0][1].value in {"0", "FALSE"}
                ):
                    rows = _lookup_rows(parsed, key, query, ranges, indexes)
                references.add(key)
            elif (
                function == "INDEX"
                and left == right
                and arguments[1]
                and arguments[1][0][1].value.upper() == "MATCH("
            ):
                match_arguments, match_end = _arguments(tokens, arguments[1][0][0])
                if (
                    match_end != arguments[1][-1][0]
                    or len(match_arguments) != 3
                    or len(match_arguments[1]) != 1
                    or len(match_arguments[2]) != 1
                    or match_arguments[2][0][1].value != "0"
                ):
                    continue
                key = _location(parsed, sheet, match_arguments[1][0][1].value)
                key_left, key_top, key_right, _ = range_boundaries(key[1])
                if key_left != key_right:
                    continue
                query = _text_query(parsed, sheet, match_arguments[0])
                found = _lookup_rows(parsed, key, query, ranges, indexes)
                rows = (
                    [row - (key_top or 1) + (top or 1) for row in found]
                    if found is not None
                    else None
                )
                column = left
            else:
                continue
            letter = get_column_letter(column)
            overrides[table_index] = (
                {(target, f"{get_column_letter(column)}{row}") for row in rows}
                if rows is not None
                else {
                    (
                        target,
                        f"{letter}{top or 1}:{letter}{bottom or 1_048_576}",
                    )
                }
            )
    for index, token in enumerate(tokens):
        if token.type != "OPERAND" or token.subtype != "RANGE":
            continue
        references.update(overrides.get(index, {_location(parsed, sheet, token.value)}))
    return references, lookup


def prepare_evaluation(parsed: ParsedWorkbook) -> EvaluationPlan:
    """Create a fresh workbook without macros, links, names, cached values or unrelated formulas."""
    safe = Workbook()
    safe.remove(safe.active)
    dependencies, errors, included, graph = {}, {}, set(), {}
    ranges, completed, indexes = {}, {}, {}
    lookup_roots = set()
    deadline, edge_count = time.monotonic() + 20, 0

    def visit(sheet_name: str, cell_coordinate: str, visiting: set) -> bool:
        nonlocal edge_count
        if time.monotonic() > deadline or edge_count > 500_000:
            raise WorkbookFormatError("工作簿公式依赖超过处理预算，请减少本次输入")
        key = (sheet_name, cell_coordinate)
        if key in visiting:
            raise ValueError(f"循环依赖 {sheet_name}!{cell_coordinate}")
        if key in completed:
            return completed[key]
        visiting.add(key)
        lookup = False
        if ":" in cell_coordinate:
            references = {
                (sheet_name, coordinate) for coordinate in _range_cells(parsed, key, ranges)
            }
        else:
            cell = parsed.workbook[sheet_name][cell_coordinate]
            formula = _formula(cell)
            references = set()
            if formula:
                references, lookup = _references(parsed, sheet_name, formula, ranges, indexes)
            elif cell.data_type == "e":
                raise ValueError(f"依赖含 Excel 错误 {sheet_name}!{cell_coordinate}")
        edge_count += len(references)
        for target in references:
            lookup |= visit(*target, visiting)
        if references:
            graph[f"{sheet_name}!{cell_coordinate}"] = sorted(
                f"{sheet}!{cell}" for sheet, cell in references
            )
        if ":" not in cell_coordinate:
            included.add(key)
        visiting.remove(key)
        completed[key] = lookup
        return completed[key]

    for name, rows, mapping, fields in (
        (EMPLOYEE_SHEET, parsed.employees, parsed.employee_mapping, EMPLOYEE_INPUTS),
        (ATTENDANCE_SHEET, parsed.attendance, parsed.attendance_mapping, ATTENDANCE_HEADERS),
    ):
        for row in rows:
            for field in fields:
                coordinate = f"{mapping[field]}{row.number}"
                root = f"{name}!{field}!{row.number}"
                try:
                    lookup = visit(name, coordinate, set())
                except WorkbookFormatError:
                    raise
                except (ValueError, RecursionError) as exc:
                    errors[root] = [
                        {
                            "code": "UNSAFE_DEPENDENCY",
                            "sheet_name": name,
                            "field": field,
                            "column": mapping[field],
                            "cell": coordinate,
                            "message": str(exc) or "公式依赖过深",
                        }
                    ]
                    continue
                node = f"{name}!{coordinate}"
                if node in graph:
                    dependencies[root] = [node]
                if lookup:
                    lookup_roots.add(root)
    for name, coordinate in sorted(included):
        if name not in safe.sheetnames:
            safe.create_sheet(name)
        source = parsed.workbook[name][coordinate]
        destination = safe[name][coordinate]
        destination.value = copy(source.value)
        destination.number_format = source.number_format
    for row in parsed.employees:
        for field in DATE_FIELDS & EMPLOYEE_INPUTS:
            cell = f"{parsed.employee_mapping[field]}{row.number}"
            if (EMPLOYEE_SHEET, cell) in included:
                safe[EMPLOYEE_SHEET][cell].number_format = "yyyy-mm-dd"
    if not safe.sheetnames:
        safe.create_sheet("无可求值输入")
    output = BytesIO()
    safe.save(output)
    return EvaluationPlan(output.getvalue(), dependencies, errors, lookup_roots, graph)


def changed_dependencies(plan: EvaluationPlan, roots: list[str], changed: set[str]) -> bool:
    pending = [node for root in roots for node in plan.dependencies.get(root, [])]
    visited = set()
    while pending:
        node = pending.pop()
        if node in visited:
            continue
        visited.add(node)
        if node in changed:
            return True
        name, location = node.rsplit("!", 1)
        if ":" in location:
            left, top, right, bottom = range_boundaries(location)
            for changed_node in changed:
                changed_name, coordinate = changed_node.rsplit("!", 1)
                col, row, _, _ = range_boundaries(coordinate)
                if (
                    name == changed_name
                    and left <= col <= right
                    and (top or 1) <= row <= (bottom or 1_048_576)
                ):
                    return True
        pending.extend(plan.dependency_graph.get(node, []))
    return False


def read_evaluated(
    parsed: ParsedWorkbook, plan: EvaluationPlan, content: bytes
) -> tuple[list[WorkbookRow], list[WorkbookRow]]:
    try:
        output = load_workbook(BytesIO(content), data_only=True, keep_links=False)
    except Exception as exc:
        raise WorkbookFormatError("Excel 引擎输出无法读取，本次没有导入业务数据") from exc
    results = []
    for name, rows, mapping, fields in (
        (EMPLOYEE_SHEET, parsed.employees, parsed.employee_mapping, EMPLOYEE_INPUTS),
        (ATTENDANCE_SHEET, parsed.attendance, parsed.attendance_mapping, ATTENDANCE_HEADERS),
    ):
        evaluated = []
        for source in rows:
            raw = dict(source.raw)
            errors = list(source.errors)
            for field in fields:
                root = f"{name}!{field}!{source.number}"
                if root in plan.errors:
                    errors.extend(plan.errors[root])
                    continue
                coordinate = f"{mapping[field]}{source.number}"
                if name not in output.sheetnames:
                    raise WorkbookFormatError("Excel 引擎输出缺少必要工作表")
                raw[field], error = _value(output[name][coordinate], field)
                if error:
                    errors.append({**error, "sheet_name": name})
            evaluated.append(WorkbookRow(source.number, raw, errors, source.formulas))
        results.append(evaluated)
    return results[0], results[1]


def _sheet_cells(content: bytes) -> dict[str, set[str]]:
    """Use actual XML cells rather than Excel's potentially million-row dimension."""
    with ZipFile(BytesIO(content)) as archive:
        if sum(item.file_size for item in archive.infolist()) > 64 * 1024 * 1024:
            raise WorkbookFormatError("Excel 解压内容超过 64MB")
        workbook = ElementTree.fromstring(archive.read("xl/workbook.xml"))
        relations = ElementTree.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        targets = {
            item.attrib["Id"]: item.attrib["Target"]
            for item in relations
            if item.attrib.get("TargetMode") != "External"
        }
        populated = {}
        for sheet in workbook.find("x:sheets", NS):
            relationship = sheet.attrib[
                "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
            ]
            target = targets[relationship]
            path = target.lstrip("/") if target.startswith("/") else f"xl/{target}"
            if ".." in PurePosixPath(path).parts:
                raise WorkbookFormatError("Excel 工作表路径无效")
            root = ElementTree.fromstring(archive.read(path))
            populated[sheet.attrib["name"]] = {
                cell.attrib["r"]
                for cell in root.findall("x:sheetData/x:row/x:c", NS)
                if any(cell.find(f"x:{tag}", NS) is not None for tag in ("v", "f", "is"))
            }
            if sum(len(cells) for cells in populated.values()) > 250_000:
                raise WorkbookFormatError("Excel 有效单元格过多")
        return populated


def _rows(
    workbook: Workbook,
    populated: set[str],
    name: str,
    mapping: dict[str, str],
    first: int,
    corrected_rows: set[int],
) -> list[WorkbookRow]:
    sheet = workbook[name]
    fields = EMPLOYEE_INPUTS if name == EMPLOYEE_SHEET else set(ATTENDANCE_HEADERS)
    numbers = sorted(
        {sheet[coordinate].row for coordinate in populated if sheet[coordinate].row >= first}
    )
    results = []
    for number in numbers:
        raw, formulas, errors = {}, {}, []
        for field, column in mapping.items():
            cell = sheet[f"{column}{number}"]
            if cell.data_type == "f":
                formula = cell.value if isinstance(cell.value, str) else cell.value.text
                raw[field] = formula
                formulas[field] = formula
            else:
                raw[field], error = _value(cell, field)
                if error and field in fields:
                    errors.append(error)
        # A standalone sequence number and formatting do not constitute an input row.
        if number not in corrected_rows and not any(raw[field] for field in fields):
            continue
        results.append(WorkbookRow(number, raw, errors, formulas))
        if len(results) > MAX_ROWS:
            raise WorkbookFormatError(f"{name}最多支持 {MAX_ROWS} 条有效记录")
    return results


def parse_workbook(
    content: bytes,
    selected_period: date,
    corrections: dict[tuple[str, int], dict[str, str]] | None = None,
) -> ParsedWorkbook:
    if len(content) > MAX_FILE_SIZE:
        raise WorkbookFormatError("Excel 文件不能超过 20MB")
    try:
        populated = _sheet_cells(content)
        workbook = load_workbook(BytesIO(content), data_only=False, keep_links=False)
    except WorkbookFormatError:
        raise
    except (BadZipFile, KeyError, ValueError, ElementTree.ParseError, OSError) as exc:
        raise WorkbookFormatError("Excel 文件无法读取") from exc
    if not {EMPLOYEE_SHEET, ATTENDANCE_SHEET}.issubset(workbook.sheetnames):
        raise WorkbookFormatError("缺少固定结构的花名册或考勤表")
    for name, row, headers in (
        (EMPLOYEE_SHEET, 1, ("序号", *HEADERS)),
        (ATTENDANCE_SHEET, 2, SOURCE_ATTENDANCE_HEADERS),
    ):
        actual = tuple(
            str(workbook[name].cell(row, column).value or "").strip()
            for column in range(1, len(headers) + 1)
        )
        if actual != headers:
            raise WorkbookFormatError(f"{name}表头不匹配，请上传已约定的整本结构")
    cutoff = workbook[ATTENDANCE_SHEET]["P1"].value
    if isinstance(cutoff, datetime):
        cutoff = cutoff.date()
    if not isinstance(cutoff, date):
        raise WorkbookFormatError("考勤表 P1 考勤截止日期须为日期实际值")
    period = cutoff.replace(day=1)
    if period != selected_period.replace(day=1):
        raise WorkbookFormatError("来源考勤月份与所选工资期间不一致")
    employee_mapping = {field: get_column_letter(index + 2) for index, field in enumerate(HEADERS)}
    attendance_mapping = {
        field: get_column_letter(
            SOURCE_ATTENDANCE_HEADERS.index(ATTENDANCE_SOURCE_FIELDS.get(field, field)) + 1
        )
        for field in ATTENDANCE_HEADERS
    }
    for (name, number), values in (corrections or {}).items():
        mapping = employee_mapping if name == EMPLOYEE_SHEET else attendance_mapping
        for field, value in values.items():
            coordinate = f"{mapping[field]}{number}"
            if name == EMPLOYEE_SHEET and field in DATE_FIELDS and value:
                try:
                    value = date.fromisoformat(value)
                except ValueError:
                    pass  # Preserve invalid input for the shared date validator.
            workbook[name][coordinate] = value
            populated[name].add(coordinate)
    employees = _rows(
        workbook,
        populated[EMPLOYEE_SHEET],
        EMPLOYEE_SHEET,
        employee_mapping,
        2,
        {number for name, number in (corrections or {}) if name == EMPLOYEE_SHEET},
    )
    attendance = _rows(
        workbook,
        populated[ATTENDANCE_SHEET],
        ATTENDANCE_SHEET,
        attendance_mapping,
        3,
        {number for name, number in (corrections or {}) if name == ATTENDANCE_SHEET},
    )
    if not employees or not attendance:
        raise WorkbookFormatError("花名册与考勤表均须包含有效输入记录")
    return ParsedWorkbook(
        workbook,
        period,
        employees,
        attendance,
        employee_mapping,
        attendance_mapping,
        populated,
    )
