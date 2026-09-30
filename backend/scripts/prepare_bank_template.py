"""清除代发原模板历史样例与失效汇总，保留工作表、列和样式。"""

from pathlib import Path

from openpyxl import load_workbook

root = Path(__file__).resolve().parents[2]
book = load_workbook(root / "docs/代发工资模板.xlsx", keep_links=False)
for sheet in book:
    for row in sheet:
        for cell in row:
            cell.comment = None
            cell.hyperlink = None
            if cell.row > 1:
                cell.value = None
            elif cell.value == "金额":
                cell.value = "未扣个税金额"
    sheet.oddFooter.center.text = "未扣个税金额；需线下人工扣税核对后用于实际发薪"
book.defined_names.clear()
book.save(root / "backend/src/paylite/excel/templates/bank-v1.xlsx")
