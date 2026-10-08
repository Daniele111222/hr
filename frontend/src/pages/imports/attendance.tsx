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
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  resources,
  type AttendanceImportBatch,
  type ImportRow,
  type PerformanceImportBatch,
} from "../../shared/api/resources.ts";
import styles from "./index.module.less";
import { ImportFailureTable } from "./failure-table.tsx";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";
type MonthlyKind = "attendance" | "performance";
type MonthlyBatch = AttendanceImportBatch | PerformanceImportBatch;
const performanceFields = ["身份证号", "姓名", "绩效系数", "来源说明"];

export function MonthlyImportsPage({ kind }: { kind: MonthlyKind }) {
  const performance = kind === "performance";
  const label = performance ? "绩效" : "考勤";
  const [messageApi, contextHolder] = message.useMessage();
  const fileInput = useRef<HTMLInputElement>(null);
  const [params, setParams] = useSearchParams();
  const period = params.get("period") ?? undefined;
  const batchId = params.has("batch_id")
    ? Number(params.get("batch_id"))
    : undefined;
  const subjectId = params.has("subject_id")
    ? Number(params.get("subject_id"))
    : undefined;
  const updateScope = (values: Record<string, string | undefined>) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(values)) {
        if (value === undefined) next.delete(key);
        else next.set(key, value);
      }
      return next;
    });
  const [selected, setSelected] = useState<MonthlyBatch | null>(null);
  const [preview, setPreview] = useState<MonthlyBatch | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const client = useQueryClient();
  const company = useQuery({
    queryKey: ["org", "company"],
    queryFn: resources.company,
  });
  const workbench = useQuery({
    queryKey: ["payroll", "workbench", undefined],
    queryFn: () => resources.payrollWorkbench(),
  });
  const otherPeriod = useQuery({
    queryKey: ["payroll", "workbench", period],
    queryFn: () => resources.payrollWorkbench(period),
    enabled: !!period && period !== workbench.data?.period?.period,
  });
  const history = useQuery<MonthlyBatch[]>({
    queryKey: [kind, "imports", company.data?.id],
    queryFn: async () =>
      performance
        ? await resources.performanceImports(company.data!.id)
        : await resources.attendanceImports(company.data!.id),
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
  const chosenBatch =
    batchId !== undefined
      ? batches.find(
          (item) =>
            item.id === batchId &&
            (subjectId === undefined || item.subject.id === subjectId),
        )
      : subjectId !== undefined
        ? batches.find((item) => item.subject.id === subjectId)
        : batches[0];
  const returnParams = new URLSearchParams(params);
  returnParams.delete("type");
  returnParams.delete("batch_id");
  if (current?.period?.period)
    returnParams.set("period", current.period.period);
  const returnBatchId =
    chosenBatch?.id ?? current?.batches.find((item) => item.id === batchId)?.id;
  const upload = useMutation<MonthlyBatch, Error, File>({
    mutationFn: async (file: File) => {
      if (!chosenBatch) throw new Error("请选择本期间可导入的正常工资批次");
      return performance
        ? await resources.uploadPerformanceImport(chosenBatch.id, file)
        : await resources.uploadAttendanceImport(chosenBatch.id, file);
    },
    onSuccess: (result) => {
      setReadOnly(false);
      setPreview(result);
      setSelected(result);
      void client.invalidateQueries({ queryKey: [kind, "imports"] });
      void client.invalidateQueries({ queryKey: ["payroll"] });
      messageApi.success(
        `已保存 ${result.success_rows} 行，${result.error_rows} 行失败`,
      );
    },
    onError: (error: Error) => messageApi.error(error.message),
  });
  const chooseFile = (file?: File) => {
    if (!file || !chosenBatch || upload.isPending) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      messageApi.error(`${label}导入仅支持 .xlsx 固定模板`);
    } else if (chosenBatch) {
      upload.mutate(file);
    }
  };
  const openBatch = async (id: number) => {
    try {
      const result = performance
        ? await resources.performanceImport(id)
        : await resources.attendanceImport(id);
      setReadOnly(true);
      setSelected(result);
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "读取导入批次失败",
      );
    }
  };

  const updateBatch = (result: MonthlyBatch) => {
    setPreview(result);
    setSelected(result);
    void client.invalidateQueries({ queryKey: [kind, "imports"] });
    void client.invalidateQueries({ queryKey: ["payroll"] });
  };

  return (
    <div className={styles.page}>
      {contextHolder}
      <div className={styles.lead}>
        <div>
          <Typography.Title level={2}>月度{label}导入</Typography.Title>
          <Typography.Paragraph type="secondary">
            {performance
              ? "按工资期间和主体导入绩效系数。试用期不考核绩效；转正当月需填写系数。正确行先保存，错误行可逐行修正；历史详情只读。"
              : "按工资期间和主体导入考勤事实。正确行先保存，错误行可逐行修正；历史详情只读，扣款由试算统一计算。"}
          </Typography.Paragraph>
        </div>
        <Space wrap>
          {returnBatchId && (
            <Link to={`/payroll/batches/${returnBatchId}?${returnParams}`}>
              返回当前批次核算
            </Link>
          )}
          <Link to={`/payroll?${returnParams}`}>返回本期工资核算</Link>
          <Tag color="blue">{company.data?.name ?? "目标公司未初始化"}</Tag>
        </Space>
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

      <Card title="导入设置" extra={<Tag color="geekblue">月度{label}</Tag>}>
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
                  updateScope({ period: value, batch_id: undefined });
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
                onChange={(value) =>
                  updateScope({
                    batch_id: String(value),
                    subject_id: String(
                      batches.find((item) => item.id === value)!.subject.id,
                    ),
                    period: current?.period?.period,
                  })
                }
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
              message={
                current?.batches.some((item) => item.batch_type === "normal")
                  ? "所选主体或批次不可导入，请选择本期间可导入的正常工资批次"
                  : "请先在工资核算中建立本期间的正常工资批次"
              }
              action={<Link to={`/payroll?${returnParams}`}>去建立批次</Link>}
            />
          )}
          <Alert
            type="info"
            showIcon
            message={performance ? "固定模板 TPL-PERF-v1" : "考勤导入模版"}
            description={
              performance
                ? "身份证号按文本填写；系数须为非负数，不设固定上限。缺失和零值不同；公式按行报错。"
                : "固定 48 列，首行为表头；公司须与所选主体一致，身份证号按文本填写。工作日天数合计为应出勤天数，须大于零且不超过当月自然日天数；迟到、早退时长按分钟填写，缺卡次数为未补卡次数。事假、旷工按无薪天数折算，病假、产假及其他假期按有薪保存。入离职未出勤天数仅留存，工资按员工主档入离职日期折算；薪资与扣款列仅供追溯，不覆盖主档或直接采用总扣款。日期和数值列支持本行引用、四则运算、括号、ROUND 和 EDATE，数值引用空白按 0 计算；SUM、IF、跨行、跨表及外部引用请先转为实际值。计算结果仍须通过考勤数值校验，公式原文保留追溯。"
            }
            action={
              <Button
                size="small"
                icon={<DownloadOutlined />}
                href={`${API_BASE}/imports/${kind}-template`}
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
            <span>支持 .xlsx，单次不超过 20MB；原文件与失败原因会保留</span>
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
              <Metric label="失败行" value={preview.error_rows} warning />
            </div>
            <Alert
              className={styles.notice}
              showIcon
              type={preview.error_rows ? "warning" : "success"}
              message={
                preview.error_rows
                  ? `正确行已保存，错误行未进入有效${label}`
                  : `全部行已保存为${label}事实`
              }
              description={`${label}变化会使旧试算失效，后续需要重新试算并核对。`}
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
              <Button
                onClick={() => {
                  setReadOnly(false);
                  setSelected(preview);
                }}
              >
                查看导入批次详情与纠错
              </Button>
            </div>
          </>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={`上传月度${label}模板后显示校验结果`}
          />
        )}
      </Card>

      <Card
        title="导入历史"
        extra={
          <Typography.Text type="secondary">
            原文件与失败原因可追溯
          </Typography.Text>
        }
      >
        {history.isError && (
          <Alert type="error" showIcon message="导入历史读取失败" />
        )}
        <Table<MonthlyBatch>
          size="small"
          rowKey="id"
          loading={history.isLoading}
          dataSource={history.data ?? []}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          locale={{ emptyText: `暂无月度${label}导入记录` }}
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
          selected
            ? `月度${label}导入批次 #${selected.id}`
            : `月度${label}导入批次`
        }
        open={!!selected}
        onClose={() => setSelected(null)}
        width="min(780px, 100vw)"
      >
        {selected && (
          <MonthlyDetail
            kind={kind}
            batch={selected}
            readOnly={readOnly}
            onUpdated={updateBatch}
          />
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

function StatusTag({ batch }: { batch: MonthlyBatch }) {
  return (
    <Tag color={batch.error_rows ? "warning" : "success"}>
      {batch.error_rows
        ? batch.success_rows
          ? "部分成功"
          : "全部失败"
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

function MonthlyDetail({
  kind,
  batch,
  readOnly,
  onUpdated,
}: {
  kind: MonthlyKind;
  batch: MonthlyBatch;
  readOnly: boolean;
  onUpdated: (batch: MonthlyBatch) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const save = async () => {
    if (readOnly || editing === null || !Object.keys(values).length) return;
    setSaving(true);
    try {
      const result =
        kind === "performance"
          ? await resources.correctPerformanceRow(batch.id, editing, values)
          : await resources.correctAttendanceRow(batch.id, editing, values);
      onUpdated(result);
      setEditing(null);
      setValues({});
      messageApi.success(
        result.rows?.find((item) => item.id === editing)?.validation_status ===
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
  const editingRow = invalid.find((item) => item.id === editing);
  return (
    <div className={styles.detail}>
      {contextHolder}
      <Alert
        type={invalid.length ? "warning" : "success"}
        showIcon
        message={invalid.length ? `${invalid.length} 行导入失败` : "没有失败行"}
        description={
          readOnly
            ? "历史详情只读，保留原始值、字段位置及全部失败原因。"
            : "每次修正都会重新校验该行；已保存的其他行不会重复入账。"
        }
      />
      <div className={styles.descriptionGrid}>
        <span>文件</span>
        <strong>{batch.original_filename}</strong>
        <span>哈希</span>
        <code>{batch.file_sha256}</code>
        <span>模板</span>
        <strong>{batch.template_version}</strong>
        <span>原文件</span>
        <a href={`${API_BASE}/imports/${kind}/${batch.id}/file`}>下载原文件</a>
        <span>成功 / 失败</span>
        <strong>
          {batch.success_rows} / {batch.error_rows}
        </strong>
      </div>
      {readOnly ? (
        <Tabs
          items={[
            {
              key: "failures",
              label: "失败原因",
              children: <ImportFailureTable rows={invalid} />,
            },
            {
              key: "all",
              label: "全部行",
              children: (
                <Table<ImportRow>
                  size="small"
                  rowKey="id"
                  dataSource={batch.rows ?? []}
                  scroll={{ x: 760 }}
                  pagination={{ pageSize: 8 }}
                  columns={rowColumns}
                />
              ),
            },
          ]}
        />
      ) : (
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
              render: (_, row: ImportRow) =>
                row.validation_status === "invalid" ? (
                  <Button
                    type="link"
                    onClick={() => {
                      setEditing(row.id);
                      setValues({});
                    }}
                  >
                    修正
                  </Button>
                ) : null,
            },
          ]}
        />
      )}
      {!readOnly && editingRow && (
        <div className={styles.correctionForm}>
          <Typography.Text strong>
            修正原始行 {editingRow.source_row_number}
          </Typography.Text>
          <Alert
            type="error"
            showIcon
            message={editingRow.errors
              ?.map((item) => `${item.field}：${item.message}`)
              .join("；")}
          />
          <div className={styles.correctionGrid}>
            {(kind === "performance"
              ? performanceFields
              : Object.keys(editingRow.raw_data).sort((left, right) => {
                  const a = batch.field_mapping[left] ?? "";
                  const b = batch.field_mapping[right] ?? "";
                  return a.length - b.length || a.localeCompare(b);
                })
            ).map((field) => (
              <label key={field}>
                {field}
                <Input
                  aria-label={`修正${field}`}
                  value={
                    values[field] ??
                    editingRow.correction_values?.[field] ??
                    editingRow.raw_data[field] ??
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
