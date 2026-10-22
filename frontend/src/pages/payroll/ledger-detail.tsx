import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Card,
  Descriptions,
  Empty,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from "antd";
import { Link, useParams } from "react-router-dom";
import { resources } from "../../shared/api/resources";
import { money } from "../../shared/money";
import styles from "./ledger.module.less";

const text = (value: unknown) => (value == null ? "—" : String(value));
const inputLabels: Record<string, string> = {
  month_days: "当月自然日",
  segments: "薪资生效区间",
  base: "计算基数",
  coefficient: "绩效系数",
  worked_days: "计薪自然日",
  fixed_salary: "固定月薪",
  expected_work_days: "应出勤天数",
  rate: "缴费比例",
  reason: "补发原因",
  pool: "激励池",
  eligible_count: "合格人数",
};
const mask = (value: unknown) =>
  typeof value === "string" && value.length > 8
    ? `${value.slice(0, 3)}${"*".repeat(value.length - 7)}${value.slice(-4)}`
    : text(value);

export function PayrollLedgerDetailPage() {
  const { recordId } = useParams();
  const id = Number(recordId);
  const detail = useQuery({
    queryKey: ["payroll", "ledger-record", id],
    queryFn: () => resources.payrollLedgerDetail(id),
    enabled: Number.isInteger(id) && id > 0,
  });
  if (!Number.isInteger(id) || id <= 0)
    return <Alert type="error" title="工资记录编号无效" />;
  if (detail.isPending) return <Spin tip="正在读取正式工资快照…" />;
  if (detail.error)
    return (
      <Alert
        type="error"
        showIcon
        title="员工计算明细加载失败"
        description={detail.error.message}
        action={<Link to="/payroll/ledger">返回台账</Link>}
      />
    );
  if (!detail.data) return <Empty description="尚无正式工资记录" />;
  const data = detail.data;
  const row = data.record;
  const steps = new Map(row.steps.map((step) => [String(step.code), step]));
  const social = row.items.filter(
    (item) =>
      String(item.code).startsWith("social_") ||
      String(item.code).startsWith("housing_"),
  );
  const fixedInputs = {
    ...steps.get("performance")?.inputs,
    ...steps.get("fixed_salary")?.inputs,
  } as Record<string, unknown>;
  const attendanceStep = row.steps.find((step) =>
    String(step.code).startsWith("attendance_"),
  );
  const attendanceInputs = attendanceStep?.inputs as
    Record<string, unknown> | undefined;
  const periodQuery = `?period_id=${data.period_id}`;
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <Typography.Title level={2}>
            {text(row.snapshot.name)} · 员工计算明细
          </Typography.Title>
          <p>
            {data.period} · {text(row.snapshot.employee_no)} ·{" "}
            {row.subject_name} · {text(row.snapshot.department_name)} ·{" "}
            {text(row.snapshot.position_title)} ·{" "}
            {text(row.snapshot.level_code)}
          </p>
        </div>
        <Space wrap>
          <Tag
            color={
              row.calculation_status === "locked" ? "success" : "processing"
            }
          >
            {row.calculation_status === "locked" ? "已锁定" : "已确认"}
          </Tag>
          <Link to={`/payroll/ledger${periodQuery}`}>返回工资台账</Link>
        </Space>
      </header>
      <Alert
        type={row.is_effective ? "info" : "warning"}
        showIcon
        title={
          row.is_effective
            ? data.untaxed_tax_notice
            : "此记录已被整批更正替代，仅用于历史追溯；金额为未扣个税金额。"
        }
        description="以下内容来自正式工资计算时快照，员工资料或规则后续变更不会改写历史金额。未保存的事实显示为 —。"
      />
      <div className={styles.metrics}>
        {[
          ["计薪自然日", text(fixedInputs?.worked_days)],
          ["应发金额", money(row.amounts.gross)],
          ["考勤扣款", money(row.amounts.attendance_deduction)],
          ["个人社保及公积金", money(row.amounts.deduction)],
          ["未扣个税金额", money(row.amounts.untaxed_amount)],
          ["公司成本", money(row.amounts.employer_cost)],
        ].map(([label, value]) => (
          <div className={styles.metric} key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <Card size="small" title="员工信息快照">
        <Descriptions
          size="small"
          column={{ xs: 1, sm: 2, lg: 3 }}
          items={[
            {
              key: "id",
              label: "身份证",
              children: mask(row.snapshot.id_number),
            },
            {
              key: "bank",
              label: "银行卡",
              children: mask(row.snapshot.bank_account),
            },
            {
              key: "city",
              label: "Base 城市",
              children: text(row.snapshot.base_city_name),
            },
            {
              key: "fixed",
              label: "固定月薪",
              children: money(row.snapshot.fixed_salary),
            },
            {
              key: "performance",
              label:
                row.snapshot.calculation_mode ===
                "monthly_without_performance_v1"
                  ? "计算口径"
                  : "绩效基数",
              children:
                row.snapshot.calculation_mode ===
                "monthly_without_performance_v1"
                  ? "月度不含绩效"
                  : money(row.snapshot.performance_base),
            },
            {
              key: "payment",
              label: "实际发放日期",
              children: row.payment_date ?? "未确认",
            },
          ]}
        />
      </Card>
      <Card size="small" title="收入与扣缴明细" extra="计算时公式与输入">
        <Table
          rowKey="code"
          size="small"
          pagination={false}
          scroll={{ x: 760 }}
          dataSource={row.items}
          locale={{ emptyText: "该记录未保存工资项" }}
          columns={[
            { title: "项目", render: (_, item) => text(item.name) },
            {
              title: "类别",
              render: (_, item) =>
                ({
                  income: "收入",
                  deduction: "扣款",
                  employer_cost: "公司缴纳",
                })[String(item.category)] ?? text(item.category),
            },
            {
              title: "计算依据",
              render: (_, item) => {
                const step = steps.get(String(item.code));
                return (
                  <>
                    <div>{text(step?.formula)}</div>
                    <Typography.Text type="secondary">
                      {step?.inputs
                        ? Object.entries(step.inputs as Record<string, unknown>)
                            .map(
                              ([key, value]) =>
                                `${inputLabels[key] ?? key}：${text(value)}`,
                            )
                            .join(" · ")
                        : "未保存计算输入"}
                    </Typography.Text>
                  </>
                );
              },
            },
            {
              title: "金额",
              align: "right",
              render: (_, item) => money(item.amount),
            },
            {
              title: "来源",
              render: (_, item) =>
                text(item.source_reference ?? item.source_type),
            },
          ]}
        />
        {row.items.some((item) => item.code === "attendance_incentive") && (
          <p>以下为普通试算汇总，考勤激励另列；包含激励的正式金额见顶部。</p>
        )}
        {row.steps
          .filter((step) =>
            ["gross", "untaxed_amount", "employer_cost"].includes(
              String(step.code),
            ),
          )
          .map((step) => (
            <p key={String(step.code)}>
              {text(step.formula)} = <strong>{money(step.amount)}</strong>
            </p>
          ))}
      </Card>
      <div className={styles.detailGrid}>
        <Card size="small" title="本月考勤计算依据">
          {data.attendance && (
            <Descriptions
              size="small"
              column={1}
              items={Object.entries(data.attendance)
                .filter(([key]) =>
                  [
                    "expected_work_days",
                    "late_minutes",
                    "early_leave_minutes",
                    "paid_leave_days",
                    "unpaid_leave_days",
                    "missed_punch_count",
                    "corrected_punch_count",
                  ].includes(key),
                )
                .map(([key, value]) => ({
                  key,
                  label: (
                    {
                      expected_work_days: "应出勤天数",
                      late_minutes: "迟到分钟",
                      early_leave_minutes: "早退分钟",
                      paid_leave_days: "有薪请假天数",
                      unpaid_leave_days: "无薪请假天数",
                      missed_punch_count: "忘打卡次数",
                      corrected_punch_count: "补卡次数",
                    } as Record<string, string>
                  )[key],
                  children: text(value),
                }))}
            />
          )}
          <Descriptions
            column={1}
            size="small"
            items={[
              {
                key: "days",
                label: "应出勤天数",
                children: text(attendanceInputs?.expected_work_days),
              },
              {
                key: "salary",
                label: "考勤扣款固定月薪基数",
                children: money(attendanceInputs?.fixed_salary),
              },
              {
                key: "notice",
                label: "事实来源",
                children:
                  "考勤事实用于试算；本页只显示正式记录中已保存的计算依据。",
              },
            ]}
          />
          {row.items
            .filter(
              (item) =>
                String(item.code).startsWith("attendance_") &&
                item.category === "deduction",
            )
            .map((item) => (
              <p key={String(item.code)}>
                {text(item.name)}：{money(item.amount)}
              </p>
            ))}
        </Card>
        <Card size="small" title="社保与公积金分项">
          <Table
            size="small"
            rowKey="code"
            pagination={false}
            scroll={{ x: 440 }}
            dataSource={social}
            columns={[
              { title: "项目", render: (_, item) => text(item.name) },
              {
                title: "基数",
                render: (_, item) =>
                  money(
                    (
                      steps.get(String(item.code))?.inputs as Record<
                        string,
                        unknown
                      >
                    )?.base,
                  ),
              },
              {
                title: "比例",
                render: (_, item) =>
                  text(
                    (
                      steps.get(String(item.code))?.inputs as Record<
                        string,
                        unknown
                      >
                    )?.rate,
                  ),
              },
              {
                title: "金额",
                align: "right",
                render: (_, item) => money(item.amount),
              },
            ]}
          />
        </Card>
      </div>
      <Card size="small" title="历史各期间" extra="保留正式结果与已替代版本">
        <Table
          size="small"
          rowKey="id"
          pagination={{ pageSize: 12 }}
          scroll={{ x: 700 }}
          dataSource={data.history}
          columns={[
            {
              title: "工资期间",
              render: (_, history) => (
                <Link to={`/payroll/ledger/records/${history.id}`}>
                  {history.period}
                </Link>
              ),
            },
            { title: "主体", dataIndex: "subject_name" },
            {
              title: "批次",
              render: (_, history) =>
                `${history.batch_type === "supplement" ? "独立补发 S" : "正常工资 N"}${history.batch_no}`,
            },
            {
              title: "应发金额",
              align: "right",
              render: (_, history) => money(history.gross),
            },
            {
              title: "未扣个税金额",
              align: "right",
              render: (_, history) => money(history.untaxed_amount),
            },
            {
              title: "状态",
              render: (_, history) =>
                history.is_effective === false
                  ? "已替代"
                  : history.calculation_status === "locked"
                    ? "已锁定"
                    : "已确认",
            },
          ]}
        />
      </Card>
      <Space wrap>
        <Link to={`/payroll/ledger${periodQuery}`}>返回工资台账与汇总</Link>
        <Link
          to={`/payroll/batches/${row.payroll_batch_id}?period=${data.period}`}
        >
          查看所属批次核算
        </Link>
        <Link to={`/exports${periodQuery}`}>导出工资表</Link>
      </Space>
    </div>
  );
}
