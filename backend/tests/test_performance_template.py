from io import BytesIO

from openpyxl import load_workbook

from paylite.excel.performance_template import make_template, parse_workbook


def test_performance_template_keeps_zero_and_reports_formula() -> None:
    workbook = load_workbook(BytesIO(make_template()))
    sheet = workbook["月度绩效"]
    sheet.append(["11010119900101123X", "张三", "0", "绩效表"])
    sheet.append(["11010119900101124X", "李四", "=1+1", "绩效表"])
    output = BytesIO()
    workbook.save(output)

    rows = parse_workbook(output.getvalue())
    assert rows[0].raw["绩效系数"] == "0"
    assert rows[0].errors == []
    assert rows[1].errors[0]["code"] == "FORMULA_NOT_ALLOWED"
