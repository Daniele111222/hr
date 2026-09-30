"""Derive the runtime template; never ship historical sample payroll/tax data."""

from pathlib import Path

from openpyxl import load_workbook
from openpyxl.cell.cell import MergedCell

root = Path(__file__).resolve().parents[2]
book = load_workbook(root / "docs/工资表模板.xlsx", keep_links=False)
headers = {
    "汇总": 2,
    "工资表明细": 3,
    "考勤表": 2,
    "社保公积金明细": 2,
    "个税计算": 4,
    "个税上月累计情况": 3,
}
for sheet in book:
    for cell in list(sheet._cells.values()):
        if isinstance(cell, MergedCell):
            continue
        cell.comment = None
        cell.hyperlink = None
        if sheet.title == "导入模版（中汽）" and 12 <= cell.row <= 20:
            continue
        if cell.value == "=ROW()-1":
            cell.value = f'=IF(A{cell.row}="","",ROW()-1)'
            continue
        if cell.row > headers.get(sheet.title, 1) or cell.data_type in {"f", "e"}:
            cell.value = None
    sheet.auto_filter.ref = None
    sheet.print_area = None
book["汇总"]["B1"] = "工资情况（未扣个税金额）"
book["汇总"]["C2"] = "未扣个税金额"
book["工资表明细"]["A1"] = "未扣个税金额；个税由线下计算，核对后用于发薪"
for cell in ("AX2", "AX3"):
    book["工资表明细"][cell] = "未扣个税金额"
book["工资条"]["U1"] = "未扣个税金额"
for cell in ("P1", "Q1"):
    book["考勤表"][cell] = None
for cell in ("D1", "BK1"):
    book["个税计算"][cell] = None
book.defined_names.clear()
book.save(root / "backend/src/paylite/excel/templates/payroll-v1.xlsx")
