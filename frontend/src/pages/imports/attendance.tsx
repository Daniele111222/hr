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
const attendanceFields = new Set([
  "身份证号",
  "姓名",
  "公司",
  "应出勤天数",
  "迟到分钟",
  "早退分钟",
  "未补卡次数",
  "旷工天数",
  "事假天数",
  "病假天数",
  "年假天数",
  "产假天数",
  "产检假天数",
  "陪产假天数",
  "育儿假天数",
  "婚假天数",
  "丧假天数",
  "其他福利假",
  "调休天数",
  "工作日天数合计",
  "迟到时长",
  "早退时长",
  "缺卡次数",
  "有薪请假天数",
  "无薪请假天数",
  "忘打卡次数",
  "补卡次数",
  "来源说明",
]);

export function MonthlyImportsPage({ kind }: { kind: MonthlyKind }) {
  const performance = kind === "performance";
  const label = performance ? "绩效" : "考勤";
  const [messageApi, contextHolder] = message.useMessage();
  const fileInput = useRef<HTMLInputElement>(null);
  const [params, setParams] = useSearchParams();
  const period = params.get("period") ?? undefined;
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
  const selectedPeriod = current?.period;
  const sourceBatchId = Number(
    params.get("source_batch_id") ?? params.get("batch_id"),
  );
  const sourceBatch = current?.batches.find(
    (item) => item.id === sourceBatchId,
  );
  const periodQuery = selectedPeriod ? `period=${selectedPeriod.period}` : "";
  const upload = useMutation<MonthlyBatch, Error, File>({
    mutationFn: async (file: File) => {
      if (!company.data || !selectedPeriod)
        throw new Error("请选择已建立的工资期间");
      return performance
        ? await resources.uploadPerformanceImport(
            company.data.id,
            selectedPeriod.id,
            file,
          )
        : await resources.uploadAttendanceImport(
            company.data.id,
            selectedPeriod.id,
            file,
          );
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
    if (!file || !company.data || !selectedPeriod || upload.isPending) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      messageApi.error(`${label}导入仅支持 .xlsx 固定模板`);
    } else {
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
              ? "按工资期间导入全公司绩效系数，有效行按当期任职归集并自动补齐草稿正常批次。试用期不考核绩效；转正当月需填写系数。正确行先保存，错误行可逐行修正；历史详情只读。"
              : "按工资期间导入全公司考勤事实，有效行按当期任职归集并自动补齐草稿正常批次。正确行先保存，错误行可逐行修正；历史详情只读，扣款由试算统一计算。"}
          </Typography.Paragraph>
        </div>
        <Space wrap>
          {sourceBatch && (
            <Link
              to={`/payroll/batches/${sourceBatch.id}?${periodQuery}&subject_id=${sourceBatch.subject.id}`}
            >
              返回来源批次核算
            </Link>
          )}
          <Link to={`/payroll?${periodQuery}`}>返回本期工资核算</Link>
          <Tag color="blue">{company.data?.name ?? "目标公司未初始化"}</Tag>
        </Space>
      </div>

      <Card title="导入流程">
        <Steps
          size="small"
          current={preview ? 3 : 2}
          items={[
            "选择类型与范围",
            "下载固定模板",
            "上传并导入",
            "查看导入结果",
            "修正后返回试算",
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
                  setParams((current) => {
                    const next = new URLSearchParams(current);
                    next.set("period", value);
                    next.delete("batch_id");
                    next.delete("source_batch_id");
                    next.delete("subject_id");
                    return next;
                  });
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
            <Tag color="blue">全公司所有主体</Tag>
          </Space>
          {(workbench.isError || otherPeriod.isError) && (
            <Alert type="error" showIcon message="工资期间读取失败" />
          )}
          {!workbench.isLoading &&
            !otherPeriod.isLoading &&
            !selectedPeriod && (
              <Alert
                type="info"
                showIcon
                message="请先建立并选择工资期间，无需提前建立主体批次"
                action={<Link to="/payroll">去建立工资期间</Link>}
              />
            )}
          <Alert
            type="info"
            showIcon
            message={performance ? "固定模板 TPL-PERF-v1" : "考勤导入模版"}
            description={
              performance
                ? "身份证号按文本填写；系数须为非负数，不设固定上限。缺失和零值不同；公式按行报错。"
                : "新版 TPL-ATT-v3 固定 19 列，首行为表头；仅填写员工标识、应出勤、考勤异常及各类假期，不填写薪资或扣款。身份证号按文本填写，公司须与员工当期归属主体一致。应出勤天数填写考勤表核定的工作日合计，须大于零且不超过当月自然日天数；迟到、早退按分钟填写，未补卡次数不包含已补卡。事假、旷工为无薪，其余假期为有薪并参与激励资格判断。原工作簿请将所需列粘贴为值到模板；继续兼容 48 列 v2 及 v1。有效输入支持本行引用、四则运算、括号、ROUND；旧模板日期依赖支持 EDATE。只计算有效输入及其必要依赖，无关公式仅保留原文；SUM、IF、跨表等无法求值的有效输入请转为实际值。"
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
            disabled={!company.data || !selectedPeriod || upload.isPending}
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

      <Card title="导入结果" extra={preview && <StatusTag batch={preview} />}>
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
              description={`${label}变化会使旧试算失效，后续需要重新试算并核对。${performance ? "" : "本页仅展示考勤事实，扣款由工资试算统一计算。"}`}
            />
            <SubjectSummary batch={preview} />
            <Table<ImportRow>
              size="small"
              rowKey="id"
              pagination={false}
              scroll={{ x: performance ? 760 : 1400 }}
              expandable={
                performance
                  ? undefined
                  : {
                      expandedRowRender: (row) => (
                        <RawAttendanceRow row={row} batch={preview} />
                      ),
                    }
              }
              dataSource={preview.rows?.slice(0, 8)}
              columns={rowColumns(preview)}
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
            description={`上传月度${label}模板后显示导入结果`}
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
            {
              title: "范围",
              render: (_, item) =>
                item.payroll_batch_id
                  ? `历史单主体：${item.subject_name}`
                  : `全公司 · ${item.subjects?.length ?? 0} 个已识别主体`,
            },
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

const rowColumns = (batch: MonthlyBatch) => [
  { title: "原始行", dataIndex: "source_row_number" },
  {
    title: "身份证号",
    render: (_: unknown, row: ImportRow) =>
      row.correction_values?.["身份证号"] ?? row.raw_data["身份证号"],
  },
  {
    title: "姓名",
    render: (_: unknown, row: ImportRow) =>
      row.correction_values?.["姓名"] ?? row.raw_data["姓名"],
  },
  {
    title: "归属主体",
    render: (_: unknown, row: ImportRow) =>
      batch.subjects?.find((item) => item.subject_id === row.subject_id)
        ?.subject_name ?? "待核对",
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
  ...(batch.import_type === "attendance"
    ? [
        ["应出勤天数", "expected_work_days"],
        ["迟到分钟", "late_minutes"],
        ["早退分钟", "early_leave_minutes"],
        ["有薪假天数", "paid_leave_days"],
        ["无薪假天数", "unpaid_leave_days"],
      ]
        .map(([title, key]) => ({
          title,
          render: (_: unknown, row: ImportRow) =>
            String(row.normalized_data?.[key] ?? "—"),
        }))
        .concat([
          {
            title: "未补卡次数",
            render: (_: unknown, row: ImportRow) =>
              row.normalized_data?.missed_punch_count != null &&
              row.normalized_data?.corrected_punch_count != null
                ? String(
                    Number(row.normalized_data.missed_punch_count) -
                      Number(row.normalized_data.corrected_punch_count),
                  )
                : "—",
          },
        ])
    : []),
  {
    title: "校验错误",
    render: (_: unknown, row: ImportRow) =>
      row.errors?.map((item) => item.message).join("；") ?? "—",
  },
];

function RawAttendanceRow({
  row,
  batch,
}: {
  row: ImportRow;
  batch: MonthlyBatch;
}) {
  return (
    <Table
      size="small"
      rowKey="field"
      pagination={false}
      scroll={{ x: 640 }}
      dataSource={Object.entries(row.raw_data).map(([field, value]) => ({
        field,
        value,
        correction: row.correction_values?.[field],
      }))}
      columns={[
        {
          title: "字段 / 原始位置",
          render: (_, item) =>
            `${item.field}（${batch.field_mapping[item.field]}${row.source_row_number}）`,
        },
        {
          title: "原始数据（只读）",
          dataIndex: "value",
          render: (value) => value || "—",
        },
        {
          title: "修正值",
          dataIndex: "correction",
          render: (value) => value ?? "—",
        },
      ]}
    />
  );
}

function SubjectSummary({ batch }: { batch: MonthlyBatch }) {
  if (!batch.subjects?.length) return null;
  return (
    <Table
      size="small"
      rowKey="subject_id"
      pagination={false}
      scroll={{ x: 580 }}
      dataSource={batch.subjects}
      columns={[
        { title: "归属主体", dataIndex: "subject_name" },
        { title: "通过行", dataIndex: "success_rows", align: "right" },
        { title: "失败行", dataIndex: "error_rows", align: "right" },
        {
          title: "工资批次",
          render: (_, row) =>
            row.payroll_batch_id ? (
              <Link to={`/payroll/batches/${row.payroll_batch_id}`}>
                查看核算 #{row.payroll_batch_id}
              </Link>
            ) : (
              "未建立"
            ),
        },
        {
          title: "批次处理",
          render: (_, row) =>
            row.batch_created
              ? "自动补齐草稿"
              : row.payroll_batch_id
                ? "沿用已有批次"
                : "行校验通过后补齐",
        },
      ]}
    />
  );
}

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
      <SubjectSummary batch={batch} />
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
                  scroll={{ x: kind === "attendance" ? 1400 : 760 }}
                  expandable={
                    kind === "attendance"
                      ? {
                          expandedRowRender: (row) => (
                            <RawAttendanceRow row={row} batch={batch} />
                          ),
                        }
                      : undefined
                  }
                  pagination={{ pageSize: 8 }}
                  columns={rowColumns(batch)}
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
          scroll={{ x: kind === "attendance" ? 1400 : 760 }}
          expandable={
            kind === "attendance"
              ? {
                  expandedRowRender: (row) => (
                    <RawAttendanceRow row={row} batch={batch} />
                  ),
                }
              : undefined
          }
          pagination={{ pageSize: 8 }}
          columns={[
            ...rowColumns(batch),
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
          {kind === "attendance" && (
            <Typography.Text type="secondary">
              仅修正考勤输入；薪资、扣款等原始数据只读。无法求值的输入公式可填写核实后的实际值，原公式保留追溯。
            </Typography.Text>
          )}
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
              : Object.keys(editingRow.raw_data)
                  .filter((field) => attendanceFields.has(field))
                  .sort((left, right) => {
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
