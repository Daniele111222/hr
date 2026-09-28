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
  Input,
  Modal,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  resources,
  type PayrollCorrectionInput,
  type PayrollTrialRow,
} from "../../shared/api/resources";
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
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionReason, setCorrectionReason] = useState("");
  const [editingInput, setEditingInput] = useState<PayrollCorrectionInput>();
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [inputSource, setInputSource] = useState("");
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
  const confirmation = useQuery({
    queryKey: ["payroll", "confirmation", batch.data?.period_id],
    queryFn: () => resources.payrollConfirmation(batch.data!.period_id),
    enabled: Boolean(batch.data?.period_id),
  });
  const corrections = useQuery({
    queryKey: ["payroll", "corrections", batch.data?.id],
    queryFn: () => resources.payrollCorrections(batch.data!.id),
    enabled:
      batch.data?.is_effective === false ||
      ["confirmed", "locked", "exported"].includes(batch.data?.status ?? ""),
  });
  const replacementCorrection = corrections.data?.find(
    (item) =>
      item.status === "requested" && item.replacement_batch_id === batchId,
  );
  const correctionInputs = useQuery({
    queryKey: ["payroll", "correction-inputs", replacementCorrection?.id],
    queryFn: () => resources.payrollCorrectionInputs(replacementCorrection!.id),
    enabled:
      Boolean(replacementCorrection) &&
      ["draft", "trial"].includes(batch.data?.status ?? ""),
  });
  const run = useMutation({
    mutationFn: () => resources.runPayrollTrial(batchId),
    onSuccess: (value) => {
      queryClient.setQueryData(["payroll", "trial", batchId], value);
      queryClient.invalidateQueries({
        queryKey: ["payroll", "batch", batchId],
      });
      queryClient.invalidateQueries({
        queryKey: ["payroll", "confirmation", batch.data?.period_id],
      });
      queryClient.invalidateQueries({ queryKey: ["payroll", "workbench"] });
      message.success("普通工资试算完成");
    },
    onError: (error) => message.error(error.message),
  });
  const confirm = useMutation({
    mutationFn: () => resources.confirmPayrollPeriod(batch.data!.period_id),
    onSuccess: (value) => {
      queryClient.setQueryData(
        ["payroll", "confirmation", batch.data!.period_id],
        value,
      );
      queryClient.invalidateQueries({
        queryKey: ["payroll", "batch", batchId],
      });
      queryClient.invalidateQueries({ queryKey: ["payroll", "workbench"] });
      message.success("本期正常工资已整批确认");
    },
    onError: (error) => message.error(error.message),
  });
  const lock = useMutation({
    mutationFn: () => resources.lockPayrollPeriod(batch.data!.period_id),
    onSuccess: (value) => {
      queryClient.setQueryData(
        ["payroll", "confirmation", batch.data!.period_id],
        value,
      );
      queryClient.invalidateQueries({
        queryKey: ["payroll", "batch", batchId],
      });
      queryClient.invalidateQueries({ queryKey: ["payroll", "workbench"] });
      queryClient.invalidateQueries({
        queryKey: ["payroll", "corrections", batchId],
      });
      queryClient.invalidateQueries({ queryKey: ["payroll", "ledger"] });
      message.success(
        replacementCorrection
          ? "本期工资已锁定，更正版本同步生效"
          : "本期正常工资已锁定",
      );
    },
    onError: (error) => message.error(error.message),
  });
  const correction = useMutation({
    mutationFn: () =>
      resources.requestPayrollCorrection(batchId, correctionReason),
    onSuccess: (value) => {
      setCorrectionOpen(false);
      setCorrectionReason("");
      queryClient.setQueryData(
        ["payroll", "corrections", batchId],
        (current: unknown[] | undefined) => [value, ...(current ?? [])],
      );
      queryClient.invalidateQueries({ queryKey: ["payroll", "workbench"] });
      message.success(
        `已生成替代版本批次 #${value.replacement_batch_id}，请重新试算并确认全体员工`,
      );
    },
    onError: (error) => message.error(error.message),
  });
  const saveInput = useMutation({
    mutationFn: () => {
      if (!replacementCorrection || !editingInput)
        throw new Error("更正输入未选择");
      const attendance = editingInput.attendance
        ? Object.fromEntries(
            Object.entries(inputValues).filter(
              ([key, value]) =>
                key !== "performance_coefficient" &&
                value !==
                  String(
                    editingInput.attendance![
                      key as keyof typeof editingInput.attendance
                    ],
                  ),
            ),
          )
        : undefined;
      const performance =
        inputValues.performance_coefficient !==
        editingInput.performance_coefficient
          ? inputValues.performance_coefficient
          : undefined;
      return resources.updatePayrollCorrectionInputs(replacementCorrection.id, {
        employee_id: editingInput.employee_id,
        source_note: inputSource.trim(),
        attendance,
        performance_coefficient: performance,
      });
    },
    onSuccess: (rows) => {
      queryClient.setQueryData(
        ["payroll", "correction-inputs", replacementCorrection?.id],
        rows,
      );
      queryClient.invalidateQueries({
        queryKey: ["payroll", "trial", batchId],
      });
      queryClient.invalidateQueries({ queryKey: ["payroll", "confirmation"] });
      setEditingInput(undefined);
      message.success("更正输入已保存，请重新试算全体员工");
    },
    onError: (error) => message.error(error.message),
  });
  const cancelCorrection = useMutation({
    mutationFn: (correctionId: number) =>
      resources.cancelPayrollCorrection(correctionId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["payroll", "corrections", batchId],
      });
      queryClient.invalidateQueries({
        queryKey: ["payroll", "batch", batchId],
      });
      queryClient.invalidateQueries({ queryKey: ["payroll", "workbench"] });
      message.success("未生效的更正已取消，原版本仍有效");
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
  const pendingCorrection = corrections.data?.find(
    (item) => item.status === "requested",
  );
  const result = trial.data;
  const confirmationState = confirmation.data;
  const preparation = detail.data_preparation;
  const inputChanged = editingInput
    ? Object.entries(inputValues).some(([key, value]) =>
        key === "performance_coefficient"
          ? value !== editingInput.performance_coefficient
          : value !==
            String(
              editingInput.attendance?.[
                key as keyof typeof editingInput.attendance
              ],
            ),
      )
    : false;
  const openInput = (row: PayrollCorrectionInput) => {
    setEditingInput(row);
    setInputSource(row.source_note ?? "");
    setInputValues({
      ...(row.attendance
        ? Object.fromEntries(
            [
              "expected_work_days",
              "late_minutes",
              "early_leave_minutes",
              "paid_leave_days",
              "unpaid_leave_days",
              "missed_punch_count",
              "corrected_punch_count",
            ].map((key) => [
              key,
              String(row.attendance![key as keyof typeof row.attendance]),
            ]),
          )
        : {}),
      ...(row.performance_coefficient !== null
        ? { performance_coefficient: row.performance_coefficient }
        : {}),
    });
  };
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
              {pendingCorrection?.replacement_batch_id === detail.id
                ? "待生效"
                : detail.is_effective === false && detail.status !== "cancelled"
                  ? "已被替代"
                  : statusLabels[detail.status]}
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
      {Array.isArray(confirmationState?.blockers) &&
      confirmationState.blockers.length ? (
        <Alert
          type="warning"
          showIcon
          title="整批确认仍有阻断项"
          description={confirmationState.blockers.join("；")}
        />
      ) : null}
      {confirmation.error ? (
        <Alert
          type="error"
          showIcon
          title="整批确认状态加载失败"
          description={confirmation.error.message}
        />
      ) : null}
      {corrections.error ? (
        <Alert
          type="error"
          showIcon
          title="更正记录加载失败"
          description={corrections.error.message}
        />
      ) : null}
      {pendingCorrection &&
      detail.id === pendingCorrection.original_batch_id ? (
        <Alert
          type="info"
          showIcon
          title="已有待生效的替代版本"
          description={
            <Link
              to={`/payroll/batches/${pendingCorrection.replacement_batch_id}`}
            >
              前往替代版本重新试算、确认并锁定
            </Link>
          }
        />
      ) : null}
      <Alert
        type={result?.includes_final_incentive ? "success" : "info"}
        showIcon
        title={
          result?.includes_final_incentive
            ? "当前结果已包含全公司考勤激励"
            : "当前结果只包含普通工资"
        }
        description={
          <span>
            {result?.includes_final_incentive
              ? "激励已写入本批次，金额均为未扣个税金额。"
              : "全公司考勤激励尚未计算，不能整批确认。金额均为未扣个税金额，不代表最终到账金额。"}{" "}
            <Link to={`/payroll/incentive?period=${detail.period_id}`}>
              查看考勤激励
            </Link>
          </span>
        }
      />

      <Card className={styles.content}>
        <Tabs
          items={[
            {
              key: "prepare",
              label: "数据准备",
              children: (
                <div className={styles.panel}>
                  {replacementCorrection &&
                  ["draft", "trial"].includes(detail.status) ? (
                    <>
                      <Alert
                        type="info"
                        showIcon
                        title="替代版本沿用原确认快照"
                        description="本次仅修正考勤与绩效；薪酬和规则沿用原确认快照，员工现况不会改写原工资事实。"
                      />
                      {correctionInputs.error ? (
                        <Alert
                          type="error"
                          showIcon
                          title="更正输入加载失败"
                          description={correctionInputs.error.message}
                        />
                      ) : null}
                      <Table<PayrollCorrectionInput>
                        rowKey="employee_id"
                        size="small"
                        scroll={{ x: 640 }}
                        loading={correctionInputs.isLoading}
                        pagination={{ pageSize: 12 }}
                        dataSource={correctionInputs.data ?? []}
                        columns={[
                          { title: "员工", dataIndex: "employee_name" },
                          {
                            title: "考勤",
                            render: (_, row) =>
                              row.attendance
                                ? `迟到 ${row.attendance.late_minutes} 分钟 · 忘打卡 ${row.attendance.missed_punch_count} 次`
                                : "—",
                          },
                          {
                            title: "绩效系数",
                            dataIndex: "performance_coefficient",
                            render: (value: string | null) => value ?? "—",
                          },
                          {
                            title: "修正来源",
                            dataIndex: "source_note",
                            render: (value: string | null) =>
                              value ?? "尚未修正",
                          },
                          {
                            title: "操作",
                            render: (_, row) => (
                              <Button
                                size="small"
                                onClick={() => openInput(row)}
                              >
                                修正输入
                              </Button>
                            ),
                          },
                        ]}
                      />
                    </>
                  ) : null}
                  <Descriptions
                    size="small"
                    column={{ xs: 1, sm: 2 }}
                    bordered
                    items={[
                      {
                        key: "scope",
                        label: "员工名册",
                        children: `${detail.scope.employee_count} 人 · ${detail.scope.source === "confirmed_trial_snapshot" ? "原确认快照" : "期间有效任职关系"}`,
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
                  {corrections.data?.map((item) => (
                    <Descriptions
                      key={item.id}
                      size="small"
                      bordered
                      column={1}
                      items={[
                        {
                          key: "reason",
                          label: "更正原因",
                          children: item.reason,
                        },
                        {
                          key: "source",
                          label: "原批次",
                          children: (
                            <Link
                              to={`/payroll/batches/${item.original_batch_id}`}
                            >
                              #{item.original_batch_id}
                            </Link>
                          ),
                        },
                        {
                          key: "replacement",
                          label: "替代版本",
                          children: (
                            <Link
                              to={`/payroll/batches/${item.replacement_batch_id}`}
                            >
                              #{item.replacement_batch_id}
                            </Link>
                          ),
                        },
                        {
                          key: "status",
                          label: "更正状态",
                          children:
                            item.status === "applied"
                              ? "已生效"
                              : item.status === "cancelled"
                                ? "已取消"
                                : "待生效",
                        },
                        {
                          key: "input_history",
                          label: "输入修正记录",
                          children: item.input_history?.length
                            ? item.input_history.map((change, index) => (
                                <div key={index}>
                                  {new Date(change.created_at).toLocaleString(
                                    "zh-CN",
                                  )}{" "}
                                  · 员工 #{change.employee_id} ·{" "}
                                  {change.source_note}
                                </div>
                              ))
                            : "尚无输入修正",
                        },
                      ]}
                    />
                  ))}
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
        <Button
          type="primary"
          loading={confirm.isPending}
          disabled={
            !confirmationState?.can_confirm || !result?.ready_for_confirmation
          }
          onClick={() => confirm.mutate()}
        >
          整批确认
        </Button>
        <Button
          loading={lock.isPending}
          disabled={!confirmationState?.can_lock}
          onClick={() => lock.mutate()}
        >
          锁定本期批次
        </Button>
        {detail.is_effective !== false &&
        (detail.status === "confirmed" ||
          detail.status === "locked" ||
          detail.status === "exported") ? (
          <Button onClick={() => setCorrectionOpen(true)}>发起整批更正</Button>
        ) : null}
        {pendingCorrection ? (
          <Button
            loading={cancelCorrection.isPending}
            onClick={() => cancelCorrection.mutate(pendingCorrection.id)}
          >
            取消更正
          </Button>
        ) : null}
        <Link to={`/payroll/ledger?period_id=${detail.period_id}`}>
          查看工资台账
        </Link>
      </footer>

      <Modal
        title="发起整批更正"
        open={correctionOpen}
        okText="生成替代版本"
        cancelText="取消"
        confirmLoading={correction.isPending}
        okButtonProps={{ disabled: !correctionReason.trim() }}
        onCancel={() => setCorrectionOpen(false)}
        onOk={() => correction.mutate()}
      >
        <Alert
          type="info"
          showIcon
          title="将覆盖本批次全体员工"
          description="原批次内容保持不变。替代版本重新试算并全员确认后，锁定时自动成为期间有效版本。"
        />
        <Input.TextArea
          autoFocus
          rows={4}
          maxLength={2000}
          showCount
          value={correctionReason}
          onChange={(event) => setCorrectionReason(event.target.value)}
          placeholder="请填写更正原因，便于后续追溯"
          style={{ marginTop: 16 }}
        />
      </Modal>

      <Modal
        title={`修正月度输入 · ${editingInput?.employee_name ?? ""}`}
        open={Boolean(editingInput)}
        width="min(680px, calc(100vw - 32px))"
        okText="保存修正输入"
        confirmLoading={saveInput.isPending}
        okButtonProps={{ disabled: !inputSource.trim() || !inputChanged }}
        onCancel={() => setEditingInput(undefined)}
        onOk={() => saveInput.mutate()}
      >
        <p>以原确认快照为基线，填写需要更正的值；原始导入记录保留。</p>
        <div className={styles.inputGrid}>
          {[
            ["expected_work_days", "应出勤天数"],
            ["late_minutes", "迟到分钟"],
            ["early_leave_minutes", "早退分钟"],
            ["paid_leave_days", "有薪请假天数"],
            ["unpaid_leave_days", "无薪请假天数"],
            ["missed_punch_count", "忘打卡次数"],
            ["corrected_punch_count", "补卡次数"],
            ["performance_coefficient", "绩效系数"],
          ]
            .filter(([key]) =>
              key === "performance_coefficient"
                ? editingInput?.performance_coefficient !== null
                : Boolean(editingInput?.attendance),
            )
            .map(([key, label]) => (
              <label key={key}>
                <span>{label}</span>
                <Input
                  aria-label={label}
                  inputMode="decimal"
                  value={inputValues[key] ?? ""}
                  onChange={(event) =>
                    setInputValues((current) => ({
                      ...current,
                      [key]: event.target.value,
                    }))
                  }
                />
              </label>
            ))}
        </div>
        <label className={styles.sourceField}>
          <span>修正来源说明 *</span>
          <Input.TextArea
            aria-label="修正来源说明"
            maxLength={500}
            rows={2}
            value={inputSource}
            onChange={(event) => setInputSource(event.target.value)}
          />
        </label>
      </Modal>

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
