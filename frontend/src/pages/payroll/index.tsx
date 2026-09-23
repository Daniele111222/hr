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

function preparationTag(label: string, item: PayrollBatch["data_preparation"]["attendance"]) {
  if (item.status === "not_required") return <Tag>{label} 无需准备</Tag>;
  const color = item.status === "ready" ? "success" : item.status === "partial" ? "warning" : "error";
  return <Tag color={color}>{label} {item.prepared_count}/{item.prepared_count + item.missing_count}</Tag>;
}

export function PayrollPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const subjectsQuery = useQuery({ queryKey: ["org", "subjects"], queryFn: resources.subjects });
  const [selectedPeriod, setSelectedPeriod] = useState<string>();
  const [subjectFilter, setSubjectFilter] = useState<number>();
  const [batchTypeFilter, setBatchTypeFilter] = useState<BatchType>();
  const [createPeriodOpen, setCreatePeriodOpen] = useState(false);
  const [createBatchOpen, setCreateBatchOpen] = useState(false);
  const [periodForm] = Form.useForm<{ period: string }>();
  const [batchForm] = Form.useForm<{
    subject_id: number;
    batch_type: "normal";
    name?: string;
  }>();

  const workbench = useQuery({
    queryKey: ["payroll", "workbench", selectedPeriod],
    queryFn: () => resources.payrollWorkbench(selectedPeriod),
  });
  const data = workbench.data;
  const activePeriod = selectedPeriod ?? data?.periods[0]?.period;

  const currentPeriod = data?.period ?? data?.periods.find((item) => item.period === activePeriod);
  const visibleBatches = useMemo(
    () =>
      (data?.batches ?? []).filter(
        (batch) =>
          (subjectFilter === undefined || batch.subject.id === subjectFilter) &&
          (batchTypeFilter === undefined || batch.batch_type === batchTypeFilter),
      ),
    [batchTypeFilter, data?.batches, subjectFilter],
  );
  const subjects = subjectsQuery.data ?? [];

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["payroll", "workbench"] });
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
    mutationFn: (values: { subject_id: number; batch_type: "normal"; name?: string }) =>
      resources.createPayrollBatch(currentPeriod!.id, values),
    onSuccess: () => {
      message.success("工资批次已建立");
      setCreateBatchOpen(false);
      batchForm.resetFields();
      refresh();
    },
    onError: (error) => message.error(error.message),
  });

  if (workbench.isLoading) {
    return <div className={styles.loading}><Spin tip="正在加载工资期间…" /></div>;
  }
  if (workbench.error) {
    return <Alert type="error" showIcon title="工资工作台加载失败" description={workbench.error.message} />;
  }

  return (
    <div className={styles.page}>
      <section className={styles.lead}>
        <div>
          <Typography.Title level={2}>工资期间与批次</Typography.Title>
          <Typography.Paragraph type="secondary">
            工资期间按自然月管理；员工范围来自期间内有效任职关系，不以导入成功行数替代完整员工名册。
          </Typography.Paragraph>
        </div>
        <Space>
          <Button icon={<PlusOutlined />} onClick={() => setCreatePeriodOpen(true)}>建立工资期间</Button>
          <Button type="primary" icon={<PlusOutlined />} disabled={!currentPeriod} onClick={() => setCreateBatchOpen(true)}>
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
            rowClassName={(row) => row.period === activePeriod ? styles.selectedRow : ""}
            onRow={(row) => ({ onClick: () => setSelectedPeriod(row.period) })}
            columns={[
              { title: "工资期间", dataIndex: "period", render: (value) => <span className={styles.mono}>{value}</span> },
              { title: "自然月", render: (_, row) => <span className={styles.mono}>{row.period_start} 至 {row.period_end}</span> },
              { title: "批次", dataIndex: "batch_count" },
              { title: "正常批次", dataIndex: "normal_batch_count" },
              { title: "发放日期", render: (_, row) => row.payment_date ?? <Tag>未确认</Tag> },
            ]}
          />
        ) : <Empty description="暂无工资期间，请先建立期间" />}
      </Card>

      {currentPeriod ? (
        <Card
          title={<span>{currentPeriod.period} 本期批次 <Typography.Text type="secondary">· {visibleBatches.length} 个</Typography.Text></span>}
          extra={<Space wrap>
            <Select allowClear placeholder="按主体筛选" value={subjectFilter} onChange={setSubjectFilter} options={subjects.map((subject) => ({ value: subject.id, label: subject.name }))} />
            <Select allowClear placeholder="按类型筛选" value={batchTypeFilter} onChange={setBatchTypeFilter} options={Object.entries(batchTypeLabels).map(([value, label]) => ({ value, label }))} />
          </Space>}
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
                { title: "批次", render: (_, row) => <><span className={styles.mono}>{row.subject.code}-N{row.batch_no}</span><div className={styles.sub}>{batchTypeLabels[row.batch_type]}</div></> },
                { title: "主体", render: (_, row) => <>{row.subject.name}<div className={styles.sub}>{row.subject.code}</div></> },
                { title: "员工范围", render: (_, row) => <><strong>{row.scope.employee_count} 人</strong><div className={styles.sub}>{row.scope.source === "employee_assignment_for_period" ? "期间有效任职关系" : row.scope.source}</div>{row.scope.status === "blocked" ? <Tag color="error">存在归属歧义</Tag> : null}</> },
                { title: "数据准备", render: (_, row) => <Space wrap>{preparationTag("考勤", row.data_preparation.attendance)}{preparationTag("绩效", row.data_preparation.performance)}{preparationTag("规则", row.data_preparation.city_rules)}</Space> },
                { title: "状态", render: (_, row) => <Tag color={statusColor(row.status)}>{statusLabels[row.status]}</Tag> },
                { title: "发放日期", render: (_, row) => row.payment_date ?? <span className={styles.muted}>未确认</span> },
              ]}
            />
          ) : <Empty description="本期间暂无批次，请建立主体正常工资批次" />}
          <Alert className={styles.notice} type="info" showIcon message="实际发放日期尚未确认不影响本工作台查询或建批次；正式导出门槛将在后续导出任务中处理。" />
        </Card>
      ) : null}

      <Modal title="建立工资期间" open={createPeriodOpen} onCancel={() => setCreatePeriodOpen(false)} onOk={() => periodForm.submit()} confirmLoading={periodMutation.isPending}>
        <Form form={periodForm} layout="vertical" onFinish={(values) => periodMutation.mutate(values)}>
          <Form.Item name="period" label="工资期间" rules={[{ required: true, pattern: /^\d{4}-(0[1-9]|1[0-2])$/, message: "请输入 YYYY-MM，例如 2026-09" }]}>
            <Input placeholder="2026-09" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={`建立 ${currentPeriod?.period ?? ""} 批次`} open={createBatchOpen} onCancel={() => setCreateBatchOpen(false)} onOk={() => batchForm.submit()} confirmLoading={batchMutation.isPending}>
        <Form form={batchForm} layout="vertical" initialValues={{ batch_type: "normal" }} onFinish={(values) => batchMutation.mutate(values)}>
          <Form.Item name="subject_id" label="工资主体" rules={[{ required: true, message: "请选择工资主体" }]}>
            <Select options={subjects.map((subject) => ({ value: subject.id, label: `${subject.name}（${subject.code}）` }))} placeholder="请选择主体" />
          </Form.Item>
          <Form.Item name="batch_type" label="批次类型" rules={[{ required: true }]}>
            <Select options={[{ value: "normal", label: batchTypeLabels.normal }]} />
          </Form.Item>
          <Form.Item name="name" label="批次备注"><Input maxLength={200} /></Form.Item>
          <Typography.Paragraph type="secondary" className={styles.formHint}>正常批次批次号由系统固定为 1，同主体同期间不能重复建立。</Typography.Paragraph>
        </Form>
      </Modal>
    </div>
  );
}
