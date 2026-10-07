"""A bounded formula subset for local imports; never executes Python or cached values."""

import ast
import calendar
import operator
import re
from collections.abc import Callable
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from openpyxl.formula.tokenizer import Token, Tokenizer, TokenizerError

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
