import { ArrowLeftOutlined, ReloadOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { resources, type PayrollTrialRow } from "../../shared/api/resources";
import styles from "./batch-detail.module.less";

const steps = ["数据准备", "普通试算", "考勤激励", "核对确认", "锁定", "导出"];
const statusLabels = {
  draft: "草稿",
  trial: "试算",
  confirmed: "已确认",
  locked: "已锁定",
  exported: "已导出",
  cancelled: "已取消",
} as const;
const money = (value?: string) => {
  if (value === undefined) return "—";
  const [whole, fraction = ""] = value.split(".");
  return `¥${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction.padEnd(2, "0")}`;
};

export function PayrollBatchDetailPage() {
  const batchId = Number(useParams().batchId);
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<PayrollTrialRow>();
  const batch = useQuery({
    queryKey: ["payroll", "batch", batchId],
    queryFn: () => resources.payrollBatch(batchId),
    enabled: Number.isInteger(batchId) && batchId > 0,
  });
  const trial = useQuery({
    queryKey: ["payroll", "trial", batchId],
    queryFn: () => resources.payrollTrial(batchId),
    enabled: Number.isInteger(batchId) && batchId > 0,
  });
  const run = useMutation({
    mutationFn: () => resources.runPayrollTrial(batchId),
    onSuccess: (value) => {
      queryClient.setQueryData(["payroll", "trial", batchId], value);
      queryClient.invalidateQueries({
        queryKey: ["payroll", "batch", batchId],
      });
      queryClient.invalidateQueries({ queryKey: ["payroll", "workbench"] });
      message.success("普通工资试算完成");
    },
    onError: (error) => message.error(error.message),
  });

  if (!Number.isInteger(batchId) || batchId <= 0)
    return <Alert type="error" showIcon title="批次编号无效" />;
  if (batch.isLoading || trial.isLoading)
    return (
      <div className={styles.loading}>
        <Spin tip="正在加载批次详情…" />
      </div>
    );
  if (batch.error || trial.error)
    return (
      <Alert
        type="error"
        showIcon
        title="批次详情加载失败"
        description={(batch.error ?? trial.error)?.message}
      />
    );
  if (!batch.data) return <Empty description="工资批次不存在" />;

  const detail = batch.data;
  const result = trial.data;
  const preparation = detail.data_preparation;
  const preparationRows = [
    {
      key: "attendance",
      label: "考勤记录",
      value: preparation.attendance,
      path: "/imports",
    },
    {
      key: "performance",
      label: "绩效记录",
      value: preparation.performance,
      path: "/imports",
    },
    {
      key: "city_rules",
      label: "城市规则",
      value: preparation.city_rules,
      path: "/rules",
    },
  ];
  const issues =
    result?.results.flatMap((row) =>
      row.errors.map((error) => ({ employee: row.employee_name, ...error })),
    ) ?? [];
  const warnings =
    result?.results.flatMap((row) =>
      row.warnings.map((warning) => ({
        employee: row.employee_name,
        message: warning,
      })),
    ) ?? [];

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <Space align="center">
            <Typography.Title level={2}>
              {detail.subject.code}-N{detail.batch_no}
            </Typography.Title>
            <Tag
              color={
                detail.status === "trial"
                  ? "processing"
                  : detail.status === "cancelled"
                    ? "error"
                    : "default"
              }
            >
              {statusLabels[detail.status]}
            </Tag>
          </Space>
          <p>
            {detail.subject.name} · 正常工资 · 员工范围{" "}
            {detail.scope.employee_count} 人
          </p>
        </div>
        <Link to="/payroll" className={styles.back}>
          <ArrowLeftOutlined /> 返回工资期间与批次
        </Link>
      </header>

      <Card className={styles.flow}>
        <div className={styles.steps}>
          {steps.map((label, index) => (
            <div
              className={`${styles.step} ${index === (result ? 1 : 0) ? styles.current : ""}`}
              key={label}
            >
              <span>{index + 1}</span>
              {label}
            </div>
          ))}
        </div>
      </Card>
      {result?.stale ? (
        <Alert
          type="warning"
          showIcon
          title="试算已失效：输入或规则已更新"
          description="当前显示上一次试算快照；请重新试算并核对金额。"
        />
      ) : null}
      {result?.error_count ? (
        <Alert
          type="error"
          showIcon
          title={`${result.error_count} 名员工试算失败`}
          description="已保留其他员工的试算结果；请在“校验与异常”查看具体原因。"
        />
      ) : null}
      <Alert
        type="info"
        showIcon
        title="当前结果只包含普通工资"
        description="全公司考勤激励尚未计算，不能整批确认。金额均为未扣个税金额，不代表最终到账金额。"
      />

      <Card className={styles.content}>
        <Tabs
          items={[
            {
              key: "prepare",
              label: "数据准备",
              children: (
                <div className={styles.panel}>
                  <Descriptions
                    size="small"
                    column={{ xs: 1, sm: 2 }}
                    bordered
                    items={[
                      {
                        key: "scope",
                        label: "员工名册",
                        children: `${detail.scope.employee_count} 人 · 期间有效任职关系`,
                      },
                      {
                        key: "status",
                        label: "整体状态",
                        children: preparation.overall_status,
                      },
                    ]}
                  />
                  <Table
                    rowKey="key"
                    size="small"
                    pagination={false}
                    dataSource={preparationRows}
                    columns={[
                      { title: "输入项目", dataIndex: "label" },
                      {
                        title: "准备情况",
                        render: (_, row) =>
                          row.value.status === "not_required" ? (
                            <Tag>无需准备</Tag>
                          ) : (
                            <Tag
                              color={
                                row.value.status === "ready"
                                  ? "success"
                                  : "warning"
                              }
                            >
                              {row.value.prepared_count}/
                              {row.value.prepared_count +
                                row.value.missing_count}
                            </Tag>
                          ),
                      },
                      {
                        title: "说明",
                        render: (_, row) => row.value.message ?? "—",
                      },
                      {
                        title: "操作",
                        render: (_, row) => <Link to={row.path}>查看</Link>,
                      },
                    ]}
                  />
                </div>
              ),
            },
            {
              key: "trial",
              label: `试算结果${result ? ` ${result.total_count}` : ""}`,
              children: result ? (
                <div className={styles.panel}>
                  <div className={styles.metrics}>
                    {[
                      ["试算成功人数", String(result.success_count)],
                      ["试算失败人数", String(result.error_count)],
                      ["应发金额合计", money(result.totals.gross)],
                      ["未扣个税金额合计", money(result.totals.untaxed_amount)],
                      ["公司成本合计", money(result.totals.employer_cost)],
                    ].map(([label, value]) => (
                      <div className={styles.metric} key={label}>
                        <span>{label}</span>
                        <strong>{value}</strong>
                      </div>
                    ))}
                  </div>
                  <Table<PayrollTrialRow>
                    rowKey="employee_id"
                    size="small"
                    scroll={{ x: 1320 }}
                    pagination={{ pageSize: 12 }}
                    dataSource={result.results}
                    columns={[
                      {
                        title: "员工",
                        fixed: "left",
                        width: 145,
                        render: (_, row) => (
                          <>
                            <strong>{row.employee_name}</strong>
                            <small>{row.snapshot.employee_no}</small>
                          </>
                        ),
                      },
                      {
                        title: "部门",
                        render: (_, row) => row.snapshot.department_name ?? "—",
                      },
                      ...[
                        ["固定薪资", "fixed"],
                        ["绩效金额", "performance"],
                        ["考勤扣款", "attendance_deduction"],
                        ["应发金额", "gross"],
                        ["个人社保", "employee_social"],
                        ["个人公积金", "employee_housing"],
                        ["未扣个税金额", "untaxed_amount"],
                        ["公司成本", "employer_cost"],
                      ].map(([title, key]) => ({
                        title,
                        align: "right" as const,
                        render: (_: unknown, row: PayrollTrialRow) =>
                          row.amounts ? money(row.amounts[key]) : "—",
                      })),
                      {
                        title: "状态",
                        render: (_, row) =>
                          row.errors.length ? (
                            <Tag color="error">试算失败</Tag>
                          ) : row.warnings.length ? (
                            <Tag color="warning">需核对</Tag>
                          ) : (
                            <Tag color="success">成功</Tag>
                          ),
                      },
                      {
                        title: "操作",
                        fixed: "right",
                        render: (_, row) => (
                          <Button size="small" onClick={() => setSelected(row)}>
                            明细
                          </Button>
                        ),
                      },
                    ]}
                  />
                </div>
              ) : (
                <Empty
                  className={styles.empty}
                  description="尚未试算，准备好考勤、绩效及城市规则后发起普通工资试算"
                />
              ),
            },
            {
              key: "verify",
              label: `校验与异常${issues.length ? ` ${issues.length}` : ""}`,
              children: (
                <div className={styles.panel}>
                  {!result ? (
                    <Empty description="试算后显示员工校验结果" />
                  ) : issues.length === 0 && warnings.length === 0 ? (
                    <Alert
                      type="success"
                      showIcon
                      title="本次试算没有员工错误或警告"
                    />
                  ) : (
                    <>
                      {issues.map((item, index) => (
                        <Alert
                          key={`${item.employee}-${item.code}-${index}`}
                          type="error"
                          showIcon
                          title={`${item.employee}：${item.message}`}
                          description={item.code}
                        />
                      ))}
                      {warnings.map((item, index) => (
                        <Alert
                          key={`${item.employee}-${index}`}
                          type="warning"
                          showIcon
                          title={`${item.employee}：${item.message}`}
                        />
                      ))}
                    </>
                  )}
                </div>
              ),
            },
            {
              key: "version",
              label: "版本与操作记录",
              children: (
                <div className={styles.panel}>
                  {result ? (
                    <Descriptions
                      size="small"
                      bordered
                      column={1}
                      items={[
                        {
                          key: "version",
                          label: "试算版本",
                          children: `#${result.id}`,
                        },
                        {
                          key: "time",
                          label: "试算时间",
                          children: new Date(result.created_at).toLocaleString(
                            "zh-CN",
                          ),
                        },
                        {
                          key: "fingerprint",
                          label: "输入指纹",
                          children: <code>{result.input_fingerprint}</code>,
                        },
                        {
                          key: "state",
                          label: "有效性",
                          children: result.stale ? (
                            <Tag color="warning">已失效</Tag>
                          ) : (
                            <Tag color="success">有效</Tag>
                          ),
                        },
                      ]}
                    />
                  ) : (
                    <Empty description="尚无试算版本" />
                  )}
                </div>
              ),
            },
          ]}
        />
      </Card>

      <footer className={styles.actionbar}>
        <span>
          {result?.confirmation_blockers.join("；") ?? "尚未生成普通工资试算"}
        </span>
        <Button
          type="primary"
          icon={<ReloadOutlined />}
          loading={run.isPending}
          disabled={detail.status !== "draft" && detail.status !== "trial"}
          onClick={() => run.mutate()}
        >
          {result ? "重新试算" : "开始普通试算"}
        </Button>
        <Button disabled title="须完成全公司考勤激励并通过整批校验">
          整批确认
        </Button>
      </footer>

      <Drawer
        title={`${selected?.employee_name ?? "员工"} · 试算明细`}
        width={Math.min(
          700,
          typeof window === "undefined" ? 700 : window.innerWidth,
        )}
        open={Boolean(selected)}
        onClose={() => setSelected(undefined)}
      >
        {selected ? (
          <Space
            direction="vertical"
            size="middle"
            className={styles.drawerContent}
          >
            <Descriptions
              size="small"
              column={1}
              items={[
                {
                  key: "name",
                  label: "员工",
                  children: `${selected.employee_name} · ${selected.snapshot.employee_no}`,
                },
                {
                  key: "dept",
                  label: "部门与职位",
                  children: `${selected.snapshot.department_name ?? "—"} · ${selected.snapshot.position_title ?? "—"}`,
                },
                {
                  key: "net",
                  label: "未扣个税金额",
                  children: selected.amounts
                    ? money(selected.amounts.untaxed_amount)
                    : "试算失败",
                },
              ]}
            />
            {selected.errors.map((item) => (
              <Alert
                key={item.code}
                type="error"
                showIcon
                title={item.message}
              />
            ))}
            {selected.warnings.map((item) => (
              <Alert key={item} type="warning" showIcon title={item} />
            ))}
            <Typography.Title level={5}>计算步骤</Typography.Title>
            {selected.steps.length ? (
              <Table
                rowKey="code"
                size="small"
                pagination={false}
                dataSource={selected.steps}
                columns={[
                  { title: "项目", dataIndex: "code" },
                  { title: "计算口径", dataIndex: "formula" },
                  {
                    title: "结果",
                    render: (_, row) => money(row.amount),
                    align: "right",
                  },
                ]}
              />
            ) : (
              <Empty description="输入校验未通过，暂无计算步骤" />
            )}
          </Space>
        ) : null}
      </Drawer>
    </div>
  );
}
