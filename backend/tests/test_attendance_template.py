from io import BytesIO

from openpyxl import load_workbook

from paylite.excel.attendance_template import make_template, parse_workbook


def test_attendance_template_preserves_identity_and_rejects_formula() -> None:
    workbook = load_workbook(BytesIO(make_template()))
    sheet = workbook["月度考勤"]
    sheet.append(["11010119900101123X", "张三", "20", 15, 0, "1.5", "0.5", 2, 1, "考勤系统"])
    sheet.append([110101199001011250, "李四", "=20", 0, 0, 0, 0, 0, 0, "考勤系统"])
    output = BytesIO()
    workbook.save(output)

    rows = parse_workbook(output.getvalue())
    assert rows[0].raw["身份证号"] == "11010119900101123X"
    assert rows[0].errors == []
    assert {item["code"] for item in rows[1].errors} == {
        "IDENTIFIER_NOT_TEXT",
        "FORMULA_NOT_ALLOWED",
    }
