import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Empty,
  Select,
  Space,
  Spin,
  Steps,
  Table,
  Tag,
  Typography,
} from "antd";
import { Link, useSearchParams } from "react-router-dom";
import {
  exportLabels,
  payrollExports,
  resources,
  type ExportKind,
  type PayrollBatch,
} from "../../shared/api/resources";
import { systemHealthQueryOptions } from "../../shared/api/system";
import { money } from "../../shared/money";
import styles from "./index.module.less";

const final = (batch: PayrollBatch) =>
  ["confirmed", "locked", "exported"].includes(batch.status);
const ready = (status: string) =>
  status === "ready" || status === "not_required";
const statuses: Record<PayrollBatch["status"], string> = {
  draft: "待试算",
  trial: "已试算",
  confirmed: "已确认",
  locked: "已锁定",
  exported: "已导出",
  cancelled: "已取消",
};

export function OverviewPage() {
  const [params, setParams] = useSearchParams();
  const selected = params.get("period") ?? undefined;
  const health = useQuery(systemHealthQueryOptions);
  const company = useQuery({
    queryKey: ["org", "company"],
    queryFn: resources.company,
  });
  const subjects = useQuery({
    queryKey: ["org", "subjects"],
    queryFn: resources.subjects,
  });
  const workbench = useQuery({
    queryKey: ["payroll", "workbench", selected],
    queryFn: () => resources.payrollWorkbench(selected),
  });
  const period = workbench.data?.period;
  const ledger = useQuery({
    queryKey: ["payroll", "ledger", period?.id, {}],
    queryFn: () => resources.payrollLedger(period!.id),
    enabled: !!period,
  });
  const confirmation = useQuery({
    queryKey: ["payroll", "confirmation", period?.id],
    queryFn: () => resources.payrollConfirmation(period!.id),
    enabled: !!period && !!company.data && !!subjects.data?.length,
  });
  const incentive = useQuery({
    queryKey: ["payroll", "incentive", period?.id],
    queryFn: () => resources.attendanceIncentive(period!.id),
    enabled: !!period && !!company.data && !!subjects.data?.length,
  });
  const imports = useQuery({
    queryKey: ["overview", "imports", company.data?.id],
    queryFn: async () => {
      const [employees, attendance, performance] = await Promise.all([
        resources.employeeImports(company.data!.id),
        resources.attendanceImports(company.data!.id),
        resources.performanceImports(company.data!.id),
      ]);
      return [...employees, ...attendance, ...performance]
        .sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at))
        .slice(0, 6);
    },
    enabled: !!company.data,
  });
  const exports = useQuery({
    queryKey: ["overview", "exports", period?.id],
    queryFn: async () => {
      const rows = await Promise.all(
        (Object.keys(exportLabels) as ExportKind[]).map(async (kind) =>
          (await payrollExports.history(period!.id, kind)).map((row) => ({
            ...row,
            kind,
          })),
        ),
      );
      return rows
        .flat()
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    enabled: !!period,
  });
  const preview = useQuery({
    queryKey: ["exports", "preview", "payroll", period?.id, undefined],
    queryFn: () => payrollExports.preview(period!.id),
    enabled: !!period,
  });
  // 已被替代的旧正常批次不参与当前进度；待生效更正仍必须提示处理。
  const batches = Object.values(
    (workbench.data?.batches ?? [])
      .filter(
        (batch) =>
          batch.batch_type === "normal" && batch.status !== "cancelled",
      )
      .reduce<Record<number, PayrollBatch>>((result, batch) => {
        if (
          !result[batch.subject.id] ||
          batch.batch_no > result[batch.subject.id].batch_no
        )
          result[batch.subject.id] = batch;
        return result;
      }, {}),
  );
  const subjectRows = (subjects.data ?? []).map((subject) => ({
    subject,
    batch: batches.find((batch) => batch.subject.id === subject.id),
  }));
  const allBatches =
    subjectRows.length > 0 &&
    subjectRows.every(
      (row) => !!row.batch && row.batch.scope.status === "ready",
    );
  const allPrepared = (key: "attendance" | "performance" | "city_rules") =>
    allBatches &&
    batches.every((batch) => ready(batch.data_preparation[key].status));
  const trialDone =
    allBatches &&
    batches.every(
      (batch) =>
        final(batch) ||
        (!!batch.trial_summary &&
          !batch.trial_summary.stale &&
          batch.trial_summary.error_count === 0 &&
          batch.trial_summary.total_count > 0),
    );
  const incentiveDone =
    confirmation.data?.confirmed === true ||
    incentive.data?.run?.ready === true;
  const versions = preview.data?.versions;
  const currentExports = (exports.data ?? []).filter(
    (row) =>
      row.status === "completed" &&
      row.parameters.subject_id === null &&
      versions &&
      JSON.stringify(row.parameters.versions) === JSON.stringify(versions),
  );
  const exportDone =
    preview.data?.can_export === true &&
    Object.keys(exportLabels).every((kind) =>
      currentExports.some((row) => row.kind === kind),
    );
  const done = [
    !!company.data && allBatches && allPrepared("city_rules"),
    allPrepared("attendance"),
    allPrepared("performance"),
    trialDone,
    incentiveDone,
    confirmation.data?.locked === true,
    exportDone,
  ];
  const titles = [
    "资料准备",
    "考勤导入",
    "绩效导入",
    "工资试算",
    "考勤激励",
    "确认锁定",
    "结果导出",
  ];
  const query = period ? `?period=${period.period}` : "";
  const periodIdQuery = period ? `?period_id=${period.id}` : "";
  const todos: { key: string; title: string; href: string }[] = [];
  if (!company.isPending && !company.data)
    todos.push({
      key: "company",
      title: "初始化目标公司",
      href: "/organization",
    });
  if (period)
    for (const { subject, batch } of subjectRows) {
      if (!batch) {
        todos.push({
          key: `batch-${subject.id}`,
          title: `${subject.name}：建立正常工资批次`,
          href: `/payroll${query}&subject_id=${subject.id}`,
        });
        continue;
      }
      if (final(batch)) continue;
      if (batch.scope.status !== "ready")
        todos.push({
          key: `scope-${batch.id}`,
          title: `${subject.name}：核对期间员工归属`,
          href: "/employees",
        });
      for (const [key, label, href] of [
        ["attendance", "考勤", "/imports?type=attendance"],
        ["performance", "绩效", "/imports?type=performance"],
        ["city_rules", "城市规则", "/rules"],
      ] as const)
        if (!ready(batch.data_preparation[key].status))
          todos.push({
            key: `${key}-${batch.id}`,
            title: `${subject.name}：补齐${label}（缺 ${batch.data_preparation[key].missing_count} 人）`,
            href,
          });
      if (
        batch.trial_summary?.stale ||
        batch.trial_summary?.error_count ||
        !batch.trial_summary
      )
        todos.push({
          key: `trial-${batch.id}`,
          title: `${subject.name}：${batch.trial_summary?.stale ? "输入已变化，重新试算" : batch.trial_summary?.error_count ? "处理试算错误" : "执行工资试算"}`,
          href: `/payroll/batches/${batch.id}${query}`,
        });
    }
  if (period && incentive.data && !incentiveDone)
    todos.push({
      key: "incentive",
      title: incentive.data.message ?? "计算公司期间考勤激励",
      href: `/payroll/incentive${periodIdQuery}`,
    });
  if (period && confirmation.data && !confirmation.data.locked)
    todos.push({
      key: "confirmation",
      title: confirmation.data.blockers[0] ?? "查看试算并完成确认锁定",
      href: `/payroll${query}`,
    });
  if (period && confirmation.data?.locked && !exportDone)
    todos.push({
      key: "export",
      title: "生成当前有效版本的四类 Excel",
      href: `/exports${periodIdQuery}`,
    });
  const error =
    company.error ??
    subjects.error ??
    workbench.error ??
    ledger.error ??
    confirmation.error ??
    incentive.error ??
    imports.error ??
    exports.error ??
    preview.error;
  const loading =
    workbench.isPending ||
    subjects.isPending ||
    company.isPending ||
    (!!period &&
      (confirmation.isLoading ||
        incentive.isLoading ||
        ledger.isLoading ||
        exports.isLoading ||
        preview.isLoading));
  const count = new Set(batches.flatMap((batch) => batch.scope.employee_ids))
    .size;
  return (
    <div className={styles.page}>
      <section className={styles.pageLead}>
        <div>
          <Typography.Title>工资核对工作台</Typography.Title>
          <Typography.Paragraph type="secondary">
            {company.data?.name ?? "目标公司未初始化"} ·{" "}
            {period?.period ?? "尚未建立工资期间"} · 系统金额均为未扣个税金额。
          </Typography.Paragraph>
        </div>
        <Space wrap>
          <Select
            aria-label="工资期间"
            placeholder="选择工资期间"
            value={period?.period}
            options={(workbench.data?.periods ?? []).map((row) => ({
              value: row.period,
              label: row.period,
            }))}
            onChange={(value) => setParams({ period: value })}
          />
          <Tag
            color={
              health.data
                ? "success"
                : health.isPending
                  ? "processing"
                  : "warning"
            }
          >
            {health.data
              ? "本机服务已连接"
              : health.isPending
                ? "正在连接本机服务"
                : "本机服务未连接"}
          </Tag>
        </Space>
      </section>
      {error && (
        <Alert
          type="error"
          showIcon
          title="月度工作台加载失败"
          description={error.message}
          action={
            <Button
              onClick={() => {
                void workbench.refetch();
                void subjects.refetch();
                void company.refetch();
                void ledger.refetch();
                void confirmation.refetch();
                void incentive.refetch();
                void imports.refetch();
                void exports.refetch();
                void preview.refetch();
              }}
            >
              重试
            </Button>
          }
        />
      )}
      <section className={styles.metrics} aria-label="当前准备状态">
        {[
          [
            "本期参与员工",
            loading ? "—" : `${count} 人`,
            "来自期间有效任职或正式快照",
          ],
          [
            "待处理事项",
            loading ? "—" : String(todos.length),
            "缺失数据、过期结果与确认门槛",
          ],
          [
            "已确认正常批次",
            loading
              ? "—"
              : `${batches.filter(final).length} / ${subjectRows.length}`,
            "按主体当前正常工资版本统计",
          ],
          [
            "未扣个税金额",
            ledger.data?.record_count
              ? money(ledger.data.totals.untaxed_amount)
              : "—",
            "正式工资台账合计，尚未确认则不显示金额",
          ],
        ].map(([label, value, note]) => (
          <Card className={styles.metric} key={label}>
            <div className={styles.metricLabel}>{label}</div>
            <div className={styles.metricValue}>{value}</div>
            <div className={styles.metricFoot}>{note}</div>
          </Card>
        ))}
      </section>
      <Card
        className={styles.workflow}
        title="月度处理流程"
        extra={`整体进度 ${loading ? "—" : done.filter(Boolean).length} / 7`}
      >
        <Steps
          current={Math.max(
            0,
            done.findIndex((value) => !value),
          )}
          items={titles.map((title, index) => ({
            title,
            status: loading ? "wait" : done[index] ? "finish" : "wait",
          }))}
          responsive
        />
      </Card>
      {!period && !loading && (
        <Alert
          type="info"
          title="尚无工资期间"
          description={
            <Link to="/payroll">建立工资期间并为主体建立正常工资批次</Link>
          }
        />
      )}
      <div className={styles.noticeGrid}>
        <Card
          size="small"
          title="各主体本期进度"
          extra={<Link to={`/payroll${query}`}>查看期间与批次</Link>}
        >
          {loading ? (
            <Spin />
          ) : (
            <Table
              size="small"
              rowKey={(row) => row.subject.id}
              pagination={false}
              scroll={{ x: 720 }}
              dataSource={subjectRows}
              columns={[
                {
                  title: "主体",
                  render: (_, row) => (
                    <>
                      {row.subject.name}
                      <div className={styles.metricFoot}>
                        {row.subject.code}
                      </div>
                    </>
                  ),
                },
                {
                  title: "人数",
                  render: (_, row) => row.batch?.scope.employee_count ?? "—",
                },
                {
                  title: "数据准备",
                  render: (_, row) =>
                    row.batch ? (
                      <Space wrap>
                        {(
                          ["attendance", "performance", "city_rules"] as const
                        ).map((key, index) => (
                          <Tag
                            key={key}
                            color={
                              ready(row.batch!.data_preparation[key].status)
                                ? "success"
                                : "warning"
                            }
                          >
                            {["考勤", "绩效", "规则"][index]}{" "}
                            {row.batch!.data_preparation[key].status ===
                            "not_required"
                              ? "无需准备"
                              : `${row.batch!.data_preparation[key].prepared_count}/${row.batch!.data_preparation[key].prepared_count + row.batch!.data_preparation[key].missing_count}`}
                          </Tag>
                        ))}
                      </Space>
                    ) : (
                      "尚未建立批次"
                    ),
                },
                {
                  title: "状态",
                  render: (_, row) =>
                    row.batch
                      ? row.batch.trial_summary?.stale
                        ? "试算已过期"
                        : statuses[row.batch.status]
                      : "待建批次",
                },
                {
                  title: "下一步",
                  render: (_, row) => (
                    <Link
                      to={
                        row.batch
                          ? `/payroll/batches/${row.batch.id}${query}`
                          : `/payroll${query}${period ? "&" : "?"}subject_id=${row.subject.id}`
                      }
                    >
                      {row.batch ? "查看核算" : "建立批次"}
                    </Link>
                  ),
                },
              ]}
            />
          )}
        </Card>
        <Card size="small" title="本期待办">
          {loading ? (
            <Spin />
          ) : todos.length ? (
            <ul className={styles.todos}>
              {todos.map((todo) => (
                <li key={todo.key}>
                  <Link to={todo.href}>{todo.title}</Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty
              description={
                period ? "当前没有待处理事项" : "建立工资期间后开始月度处理"
              }
            />
          )}
          <Space wrap>
            <Link to="/employees">员工管理</Link>
            <Link to="/imports">数据导入</Link>
            <Link to={`/payroll${query}`}>工资核算</Link>
            <Link to={`/exports${periodIdQuery}`}>结果导出</Link>
          </Space>
        </Card>
      </div>
      <Alert
        type="info"
        showIcon
        title="输出口径"
        description="系统不计算个税。导出后在 Excel 中计算、扣除并核对个税；未知税额留空。"
      />
      <div className={styles.noticeGrid}>
        <Card
          size="small"
          title="最近导入批次"
          extra={<Link to="/imports">导入中心</Link>}
        >
          <Table
            size="small"
            rowKey="id"
            pagination={false}
            loading={imports.isLoading}
            scroll={{ x: 900 }}
            dataSource={imports.data ?? []}
            columns={[
              { title: "文件", dataIndex: "original_filename" },
              {
                title: "类型",
                render: (_, row) =>
                  ({
                    employee_master: "员工资料",
                    attendance: "考勤",
                    performance: "绩效",
                  })[row.import_type],
              },
              {
                title: "主体",
                render: (_, row) =>
                  "subject_name" in row
                    ? String(row.subject_name)
                    : "公司员工资料",
              },
              {
                title: "导入时间",
                render: (_, row) =>
                  new Date(row.uploaded_at).toLocaleString("zh-CN"),
              },
              {
                title: "成功 / 错误",
                render: (_, row) => `${row.success_rows} / ${row.error_rows}`,
              },
              {
                title: "状态",
                render: (_, row) => (
                  <Tag color={row.error_rows ? "warning" : "success"}>
                    {row.error_rows ? "待修正" : "已导入"}
                  </Tag>
                ),
              },
            ]}
          />
        </Card>
        <Card
          size="small"
          title="最近导出记录"
          extra={<Link to={`/exports${periodIdQuery}`}>导出中心</Link>}
        >
          <Table
            size="small"
            rowKey="id"
            pagination={false}
            loading={exports.isLoading}
            scroll={{ x: 470 }}
            dataSource={(exports.data ?? []).slice(0, 6)}
            columns={[
              { title: "文件类型", render: (_, row) => exportLabels[row.kind] },
              {
                title: "人数",
                render: (_, row) => row.parameters.employee_count,
              },
              {
                title: "生成时间",
                render: (_, row) =>
                  new Date(row.created_at).toLocaleString("zh-CN"),
              },
              {
                title: "状态",
                render: (_, row) => (
                  <Tag color={row.status === "failed" ? "error" : "default"}>
                    {row.status === "completed"
                      ? "已生成"
                      : row.status === "failed"
                        ? "失败"
                        : "生成中"}
                  </Tag>
                ),
              },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
