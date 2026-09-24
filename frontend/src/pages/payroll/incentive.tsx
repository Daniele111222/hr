import { ArrowLeftOutlined, CalculatorOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Empty,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from "antd";
import { Link, useSearchParams } from "react-router-dom";
import {
  resources,
  type AttendanceIncentive,
} from "../../shared/api/resources";
import styles from "./incentive.module.less";

type Row = Record<string, unknown>;

const text = (row: Row, key: string) => String(row[key] ?? "—");
const money = (value?: string) => {
  if (value === undefined) return "—";
  const [whole, fraction = ""] = value.split(".");
  return `¥${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction.padEnd(2, "0")}`;
};

export function AttendanceIncentivePage() {
  const [params] = useSearchParams();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const workbench = useQuery({
    queryKey: ["payroll", "workbench"],
    queryFn: () =>
      resources.payrollWorkbench(params.get("period") ?? undefined),
  });
  const period = params.get("period") ?? workbench.data?.period?.period;
  const periodId = workbench.data?.periods.find(
    (item) => item.period === period,
  )?.id;
  const incentive = useQuery({
    queryKey: ["payroll", "attendance-incentive", periodId],
    queryFn: () => resources.attendanceIncentive(periodId as number),
    enabled: periodId !== undefined,
  });
  const calculate = useMutation({
    mutationFn: () =>
      resources.calculateAttendanceIncentive(periodId as number),
    onSuccess: (value) => {
      queryClient.setQueryData(
        ["payroll", "attendance-incentive", periodId],
        value,
      );
      queryClient.invalidateQueries({ queryKey: ["payroll", "trial"] });
      queryClient.invalidateQueries({ queryKey: ["payroll", "batch"] });
      message.success("考勤激励计算完成");
    },
    onError: (error) => message.error(error.message),
  });

  if (workbench.isLoading || incentive.isLoading) {
    return <Spin className={styles.loading} tip="正在加载考勤激励…" />;
  }
  if (workbench.error || incentive.error) {
    return (
      <Alert
        type="error"
        showIcon
        title="考勤激励加载失败"
        description={(workbench.error ?? incentive.error)?.message}
      />
    );
  }
  if (!periodId || !incentive.data) {
    return <Empty description="尚未建立工资期间" />;
  }

  const data: AttendanceIncentive = incentive.data;
  const run = data.run;
  const candidates = data.candidate_snapshot;
  const eligibleCount = candidates.filter(
    (row) => row.eligible === true,
  ).length;
  const statusLabel = {
    blocked: "未就绪",
    ready: "待计算",
    calculated: "已计算",
    empty: "无合格员工",
    stale: "已失效",
  }[data.status];

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <Space align="center">
            <Typography.Title level={2}>全公司考勤激励</Typography.Title>
            <Tag color={data.status === "blocked" ? "error" : "processing"}>
              {statusLabel}
            </Tag>
          </Space>
          <Typography.Paragraph type="secondary">
            {period} ·
            上月锁定考勤扣款统一分配；激励计入工资，不计入社保与公积金基数。
          </Typography.Paragraph>
        </div>
        <Link to={`/payroll?period=${period}`} className={styles.back}>
          <ArrowLeftOutlined /> 返回工资工作台
        </Link>
      </header>

      {data.message ? (
        <Alert
          type={data.status === "blocked" ? "warning" : "info"}
          showIcon
          title={
            data.status === "blocked" ? "全公司数据尚未就绪" : data.message
          }
          description={data.status === "blocked" ? data.message : undefined}
        />
      ) : null}

      <div className={styles.metrics}>
        <Card>
          <span>上月锁定扣款池</span>
          <strong>{money(data.pool_amount)}</strong>
          <small>{data.source_period ?? "上月期间缺失"}</small>
        </Card>
        <Card>
          <span>符合条件人数</span>
          <strong>{eligibleCount}</strong>
          <small>全公司候选快照</small>
        </Card>
        <Card>
          <span>平均分配金额</span>
          <strong>{money(run?.average_amount)}</strong>
          <small>按排序分配</small>
        </Card>
        <Card>
          <span>尾差</span>
          <strong>{money(run?.remainder_amount)}</strong>
          <small>给排序最后一人</small>
        </Card>
      </div>

      <Card title="本期主体就绪情况" className={styles.card}>
        <Table<Row>
          rowKey={(row) => text(row, "subject_id")}
          size="small"
          pagination={false}
          dataSource={data.current_rows}
          locale={{ emptyText: "没有主体批次" }}
          columns={[
            {
              title: "主体",
              render: (_, row) =>
                `${text(row, "subject_name")}（${text(row, "subject_code")}）`,
            },
            { title: "批次", render: (_, row) => `#${text(row, "batch_id")}` },
            {
              title: "试算版本",
              render: (_, row) => `#${text(row, "trial_id")}`,
            },
            { title: "状态", render: () => <Tag color="success">已就绪</Tag> },
          ]}
        />
      </Card>

      <Card title="员工资格与激励金额" className={styles.card}>
        <Table<Row>
          rowKey={(row) => text(row, "employee_id")}
          size="small"
          scroll={{ x: 900 }}
          dataSource={candidates}
          columns={[
            {
              title: "员工",
              render: (_, row) =>
                `${text(row, "employee_name")} · ${text(row, "employee_no")}`,
            },
            { title: "主体", dataIndex: "subject_id" },
            {
              title: "职级",
              dataIndex: "level_number",
              render: (value) => (value == null ? "—" : `P${value}`),
            },
            {
              title: "资格",
              render: (_, row) =>
                row.eligible === true ? (
                  <Tag color="success">符合条件</Tag>
                ) : (
                  <Tag>已排除</Tag>
                ),
            },
            {
              title: "排除原因",
              render: (_, row) =>
                row.eligible === true ? "—" : text(row, "reason"),
            },
            {
              title: "激励金额",
              align: "right",
              render: (_, row) => {
                const allocation = run?.allocations.find(
                  (item) => item.employee_id === row.employee_id,
                );
                return money(allocation?.amount as string | undefined);
              },
            },
          ]}
        />
      </Card>

      <Card title="来源与版本" className={styles.card}>
        <Descriptions
          size="small"
          bordered
          column={{ xs: 1, sm: 2 }}
          items={[
            {
              key: "source",
              label: "资金来源",
              children: data.source_rows.length
                ? `${data.source_rows.length} 个上月锁定主体批次`
                : "—",
            },
            {
              key: "allocated",
              label: "已分配",
              children: money(run?.allocated_amount),
            },
            {
              key: "version",
              label: "输入指纹",
              children: (
                <code>{run?.input_fingerprint ?? data.input_fingerprint}</code>
              ),
            },
            {
              key: "state",
              label: "版本状态",
              children: run ? (
                run.stale ? (
                  <Tag color="warning">已失效</Tag>
                ) : (
                  <Tag color="success">有效</Tag>
                )
              ) : (
                "尚未生成"
              ),
            },
          ]}
        />
      </Card>

      <footer className={styles.actionbar}>
        <span>
          {data.status === "blocked"
            ? "数据齐全后才能统一计算"
            : (run?.message ?? "计算后将写入各主体最新试算")}
        </span>
        <Button
          type="primary"
          icon={<CalculatorOutlined />}
          disabled={!data.can_calculate || periodId === undefined}
          loading={calculate.isPending}
          onClick={() => calculate.mutate()}
        >
          {run && !run.stale ? "重新计算激励" : "计算本期激励"}
        </Button>
      </footer>
    </div>
  );
}
