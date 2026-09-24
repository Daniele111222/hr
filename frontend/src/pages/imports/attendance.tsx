import { DownloadOutlined, UploadOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Input,
  Select,
  Space,
  Steps,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import { useRef, useState } from "react";
import {
  resources,
  type AttendanceImportBatch,
  type ImportRow,
} from "../../shared/api/resources.ts";
import styles from "./index.module.less";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";
const fields = [
  "身份证号",
  "姓名",
  "应出勤天数",
  "迟到分钟",
  "早退分钟",
  "有薪请假天数",
  "无薪请假天数",
  "忘打卡次数",
  "补卡次数",
  "来源说明",
];

export function AttendanceImportsPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const fileInput = useRef<HTMLInputElement>(null);
  const [period, setPeriod] = useState<string>();
  const [batchId, setBatchId] = useState<number>();
  const [selected, setSelected] = useState<AttendanceImportBatch | null>(null);
  const [preview, setPreview] = useState<AttendanceImportBatch | null>(null);
  const client = useQueryClient();
  const company = useQuery({
    queryKey: ["org", "company"],
    queryFn: resources.company,
  });
  const workbench = useQuery({
    queryKey: ["payroll-workbench"],
    queryFn: () => resources.payrollWorkbench(),
  });
  const otherPeriod = useQuery({
    queryKey: ["payroll-workbench", period],
    queryFn: () => resources.payrollWorkbench(period),
    enabled: !!period && period !== workbench.data?.period?.period,
  });
  const history = useQuery({
    queryKey: ["attendance-imports", company.data?.id],
    queryFn: () => resources.attendanceImports(company.data!.id),
    enabled: !!company.data?.id,
  });
  const current =
    period && period !== workbench.data?.period?.period
      ? otherPeriod.data
      : workbench.data;
  const batches =
    current?.batches.filter(
      (item) =>
        item.batch_type === "normal" &&
        ["draft", "trial"].includes(item.status),
    ) ?? [];
  const chosenBatch = batches.find((item) => item.id === batchId) ?? batches[0];
  const upload = useMutation({
    mutationFn: (file: File) =>
      resources.uploadAttendanceImport(chosenBatch.id, file),
    onSuccess: (result) => {
      setPreview(result);
      setSelected(result);
      void client.invalidateQueries({ queryKey: ["attendance-imports"] });
      void client.invalidateQueries({ queryKey: ["payroll-workbench"] });
      messageApi.success(
        `已保存 ${result.success_rows} 行，${result.error_rows} 行待修正`,
      );
    },
    onError: (error: Error) => messageApi.error(error.message),
  });
  const chooseFile = (file?: File) => {
    if (!file || !chosenBatch || upload.isPending) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      messageApi.error("考勤导入仅支持 .xlsx 固定模板");
    } else if (chosenBatch) {
      upload.mutate(file);
    }
  };
  const openBatch = async (id: number) => {
    try {
      setSelected(await resources.attendanceImport(id));
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "读取导入批次失败",
      );
    }
  };
  const updateBatch = (result: AttendanceImportBatch) => {
    setSelected(result);
    if (preview?.id === result.id) setPreview(result);
    void client.invalidateQueries({ queryKey: ["attendance-imports"] });
    void client.invalidateQueries({ queryKey: ["payroll-workbench"] });
  };

  return (
    <div className={styles.page}>
      {contextHolder}
      <div className={styles.lead}>
        <div>
          <Typography.Title level={2}>月度考勤导入</Typography.Title>
          <Typography.Paragraph type="secondary">
            按工资期间和主体导入考勤事实。正确行先保存，错误行修正后重新校验；扣款由试算统一计算。
          </Typography.Paragraph>
        </div>
        <Tag color="blue">{company.data?.name ?? "目标公司未初始化"}</Tag>
      </div>

      <Card title="导入流程">
        <Steps
          size="small"
          current={2}
          items={[
            "选择类型与范围",
            "下载固定模板",
            "上传 Excel",
            "校验预览",
            "查看结果",
          ].map((title) => ({ title }))}
        />
      </Card>

      <Card title="导入设置" extra={<Tag color="geekblue">月度考勤</Tag>}>
        <div className={styles.settings}>
          <Space wrap>
            <label>
              工资期间{" "}
              <Select
                aria-label="工资期间"
                style={{ minWidth: 150 }}
                value={period ?? workbench.data?.period?.period}
                loading={workbench.isLoading}
                onChange={(value) => {
                  setPeriod(value);
                  setBatchId(undefined);
                }}
                options={
                  workbench.data?.periods.map((item) => ({
                    label: item.period,
                    value: item.period,
                  })) ?? []
                }
                placeholder="选择期间"
              />
            </label>
            <label>
              主体与批次{" "}
              <Select
                aria-label="主体与批次"
                style={{ minWidth: 230 }}
                value={chosenBatch?.id}
                onChange={setBatchId}
                loading={otherPeriod.isLoading}
                options={batches.map((item) => ({
                  label: `${item.subject.name} · 批次 #${item.id}`,
                  value: item.id,
                }))}
                placeholder="选择正常工资批次"
              />
            </label>
          </Space>
          {(workbench.isError || otherPeriod.isError) && (
            <Alert type="error" showIcon message="工资期间或批次读取失败" />
          )}
          {!workbench.isLoading && !otherPeriod.isLoading && !chosenBatch && (
            <Alert
              type="info"
              showIcon
              message="请先在工资核算中建立本期间的正常工资批次"
            />
          )}
          <Alert
            type="info"
            showIcon
            message="固定模板 TPL-ATT-v1"
            description="身份证号按文本填写；应出勤天数须大于零且不超过当月自然日天数。异常数值和公式按行报错。"
            action={
              <Button
                size="small"
                icon={<DownloadOutlined />}
                href={`${API_BASE}/imports/attendance-template`}
              >
                下载模板
              </Button>
            }
          />
          <button
            type="button"
            className={styles.dropzone}
            disabled={!chosenBatch || upload.isPending}
            onClick={() => fileInput.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              chooseFile(event.dataTransfer.files[0]);
            }}
          >
            <UploadOutlined className={styles.dropIcon} />
            <strong>
              {upload.isPending
                ? "正在上传并校验…"
                : "把 Excel 拖到这里，或点击选择文件"}
            </strong>
            <span>支持 .xlsx，单次不超过 20MB；原文件与逐行修正记录会保留</span>
          </button>
          <input
            ref={fileInput}
            className={styles.hiddenInput}
            type="file"
            accept=".xlsx"
            onChange={(event) => {
              chooseFile(event.target.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
        </div>
      </Card>

      <Card title="校验预览" extra={preview && <StatusTag batch={preview} />}>
        {preview ? (
          <>
            <div className={styles.metrics}>
              <Metric label="总行数" value={preview.total_rows} />
              <Metric label="已保存" value={preview.success_rows} />
              <Metric label="待修正" value={preview.error_rows} warning />
            </div>
            <Alert
              className={styles.notice}
              showIcon
              type={preview.error_rows ? "warning" : "success"}
              message={
                preview.error_rows
                  ? "正确行已保存，错误行未进入有效考勤"
                  : "全部行已保存为考勤事实"
              }
              description="考勤变化会使旧试算失效，后续需要重新试算并核对。"
            />
            <Table<ImportRow>
              size="small"
              rowKey="id"
              pagination={false}
              scroll={{ x: 760 }}
              dataSource={preview.rows?.slice(0, 8)}
              columns={rowColumns}
            />
            <div className={styles.previewActions}>
              <Button onClick={() => setSelected(preview)}>
                查看导入批次详情与纠错
              </Button>
            </div>
          </>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="上传月度考勤模板后显示校验结果"
          />
        )}
      </Card>

      <Card
        title="导入历史"
        extra={
          <Typography.Text type="secondary">
            原文件与修正记录可追溯
          </Typography.Text>
        }
      >
        {history.isError && (
          <Alert type="error" showIcon message="导入历史读取失败" />
        )}
        <Table<AttendanceImportBatch>
          size="small"
          rowKey="id"
          loading={history.isLoading}
          dataSource={history.data ?? []}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          locale={{ emptyText: "暂无月度考勤导入记录" }}
          scroll={{ x: 800 }}
          columns={[
            {
              title: "期间",
              render: (_, item) =>
                workbench.data?.periods.find(
                  (p) => p.id === item.payroll_period_id,
                )?.period ?? item.payroll_period_id,
            },
            { title: "主体", dataIndex: "subject_name" },
            { title: "批次", dataIndex: "payroll_batch_id" },
            { title: "文件名", dataIndex: "original_filename" },
            { title: "成功行", dataIndex: "success_rows", align: "right" },
            { title: "错误行", dataIndex: "error_rows", align: "right" },
            { title: "状态", render: (_, item) => <StatusTag batch={item} /> },
            {
              title: "操作",
              render: (_, item) => (
                <Button type="link" onClick={() => void openBatch(item.id)}>
                  查看详情
                </Button>
              ),
            },
          ]}
        />
      </Card>
      <Drawer
        title={
          selected ? `月度考勤导入批次 #${selected.id}` : "月度考勤导入批次"
        }
        open={!!selected}
        onClose={() => setSelected(null)}
        width="min(780px, 100vw)"
      >
        {selected && (
          <AttendanceDetail batch={selected} onUpdated={updateBatch} />
        )}
      </Drawer>
    </div>
  );
}

const rowColumns = [
  { title: "原始行", dataIndex: "source_row_number" },
  {
    title: "身份证号",
    render: (_: unknown, row: ImportRow) => row.raw_data["身份证号"],
  },
  {
    title: "姓名",
    render: (_: unknown, row: ImportRow) => row.raw_data["姓名"],
  },
  {
    title: "状态",
    render: (_: unknown, row: ImportRow) =>
      row.validation_status === "invalid" ? (
        <Tag color="error">错误</Tag>
      ) : (
        <Tag color="success">已保存</Tag>
      ),
  },
  {
    title: "校验错误",
    render: (_: unknown, row: ImportRow) =>
      row.errors?.map((item) => item.message).join("；") ?? "—",
  },
];

function StatusTag({ batch }: { batch: AttendanceImportBatch }) {
  return (
    <Tag color={batch.error_rows ? "warning" : "success"}>
      {batch.error_rows
        ? batch.success_rows
          ? "部分成功"
          : "全部待修正"
        : "全部成功"}
    </Tag>
  );
}

function Metric({
  label,
  value,
  warning,
}: {
  label: string;
  value: number;
  warning?: boolean;
}) {
  return (
    <div className={`${styles.metric} ${warning ? styles.warningMetric : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AttendanceDetail({
  batch,
  onUpdated,
}: {
  batch: AttendanceImportBatch;
  onUpdated: (batch: AttendanceImportBatch) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const save = async () => {
    if (editing === null || !Object.keys(values).length) return;
    setSaving(true);
    try {
      const result = await resources.correctAttendanceRow(
        batch.id,
        editing,
        values,
      );
      onUpdated(result);
      setEditing(null);
      setValues({});
      messageApi.success(
        result.rows?.find((row) => row.id === editing)?.validation_status ===
          "imported"
          ? "修正已入库"
          : "仍有校验错误，请继续修正",
      );
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "修正失败");
    } finally {
      setSaving(false);
    }
  };
  const invalid =
    batch.rows?.filter((row) => row.validation_status === "invalid") ?? [];
  const row = invalid.find((item) => item.id === editing);
  return (
    <div className={styles.detail}>
      {contextHolder}
      <Alert
        type={invalid.length ? "warning" : "success"}
        showIcon
        message={
          invalid.length ? `还有 ${invalid.length} 行待修正` : "全部行已保存"
        }
        description="每次修正都会重新校验该行；已保存的其他行不会重复入账。"
      />
      <div className={styles.descriptionGrid}>
        <span>文件</span>
        <strong>{batch.original_filename}</strong>
        <span>哈希</span>
        <code>{batch.file_sha256}</code>
        <span>模板</span>
        <strong>{batch.template_version}</strong>
        <span>原文件</span>
        <a href={`${API_BASE}/imports/attendance/${batch.id}/file`}>
          下载原文件
        </a>
        <span>成功 / 错误</span>
        <strong>
          {batch.success_rows} / {batch.error_rows}
        </strong>
      </div>
      <Table<ImportRow>
        size="small"
        rowKey="id"
        dataSource={batch.rows ?? []}
        scroll={{ x: 760 }}
        pagination={{ pageSize: 8 }}
        columns={[
          ...rowColumns,
          {
            title: "操作",
            render: (_: unknown, item: ImportRow) =>
              item.validation_status === "invalid" ? (
                <Button
                  type="link"
                  onClick={() => {
                    setEditing(item.id);
                    setValues({});
                  }}
                >
                  修正
                </Button>
              ) : null,
          },
        ]}
      />
      {row && (
        <div className={styles.correctionForm}>
          <Typography.Text strong>
            修正原始行 {row.source_row_number}
          </Typography.Text>
          <Alert
            type="error"
            showIcon
            message={row.errors
              ?.map((item) => `${item.field}：${item.message}`)
              .join("；")}
          />
          <div className={styles.correctionGrid}>
            {fields.map((field) => (
              <label key={field}>
                {field}
                <Input
                  aria-label={`修正${field}`}
                  value={
                    values[field] ??
                    row.correction_values?.[field] ??
                    row.raw_data[field] ??
                    ""
                  }
                  onChange={(event) =>
                    setValues((previous) => ({
                      ...previous,
                      [field]: event.target.value,
                    }))
                  }
                />
              </label>
            ))}
          </div>
          <Space>
            <Button
              type="primary"
              loading={saving}
              disabled={!Object.keys(values).length}
              onClick={() => void save()}
            >
              保存并重新校验
            </Button>
            <Button onClick={() => setEditing(null)}>取消</Button>
          </Space>
        </div>
      )}
    </div>
  );
}
