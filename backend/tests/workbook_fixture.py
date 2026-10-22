"""Synthetic original-format workbook shared by adapter and deployment checks."""

from datetime import date
from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

from openpyxl import Workbook

from paylite.excel.attendance_template import REFERENCE_HEADERS
from paylite.excel.employee_template import HEADERS


def source_workbook(*, oversized_dimension: bool = False) -> bytes:
    workbook = Workbook()
    roster = workbook.active
    roster.title = "花名册"
    roster.append(("序号", *HEADERS))
    employee = dict.fromkeys(HEADERS, "")
    employee.update(
        证件号码="11010120000101002X",
        姓名="合成员工",
        公司主体全称="北京合成有限公司",
        一级部门="研发",
        岗位="工程师",
        职级="P6",
        入职时间=date(2026, 8, 12),
        转正日期="=EDATE(N2,3)",
        银行卡号="000123456789012345",
        开户行="合成银行",
        转正固定薪资=8000,
        试用期底薪=8000,
    )
    roster.append((1, *(employee[field] for field in HEADERS)))
    roster.append((2, "", "缺身份的输入"))
    roster.cell(1000, 1, 1000)  # 序号独立存在不成为资料记录。
    attendance = workbook.create_sheet("考勤表")
    attendance["P1"] = date(2026, 8, 31)
    attendance["Q1"] = date(2026, 8, 1)
    # 原工作簿比单项 v2 多三列加班时长、三列加班费与全勤奖/合计。
    headers = (
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
    for column, header in enumerate(headers, 1):
        attendance.cell(2, column, header)
    attendance["A3"] = "=花名册!B2"
    attendance["B3"] = '=VLOOKUP(A3&"*",花名册!B:C,2,0)'
    attendance["C3"] = "=INDEX(花名册!E:E,MATCH(A3,花名册!B:B,0))"
    attendance["T3"] = "=NETWORKDAYS(Q1,P1)"
    attendance["AV3"] = '=WEBSERVICE("https://example.invalid")'
    workbook.create_sheet("工资表明细")["A1"] = "=1/0"
    output = BytesIO()
    workbook.save(output)
    if not oversized_dimension:
        return output.getvalue()
    modified = BytesIO()
    with ZipFile(output) as source, ZipFile(modified, "w", ZIP_DEFLATED) as target:
        for info in source.infolist():
            payload = source.read(info)
            if info.filename == "xl/worksheets/sheet1.xml":
                payload = payload.replace(b"A1:AB1000", b"A1:AB1048573")
            target.writestr(info, payload)
    return modified.getvalue()
