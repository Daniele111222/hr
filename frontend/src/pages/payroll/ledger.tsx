import { ArrowLeftOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Card,
  Empty,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from "antd";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { resources } from "../../shared/api/resources";
import styles from "./ledger.module.less";

const money = (value?: string) => {
  if (value === undefined) return "—";
  const [whole, fraction = ""] = value.split(".");
  return `¥${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction.padEnd(2, "0")}`;
};

export function PayrollLedgerPage() {
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState<{
    subject_id?: number;
    department?: string;
    employee_id?: number;
  }>({});
  const requestedPeriod = Number(params.get("period_id"));
  const workbench = useQuery({
    queryKey: ["payroll", "workbench"],
    queryFn: () => resources.payrollWorkbench(),
  });
  const periodId =
    Number.isInteger(requestedPeriod) && requestedPeriod > 0
      ? requestedPeriod
      : workbench.data?.period?.id;
  const ledger = useQuery({
    queryKey: ["payroll", "ledger", periodId, filters],
    queryFn: () => resources.payrollLedger(periodId!, filters),
    enabled: Boolean(periodId),
  });
  const periodOptions = useMemo(
    () =>
      (workbench.data?.periods ?? []).map((period) => ({
        value: period.id,
        label: period.period,
      })),
    [workbench.data],
  );

  if (ledger.isLoading || workbench.isLoading)
    return <Spin tip="正在加载工资台账…" />;
  if (ledger.error || workbench.error)
    return (
      <Alert
        type="error"
        showIcon
        title="工资台账加载失败"
        description={(ledger.error ?? workbench.error)?.message}
      />
    );
  if (!ledger.data) return <Empty description="尚无可查询的工资台账" />;

  const data = ledger.data;
  const subjectOptions = Array.from(
    new Map(
      data.records.map((row) => [
        row.subject_id,
        { value: row.subject_id, label: row.subject_name },
      ]),
    ).values(),
  );
  const departmentOptions = Array.from(
    new Set(
      data.records
        .map((row) => row.snapshot.department_name)
        .filter((value): value is string => typeof value === "string"),
    ),
  ).map((value) => ({ value, label: value }));
  const employeeOptions = data.records.map((row) => ({
    value: row.employee_id,
    label: `${String(row.snapshot.name ?? "—")} · ${String(row.snapshot.employee_no ?? "—")}`,
  }));
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <Typography.Title level={2}>工资台账与汇总</Typography.Title>
          <p>仅统计已确认或已锁定的正式工资结果，历史金额使用计算时快照。</p>
        </div>
        <Link to="/payroll">
          <ArrowLeftOutlined /> 返回工资期间与批次
        </Link>
      </header>
      <Alert
        type="info"
        showIcon
        title={data.untaxed_tax_notice}
        description="个税由线下 Excel 手工计算，系统不把未知税额当作零。"
      />
      <Card size="small">
        <Space wrap>
          <Select
            value={periodId}
            options={periodOptions}
            placeholder="选择工资期间"
            onChange={(value) => {
              setParams({ period_id: String(value) });
              setFilters({});
            }}
          />
          <Select
            allowClear
            placeholder="按主体"
            options={subjectOptions}
            value={filters.subject_id}
            onChange={(value) =>
              setFilters((current) => ({ ...current, subject_id: value }))
            }
          />
          <Select
            allowClear
            placeholder="按部门"
            options={departmentOptions}
            value={filters.department}
            onChange={(value) =>
              setFilters((current) => ({ ...current, department: value }))
            }
          />
          <Select
            allowClear
            showSearch
            placeholder="按员工"
            options={employeeOptions}
            value={filters.employee_id}
            onChange={(value) =>
              setFilters((current) => ({ ...current, employee_id: value }))
            }
          />
        </Space>
        <div className={styles.metrics}>
          <div className={styles.metric}>
            <span>台账期间</span>
            <strong>{data.period}</strong>
          </div>
          <div className={styles.metric}>
            <span>参与人数</span>
            <strong>{data.record_count}</strong>
          </div>
          <div className={styles.metric}>
            <span>应发金额合计</span>
            <strong>{money(data.totals.gross)}</strong>
          </div>
          <div className={styles.metric}>
            <span>未扣个税金额合计</span>
            <strong>{money(data.totals.untaxed_amount)}</strong>
          </div>
        </div>
      </Card>
      <Card title="工资记录">
        {data.records.length ? (
          <Table
            rowKey="id"
            size="small"
            scroll={{ x: 900 }}
            dataSource={data.records}
            columns={[
              {
                title: "员工",
                render: (_: unknown, row) => (
                  <>
                    <strong>{String(row.snapshot.name ?? "—")}</strong>
                    <div>{String(row.snapshot.employee_no ?? "—")}</div>
                  </>
                ),
              },
              { title: "主体", dataIndex: "subject_name" },
              {
                title: "部门",
                render: (_: unknown, row) =>
                  String(row.snapshot.department_name ?? "—"),
              },
              {
                title: "应发金额",
                align: "right",
                render: (_: unknown, row) => money(row.amounts.gross),
              },
              {
                title: "个人扣缴",
                align: "right",
                render: (_: unknown, row) => money(row.amounts.deduction),
              },
              {
                title: "未扣个税金额",
                align: "right",
                render: (_: unknown, row) => money(row.amounts.untaxed_amount),
              },
              {
                title: "状态",
                render: (_: unknown, row) => (
                  <Tag
                    color={
                      row.calculation_status === "locked"
                        ? "success"
                        : "processing"
                    }
                  >
                    {row.calculation_status === "locked" ? "已锁定" : "已确认"}
                  </Tag>
                ),
              },
            ]}
          />
        ) : (
          <Empty description="当前期间尚无已确认或已锁定的工资记录" />
        )}
      </Card>
    </div>
  );
}
