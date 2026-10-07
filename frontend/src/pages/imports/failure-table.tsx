import { Table, Typography } from "antd";
import type { ImportRow } from "../../shared/api/resources.ts";

export function ImportFailureTable({ rows }: { rows: ImportRow[] }) {
  const failures = rows.flatMap((row) =>
    (row.errors?.length ? row.errors : [null]).map((issue, index) => ({
      key: `${row.id}:${index}`,
      row,
      issue,
    })),
  );
  return (
    <Table
      aria-label="失败行原因"
      size="small"
      rowKey="key"
      dataSource={failures}
      scroll={{ x: 850 }}
      pagination={{ pageSize: 8, showSizeChanger: false }}
      locale={{ emptyText: "没有失败行" }}
      columns={[
        {
          title: "原始行号",
          width: 90,
          render: (_, item) => item.row.source_row_number,
        },
        {
          title: "工作表",
          width: 110,
          render: (_, item) => item.row.sheet_name,
        },
        {
          title: "姓名",
          width: 100,
          render: (_, item) => item.row.raw_data["姓名"] || "—",
        },
        {
          title: "字段 / 位置",
          width: 150,
          render: (_, item) =>
            item.issue
              ? `${item.issue.field}${item.issue.column ? `（${item.issue.column}${item.row.source_row_number}）` : ""}`
              : "—",
        },
        {
          title: "原始值",
          width: 150,
          render: (_, item) => {
            if (!item.issue) return "—";
            const original = item.row.raw_data[item.issue.field];
            const validated = item.row.correction_values?.[item.issue.field];
            return (
              <>
                <div>{original === "" ? "（空）" : (original ?? "—")}</div>
                {validated !== undefined && validated !== original && (
                  <Typography.Text type="secondary">
                    校验值：{validated || "（空）"}
                  </Typography.Text>
                )}
              </>
            );
          },
        },
        {
          title: "失败原因",
          render: (_, item) => item.issue?.message ?? "失败原因未提供",
        },
      ]}
    />
  );
}
