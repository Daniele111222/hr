"""A bounded formula subset for local imports; never executes Python or cached values."""

import ast
import calendar
import operator
import re
from collections.abc import Callable
from datetime import date
from decimal import ROUND_HALF_UP, Decimal, DecimalException

from openpyxl.formula.tokenizer import Token, Tokenizer, TokenizerError
from openpyxl.utils.cell import column_index_from_string, coordinate_from_string, get_column_letter

FormulaValue = Decimal | date


class UnsupportedFormula(ValueError):
    pass


def _round(value: FormulaValue, digits: FormulaValue) -> Decimal:
    if not isinstance(value, Decimal) or not isinstance(digits, Decimal):
        raise ValueError("ROUND 的参数须为数值")
    if digits != digits.to_integral_value() or not -16 <= digits <= 16:
        raise ValueError("ROUND 的小数位数须为 -16 至 16 的整数")
    return value.quantize(Decimal(1).scaleb(-int(digits)), rounding=ROUND_HALF_UP)


def _edate(start: FormulaValue, months: FormulaValue) -> date:
    if not isinstance(start, date) or not isinstance(months, Decimal):
        raise ValueError("EDATE 需要有效日期和整数月数")
    if months != months.to_integral_value() or not -120000 <= months <= 120000:
        raise ValueError("EDATE 月数须为有效整数")
    year, month = divmod(start.year * 12 + start.month - 1 + int(months), 12)
    month += 1
    return date(year, month, min(start.day, calendar.monthrange(year, month)[1]))


FUNCTIONS = {"ROUND": _round, "EDATE": _edate}
OPERATORS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
}


def evaluate_formula(formula: str, resolve_cell: Callable[[str], FormulaValue]) -> FormulaValue:
    if len(formula) > 1024 or not formula.startswith("="):
        raise UnsupportedFormula("公式过长或格式无效")
    try:
        parts = []
        for token in Tokenizer(formula).items:
            if token.type == Token.WSPACE:
                parts.append(" ")
                continue
            if token.type == Token.OPERAND:
                if token.subtype == Token.NUMBER:
                    if not re.fullmatch(r"(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?", token.value):
                        raise UnsupportedFormula("公式中的数值格式无效")
                    parts.append(token.value)
                elif token.subtype == Token.RANGE and re.fullmatch(
                    r"\$?[A-Za-z]{1,3}\$?[1-9]\d*", token.value
                ):
                    parts.append(token.value.replace("$", ""))
                else:
                    raise UnsupportedFormula("仅支持数值和单个单元格引用")
            elif token.type in (Token.OP_PRE, Token.OP_IN) and token.value in "+-*/":
                parts.append(token.value)
            elif token.type in (Token.FUNC, Token.PAREN) or (
                token.type == Token.SEP and token.subtype == Token.ARG
            ):
                parts.append(token.value)
            else:
                raise UnsupportedFormula("公式运算符不受支持")
        expression = "".join(parts).strip()
        root = ast.parse(expression, mode="eval")
    except (SyntaxError, RecursionError, TokenizerError, IndexError) as exc:
        raise UnsupportedFormula("公式语法不受支持") from exc
    if sum(1 for _ in ast.walk(root)) > 128:
        raise UnsupportedFormula("公式过于复杂，请先转为实际值")

    def calculate(node: ast.AST) -> FormulaValue:
        if isinstance(node, ast.Constant) and type(node.value) in (int, float):
            value = Decimal(ast.get_source_segment(expression, node))
            if not value.is_finite():
                raise ValueError("公式包含无效数值")
            return value
        if isinstance(node, ast.Name) and re.fullmatch(r"[A-Za-z]{1,3}[1-9]\d*", node.id):
            return resolve_cell(node.id.upper())
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            value = calculate(node.operand)
            if not isinstance(value, Decimal):
                raise ValueError("加减运算需要数值")
            return value if isinstance(node.op, ast.UAdd) else -value
        if isinstance(node, ast.BinOp) and type(node.op) in OPERATORS:
            left, right = calculate(node.left), calculate(node.right)
            if not isinstance(left, Decimal) or not isinstance(right, Decimal):
                raise ValueError("四则运算需要数值")
            return OPERATORS[type(node.op)](left, right)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            name = node.func.id.upper()
            if name not in FUNCTIONS:
                raise UnsupportedFormula(f"暂不支持函数 {name}，请先转为实际值")
            if len(node.args) != 2 or node.keywords:
                raise UnsupportedFormula(f"{name} 需要两个参数")
            return FUNCTIONS[name](*(calculate(argument) for argument in node.args))
        raise UnsupportedFormula("仅支持单元格引用、四则运算、括号、ROUND 和 EDATE")

    return calculate(root.body)


def resolve_row_formulas(
    raw: dict[str, str],
    number: int,
    headers: tuple[str, ...],
    date_fields: set[str],
    numeric_fields: set[str],
    *,
    formula_fields: set[str] | None = None,
    target_fields: set[str] | None = None,
    blank_numeric_zero: bool = False,
    number_error_code: str = "INVALID_NUMBER",
) -> tuple[dict[str, str], list[dict[str, str]]]:
    """Resolve dependencies within one import row using the bounded formula engine."""
    fields = (
        formula_fields
        if formula_fields is not None
        else {
            field
            for field, value in raw.items()
            if field in date_fields | numeric_fields and value.startswith("=")
        }
    )
    resolved = dict(raw)
    results: dict[str, FormulaValue] = {}
    visiting: set[str] = set()

    def resolve(field: str) -> FormulaValue:
        if field not in date_fields | numeric_fields:
            raise UnsupportedFormula("公式只能引用本行允许的日期或数值列")
        if field in results:
            return results[field]
        if field in visiting:
            raise ValueError("公式存在循环引用")
        visiting.add(field)
        try:
            if field in fields:
                value = evaluate_formula(raw[field], reference)
            elif field in date_fields:
                value = date.fromisoformat(raw[field])
            else:
                value = Decimal(raw[field] or "0") if blank_numeric_zero else Decimal(raw[field])
            if field in date_fields:
                if not isinstance(value, date):
                    raise ValueError("公式结果须为日期")
            elif not isinstance(value, Decimal) or not value.is_finite() or value < 0:
                raise ValueError("公式来源和结果须为非负有效数值")
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
        if field not in fields or (target_fields is not None and field not in target_fields):
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
                    if field in date_fields
                    else number_error_code,
                    "field": field,
                    "column": letter,
                    "cell": f"{letter}{number}",
                    "message": "公式无法计算：来源不是有效数值、除数为零或数值超出范围"
                    if isinstance(exc, DecimalException)
                    else f"公式无法计算：{exc}",
                }
            )
    return resolved, errors
