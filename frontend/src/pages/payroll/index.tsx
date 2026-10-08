import { PlusOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from "antd";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { resources, type PayrollBatch } from "../../shared/api/resources";
import styles from "./index.module.less";

type BatchType = PayrollBatch["batch_type"];

const batchTypeLabels: Record<BatchType, string> = {
  normal: "正常工资",
  supplement: "独立补发",
  performance_supplement: "绩效补发",
  other: "其他发放",
};

const statusLabels: Record<PayrollBatch["status"], string> = {
  draft: "草稿",
  trial: "试算",
  confirmed: "已确认",
  locked: "已锁定",
  exported: "已导出",
  cancelled: "已取消",
};

function statusColor(status: PayrollBatch["status"]) {
  if (status === "locked" || status === "exported") return "success";
  if (status === "confirmed" || status === "trial") return "processing";
  if (status === "cancelled") return "error";
  return "default";
}

function preparationTag(
  label: string,
  item: PayrollBatch["data_preparation"]["attendance"],
) {
  if (item.status === "not_required") return <Tag>{label} 无需准备</Tag>;
  const color =
    item.status === "ready"
      ? "success"
      : item.status === "partial"
        ? "warning"
        : "error";
  return (
    <Tag color={color}>
      {label} {item.prepared_count}/{item.prepared_count + item.missing_count}
    </Tag>
  );
}

export function PayrollPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const subjectsQuery = useQuery({
    queryKey: ["org", "subjects"],
    queryFn: resources.subjects,
  });
  const [params, setParams] = useSearchParams();
  const selectedPeriod = params.get("period") ?? undefined;
  const subjectFilter = params.has("subject_id")
    ? Number(params.get("subject_id"))
    : undefined;
  const batchTypeFilter = params.get("batch_type") as BatchType | null;
  const statusFilter = params.get("status") as PayrollBatch["status"] | null;
  const updateFilter = (key: string, value: string | number | undefined) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value === undefined) next.delete(key);
      else next.set(key, String(value));
      return next;
    });
  const setSelectedPeriod = (value: string) => setParams({ period: value });
  const setSubjectFilter = (value: number | undefined) =>
    updateFilter("subject_id", value);
  const setBatchTypeFilter = (value: BatchType | undefined) =>
    updateFilter("batch_type", value);
  const [createPeriodOpen, setCreatePeriodOpen] = useState(false);
  const [createBatchOpen, setCreateBatchOpen] = useState(false);
  const [periodForm] = Form.useForm<{ period: string }>();
  const [batchForm] = Form.useForm<{
    subject_id: number;
    batch_type: "normal" | "supplement";
    name?: string;
    payment_date?: string;
  }>();
  const creatingBatchType = Form.useWatch("batch_type", batchForm);

  const workbench = useQuery({
    queryKey: ["payroll", "workbench", selectedPeriod],
    queryFn: () => resources.payrollWorkbench(selectedPeriod),
  });
  const data = workbench.data;
  const activePeriod = selectedPeriod ?? data?.periods[0]?.period;

  const currentPeriod =
    data?.period ?? data?.periods.find((item) => item.period === activePeriod);
  const visibleBatches = useMemo(
    () =>
      (data?.batches ?? []).filter(
        (batch) =>
          (subjectFilter === undefined || batch.subject.id === subjectFilter) &&
          (!batchTypeFilter || batch.batch_type === batchTypeFilter) &&
          (!statusFilter || batch.status === statusFilter),
      ),
    [batchTypeFilter, data?.batches, subjectFilter, statusFilter],
  );
  const subjects = subjectsQuery.data ?? [];
  const missingSubjects = subjects.filter(
    (subject) =>
      !data?.batches.some(
        (batch) =>
          batch.subject.id === subject.id &&
          batch.batch_type === "normal" &&
          batch.status !== "cancelled" &&
          batch.is_effective !== false,
      ),
  );
  const openBatch = (subjectId = subjectFilter) => {
    batchForm.resetFields();
    batchForm.setFieldsValue({ subject_id: subjectId, batch_type: "normal" });
    setCreateBatchOpen(true);
  };
  const periodParams = new URLSearchParams(params);
  if (currentPeriod) periodParams.set("period", currentPeriod.period);
  const batchPath = (row: PayrollBatch) =>
    `/payroll/batches/${row.id}?${periodParams}`;
  const importPath = (
    row: PayrollBatch,
    kind: "attendance" | "performance",
  ) => {
    const next = new URLSearchParams(periodParams);
    next.set("batch_id", String(row.id));
    next.set("subject_id", String(row.subject.id));
    next.set("type", kind);
    return `/imports?${next}`;
  };

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["payroll", "workbench"] });
  const periodMutation = useMutation({
    mutationFn: resources.createPayrollPeriod,
    onSuccess: (period) => {
      message.success(`已建立 ${period.period} 工资期间`);
      setSelectedPeriod(period.period);
      setCreatePeriodOpen(false);
      periodForm.resetFields();
      refresh();
    },
    onError: (error) => message.error(error.message),
  });
  const batchMutation = useMutation({
    mutationFn: (values: {
      subject_id: number;
      batch_type: "normal" | "supplement";
      name?: string;
      payment_date?: string;
    }) => resources.createPayrollBatch(currentPeriod!.id, values),
    onSuccess: () => {
      message.success("工资批次已建立");
      setCreateBatchOpen(false);
      batchForm.resetFields();
      refresh();
    },
    onError: (error) => message.error(error.message),
  });

  if (workbench.isLoading) {
    return (
      <div className={styles.loading}>
        <Spin tip="正在加载工资期间…" />
      </div>
    );
  }
  if (workbench.error) {
    return (
      <Alert
        type="error"
        showIcon
        title="工资工作台加载失败"
        description={workbench.error.message}
      />
    );
  }

  return (
    <div className={styles.page}>
      <section className={styles.lead}>
        <div>
          <Typography.Title level={2}>工资期间与批次</Typography.Title>
          <Typography.Paragraph type="secondary">
            工资期间按自然月管理；正常工资员工范围来自有效任职关系，独立补发按批次录入员工金额。
          </Typography.Paragraph>
        </div>
        <Space>
          <Button
            icon={<PlusOutlined />}
            onClick={() => setCreatePeriodOpen(true)}
          >
            建立工资期间
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            disabled={!currentPeriod}
            onClick={() => openBatch()}
          >
            建立批次
          </Button>
        </Space>
      </section>

      <Card title="工资期间" className={styles.card}>
        {data?.periods.length ? (
          <Table
            rowKey="id"
            size="small"
            scroll={{ x: 760 }}
            dataSource={data.periods}
            pagination={false}
            rowClassName={(row) =>
              row.period === activePeriod ? styles.selectedRow : ""
            }
            onRow={(row) => ({ onClick: () => setSelectedPeriod(row.period) })}
            columns={[
              {
                title: "工资期间",
                dataIndex: "period",
                render: (value) => <span className={styles.mono}>{value}</span>,
              },
              {
                title: "自然月",
                render: (_, row) => (
                  <span className={styles.mono}>
                    {row.period_start} 至 {row.period_end}
                  </span>
                ),
              },
              { title: "批次", dataIndex: "batch_count" },
              { title: "正常批次", dataIndex: "normal_batch_count" },
              {
                title: "发放日期",
                render: (_, row) => row.payment_date ?? <Tag>未确认</Tag>,
              },
            ]}
          />
        ) : (
          <Empty description="暂无工资期间，请先建立期间" />
        )}
      </Card>

      {currentPeriod && (
        <Card
          title={`${currentPeriod.period} 本期操作`}
          className={styles.card}
        >
          <Space wrap size="middle">
            <Link to={`/imports?${periodParams}&type=attendance`}>
              导入考勤
            </Link>
            <Link to={`/imports?${periodParams}&type=performance`}>
              导入绩效
            </Link>
            <Link to={`/payroll/incentive?period=${currentPeriod.period}`}>
              考勤激励
            </Link>
            <Link to={`/payroll/ledger?period=${currentPeriod.period}`}>
              工资台账
            </Link>
            <Link to={`/exports?period_id=${currentPeriod.id}&kind=payroll`}>
              导出本期工资表
            </Link>
          </Space>
          <Typography.Paragraph type="secondary" className={styles.notice}>
            按主体核算，整期确认与锁定后，汇总导出一份全公司工资表。
          </Typography.Paragraph>
          {subjectsQuery.isError && (
            <Alert
              type="error"
              showIcon
              title="主体列表加载失败"
              action={
                <Button onClick={() => void subjectsQuery.refetch()}>
                  重试
                </Button>
              }
            />
          )}
          {!!missingSubjects.length && (
            <Alert
              type="warning"
              showIcon
              title={`本期尚缺 ${missingSubjects.length} 个主体的正常工资批次`}
              description={
                <Space wrap className={styles.missingSubjects}>
                  {missingSubjects.map((subject) => (
                    <Button
                      type="link"
                      key={subject.id}
                      onClick={() => openBatch(subject.id)}
                    >
                      {subject.name}：建立批次
                    </Button>
                  ))}
                </Space>
              }
            />
          )}
        </Card>
      )}

      {currentPeriod ? (
        <Card
          title={
            <span>
              {currentPeriod.period} 本期批次{" "}
              <Typography.Text type="secondary">
                · {visibleBatches.length} 个
              </Typography.Text>
            </span>
          }
          extra={
            <Space wrap>
              <Select
                allowClear
                placeholder="按主体筛选"
                value={subjectFilter}
                onChange={setSubjectFilter}
                options={subjects.map((subject) => ({
                  value: subject.id,
                  label: subject.name,
                }))}
              />
              <Select
                allowClear
                placeholder="按类型筛选"
                value={batchTypeFilter}
                onChange={setBatchTypeFilter}
                options={Object.entries(batchTypeLabels).map(
                  ([value, label]) => ({ value, label }),
                )}
              />
              <Select
                allowClear
                placeholder="按状态筛选"
                value={statusFilter}
                onChange={(value) => updateFilter("status", value)}
                options={Object.entries(statusLabels).map(([value, label]) => ({
                  value,
                  label,
                }))}
              />
            </Space>
          }
          className={styles.card}
        >
          {visibleBatches.length ? (
            <Table<PayrollBatch>
              rowKey="id"
              size="small"
              scroll={{ x: 1120 }}
              dataSource={visibleBatches}
              pagination={false}
              columns={[
                {
                  title: "批次",
                  render: (_, row) => (
                    <>
                      <Link className={styles.mono} to={batchPath(row)}>
                        {row.subject.code}-
                        {row.batch_type === "supplement" ? "S" : "N"}
                        {row.batch_no}
                      </Link>
                      <div className={styles.sub}>
                        {batchTypeLabels[row.batch_type]}
                        {row.name ? ` · ${row.name}` : ""}
                      </div>
                    </>
                  ),
                },
                {
                  title: "主体",
                  render: (_, row) => (
                    <>
                      {row.subject.name}
                      <div className={styles.sub}>{row.subject.code}</div>
                    </>
                  ),
                },
                {
                  title: "员工范围",
                  render: (_, row) => (
                    <>
                      <strong>{row.scope.employee_count} 人</strong>
                      <div className={styles.sub}>
                        {row.scope.source === "supplement_inputs"
                          ? "本批补发员工"
                          : row.scope.source ===
                              "employee_assignment_for_period"
                            ? "期间有效任职关系"
                            : "已确认试算快照"}
                      </div>
                      {row.scope.status === "blocked" ? (
                        <Tag color="error">存在归属歧义</Tag>
                      ) : null}
                    </>
                  ),
                },
                {
                  title: "数据准备",
                  render: (_, row) => (
                    <Space wrap>
                      {preparationTag("考勤", row.data_preparation.attendance)}
                      {preparationTag("绩效", row.data_preparation.performance)}
                      {preparationTag("规则", row.data_preparation.city_rules)}
                    </Space>
                  ),
                },
                {
                  title: "状态",
                  render: (_, row) => (
                    <Tag color={statusColor(row.status)}>
                      {statusLabels[row.status]}
                    </Tag>
                  ),
                },
                {
                  title: "发放日期",
                  render: (_, row) =>
                    row.payment_date ?? (
                      <span className={styles.muted}>
                        {row.batch_type === "supplement" ? "未填写" : "未确认"}
                      </span>
                    ),
                },
                {
                  title: "操作",
                  fixed: "right",
                  width: 180,
                  render: (_, row) => (
                    <Space direction="vertical" size={4}>
                      <Link to={batchPath(row)}>
                        {row.status === "draft" ? "进入核算" : "查看结果"}
                      </Link>
                      {row.batch_type === "normal" &&
                        ["draft", "trial"].includes(row.status) && (
                          <>
                            <Link to={importPath(row, "attendance")}>
                              导入考勤
                            </Link>
                            <Link to={importPath(row, "performance")}>
                              导入绩效
                            </Link>
                          </>
                        )}
                      {row.scope.employee_count === 0 && (
                        <Link
                          to={`/employees?period=${currentPeriod.period}&subject_id=${row.subject.id}&batch_id=${row.id}`}
                        >
                          核对员工及生效日期
                        </Link>
                      )}
                    </Space>
                  ),
                },
              ]}
            />
          ) : (
            <Empty description="本期间暂无批次，请建立工资批次" />
          )}
          <Alert
            className={styles.notice}
            type="info"
            showIcon
            message="实际发放日期尚未确认不影响本工作台查询或建批次；正式导出要求已锁定当前有效结果并确认发放日期。"
          />
        </Card>
      ) : null}

      <Modal
        title="建立工资期间"
        open={createPeriodOpen}
        onCancel={() => setCreatePeriodOpen(false)}
        onOk={() => periodForm.submit()}
        confirmLoading={periodMutation.isPending}
      >
        <Form
          form={periodForm}
          layout="vertical"
          onFinish={(values) => periodMutation.mutate(values)}
        >
          <Form.Item
            name="period"
            label="工资期间"
            rules={[
              {
                required: true,
                pattern: /^\d{4}-(0[1-9]|1[0-2])$/,
                message: "请输入 YYYY-MM，例如 2026-09",
              },
            ]}
          >
            <Input placeholder="2026-09" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`建立 ${currentPeriod?.period ?? ""} 批次`}
        open={createBatchOpen}
        forceRender
        onCancel={() => setCreateBatchOpen(false)}
        onOk={() => batchForm.submit()}
        confirmLoading={batchMutation.isPending}
      >
        <Form
          form={batchForm}
          layout="vertical"
          initialValues={{ batch_type: "normal" }}
          onFinish={(values) => batchMutation.mutate(values)}
        >
          <Form.Item
            name="subject_id"
            label="工资主体"
            rules={[{ required: true, message: "请选择工资主体" }]}
          >
            <Select
              options={subjects.map((subject) => ({
                value: subject.id,
                label: `${subject.name}（${subject.code}）`,
              }))}
              placeholder="请选择主体"
            />
          </Form.Item>
          <Form.Item
            name="batch_type"
            label="批次类型"
            rules={[{ required: true }]}
          >
            <Select
              options={[
                { value: "normal", label: batchTypeLabels.normal },
                { value: "supplement", label: batchTypeLabels.supplement },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="name"
            label={creatingBatchType === "supplement" ? "补发原因" : "批次备注"}
            rules={
              creatingBatchType === "supplement"
                ? [
                    {
                      required: true,
                      whitespace: true,
                      message: "请填写补发原因",
                    },
                  ]
                : []
            }
          >
            <Input maxLength={200} />
          </Form.Item>
          {creatingBatchType === "supplement" ? (
            <Form.Item
              name="payment_date"
              label="实际发放日期（可选）"
              preserve={false}
            >
              <Input type="date" />
            </Form.Item>
          ) : null}
          <Typography.Paragraph type="secondary" className={styles.formHint}>
            {creatingBatchType === "supplement"
              ? "独立补发只录入员工补发金额，不重算社保、公积金或考勤激励。"
              : "正常批次批次号由系统固定为 1，同主体同期间不能重复建立。"}
          </Typography.Paragraph>
        </Form>
      </Modal>
    </div>
  );
}
