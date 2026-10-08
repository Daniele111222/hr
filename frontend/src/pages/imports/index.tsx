import { useSearchParams } from "react-router-dom";
import {
  DownloadOutlined,
  InfoCircleOutlined,
  UploadOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Input,
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
  type EmployeeImportBatch,
  type ImportRow,
} from "../../shared/api/resources.ts";
import styles from "./index.module.less";
import { MonthlyImportsPage } from "./attendance.tsx";
import { ImportFailureTable } from "./failure-table.tsx";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

export function ImportsPage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get("type");
  const type =
    requested === "attendance" || requested === "performance"
      ? requested
      : "employee";
  const setType = (value: string) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("type", value);
      return next;
    });
  return (
    <>
      <Space wrap>
        <Button
          type={type === "employee" ? "primary" : "default"}
          onClick={() => setType("employee")}
        >
          员工资料
        </Button>
        <Button
          type={type === "attendance" ? "primary" : "default"}
          onClick={() => setType("attendance")}
        >
          月度考勤
        </Button>
        <Button
          type={type === "performance" ? "primary" : "default"}
          onClick={() => setType("performance")}
        >
          月度绩效
        </Button>
      </Space>
      {type === "employee" ? (
        <EmployeeImportsPage />
      ) : (
        <MonthlyImportsPage key={type} kind={type} />
      )}
    </>
  );
}

function EmployeeImportsPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const fileInput = useRef<HTMLInputElement>(null);
  const [selectedBatch, setSelectedBatch] =
    useState<EmployeeImportBatch | null>(null);
  const [previewBatch, setPreviewBatch] = useState<EmployeeImportBatch | null>(
    null,
  );
  const [readOnly, setReadOnly] = useState(false);
  const company = useQuery({
    queryKey: ["org", "company"],
    queryFn: resources.company,
  });
  const imports = useQuery({
    queryKey: ["employee-imports", company.data?.id],
    queryFn: () => resources.employeeImports(company.data!.id),
    enabled: !!company.data?.id,
  });
  const client = useQueryClient();
  const updateBatch = (batch: EmployeeImportBatch) => {
    void client.invalidateQueries({ queryKey: ["employee-imports"] });
    void client.invalidateQueries({ queryKey: ["org"] });
    void client.invalidateQueries({ queryKey: ["employees"] });
    void client.invalidateQueries({ queryKey: ["payroll"] });
    client.setQueryData(["employee-import", batch.id], batch);
    setPreviewBatch(batch);
    setSelectedBatch(batch);
    setReadOnly(false);
  };
  const upload = useMutation({
    mutationFn: (file: File) =>
      resources.uploadEmployeeImport(company.data!.id, file),
    onSuccess: (batch) => {
      updateBatch(batch);
      messageApi.success(
        `已完成校验：${batch.success_rows} 行通过，${batch.error_rows} 行失败`,
      );
    },
    onError: (error: Error) => messageApi.error(error.message),
  });
  const detail = useQuery({
    queryKey: ["employee-import", selectedBatch?.id],
    queryFn: () => resources.employeeImport(selectedBatch!.id),
    enabled: !!selectedBatch && !selectedBatch.rows,
    initialData: selectedBatch?.rows ? selectedBatch : undefined,
  });
  const rows = previewBatch?.rows ?? [];
  const activeDetail = readOnly ? detail.data : selectedBatch;

  const chooseFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      messageApi.error("员工导入仅支持 .xlsx 固定模板");
      return;
    }
    upload.mutate(file);
  };

  return (
    <div className={styles.page}>
      {contextHolder}
      <div className={styles.lead}>
        <div>
          <Typography.Title level={2}>数据导入</Typography.Title>
          <Typography.Paragraph type="secondary">
            员工资料使用固定模板。正确行先入库，错误行可逐行修正；导入历史的详情仅供查看。
          </Typography.Paragraph>
        </div>
        <Tag color="blue">
          员工资料 · {company.data?.name ?? "目标公司未初始化"}
        </Tag>
      </div>

      <Card
        title="导入流程"
        extra={
          <Typography.Text type="secondary">
            固定模板 · 原始文件可追溯
          </Typography.Text>
        }
      >
        <Steps
          current={2}
          size="small"
          items={[
            "选择类型与范围",
            "下载固定模板",
            "上传 Excel",
            "校验预览",
            "查看结果",
          ].map((title) => ({ title }))}
        />
      </Card>

      <Card title="导入设置" extra={<Tag color="geekblue">员工资料</Tag>}>
        <div className={styles.settings}>
          <div className={styles.scope}>
            <Typography.Text type="secondary">导入范围</Typography.Text>
            <strong>{company.data?.name ?? "请先维护目标公司"}</strong>
            <span>证件号码是唯一匹配键。</span>
          </div>
          <Alert
            type="info"
            showIcon
            icon={<InfoCircleOutlined />}
            message="员工资料模板 TPL-EMP-v3"
            description="固定 27 列，表头、工作表名称和列顺序固定。证件号码、手机号、银行卡号按文本填写。主体须已维护；缺失部门会按层级自动创建并关联所属主体，已有部门直接复用。员工编号自动生成，默认正式员工；base 城市按主体名称匹配，分公司所在地优先；生效日期为本次导入日期。转正固定薪资与绩效标准按实际金额填写，不限制比例；试用期底薪相同、绩效为 0。日期和薪资列支持本行引用、四则运算、括号、ROUND 和 EDATE；其他公式请先转为实际值。"
            action={
              <Button
                size="small"
                icon={<DownloadOutlined />}
                href={`${API_BASE}/imports/employee-template`}
              >
                下载模板
              </Button>
            }
          />
          <button
            type="button"
            className={styles.dropzone}
            onClick={() => fileInput.current?.click()}
            disabled={!company.data || upload.isPending}
          >
            <UploadOutlined className={styles.dropIcon} />
            <strong>
              {upload.isPending
                ? "正在上传并校验…"
                : "把 Excel 拖到这里，或点击选择文件"}
            </strong>
            <span>支持 .xlsx，单次不超过 20MB；必须使用当前模板</span>
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

      <Card
        title="校验预览"
        extra={
          previewBatch ? (
            <Tag color={previewBatch.error_rows ? "warning" : "success"}>
              {previewBatch.status === "imported" ? "全部成功" : "部分成功"}
            </Tag>
          ) : null
        }
      >
        {previewBatch ? (
          <>
            <div className={styles.metrics}>
              <Metric
                label="处理行数"
                value={previewBatch.total_rows}
                hint="参与本次校验的数据行"
              />
              <Metric
                label="通过行数"
                value={previewBatch.success_rows}
                hint="校验通过并写入员工主档"
              />
              <Metric
                label="错误行数"
                value={previewBatch.error_rows}
                warning
                hint="保留失败原因，只读查看"
              />
            </div>
            {previewBatch.error_rows ? (
              <Alert
                className={styles.notice}
                type="warning"
                showIcon
                icon={<WarningOutlined />}
                message="正确行已先入库，失败原因保留"
                description="失败行不会影响已写入的员工；请修改源文件后重新导入，可在本次上传结果中逐行修正。"
              />
            ) : (
              <Alert
                className={styles.notice}
                type="success"
                showIcon
                message="本次导入已完成。"
              />
            )}
            <Table<ImportRow>
              size="small"
              rowKey="id"
              dataSource={rows.slice(0, 8)}
              pagination={false}
              scroll={{ x: 720 }}
              columns={[
                {
                  title: "原始行号",
                  dataIndex: "source_row_number",
                  width: 90,
                },
                {
                  title: "证件号码",
                  render: (_, row) => (
                    <span className={styles.mono}>
                      {row.raw_data["证件号码"] ||
                        row.raw_data["身份证号"] ||
                        "—"}
                    </span>
                  ),
                },
                {
                  title: "姓名",
                  render: (_, row) => row.raw_data["姓名"] || "—",
                },
                {
                  title: "状态",
                  width: 100,
                  render: (_, row) =>
                    row.validation_status === "invalid" ? (
                      <Tag color="error">错误</Tag>
                    ) : (
                      <Tag color="success">已入库</Tag>
                    ),
                },
                {
                  title: "错误",
                  render: (_, row) => row.errors?.[0]?.message ?? "—",
                },
              ]}
            />
            <div className={styles.previewActions}>
              <Button
                onClick={() => {
                  setReadOnly(false);
                  setSelectedBatch(previewBatch);
                }}
              >
                查看导入批次详情与纠错 ({previewBatch.error_rows})
              </Button>
            </div>
          </>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="上传员工模板后显示校验结果"
          />
        )}
      </Card>

      <Card
        title="导入历史"
        extra={
          <Typography.Text type="secondary">
            保留文件哈希与模板版本
          </Typography.Text>
        }
      >
        <Table<EmployeeImportBatch>
          size="small"
          rowKey="id"
          loading={imports.isLoading}
          dataSource={imports.data ?? []}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          locale={{ emptyText: "暂无员工资料导入记录" }}
          scroll={{ x: 780 }}
          columns={[
            { title: "类型", render: () => "员工资料" },
            { title: "文件名", dataIndex: "original_filename" },
            {
              title: "模板版本",
              dataIndex: "template_version",
              className: styles.mono,
            },
            { title: "成功行", dataIndex: "success_rows", align: "right" },
            { title: "失败行", dataIndex: "error_rows", align: "right" },
            {
              title: "状态",
              render: (_, row) => (
                <Tag color={row.error_rows ? "warning" : "success"}>
                  {row.error_rows ? "部分成功" : "全部成功"}
                </Tag>
              ),
            },
            {
              title: "操作",
              render: (_, row) => (
                <Button
                  type="link"
                  size="small"
                  onClick={() => {
                    setReadOnly(true);
                    setSelectedBatch(row);
                  }}
                >
                  查看详情
                </Button>
              ),
            },
          ]}
        />
      </Card>

      <Drawer
        title={selectedBatch ? `导入批次 #${selectedBatch.id}` : "导入批次"}
        open={!!selectedBatch}
        onClose={() => setSelectedBatch(null)}
        width="min(780px, 100vw)"
      >
        {readOnly && detail.isError ? (
          <Alert
            type="error"
            showIcon
            message="导入批次详情读取失败"
            description={detail.error.message}
            action={<Button onClick={() => void detail.refetch()}>重试</Button>}
          />
        ) : activeDetail ? (
          <ImportDetail
            batch={activeDetail}
            readOnly={readOnly}
            onUpdated={updateBatch}
          />
        ) : (
          <Typography.Text>正在加载导入批次详情…</Typography.Text>
        )}
      </Drawer>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  warning = false,
}: {
  label: string;
  value: number;
  hint: string;
  warning?: boolean;
}) {
  return (
    <div className={`${styles.metric} ${warning ? styles.warningMetric : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}

function ImportDetail({
  batch,
  readOnly,
  onUpdated,
}: {
  batch: EmployeeImportBatch;
  readOnly: boolean;
  onUpdated: (batch: EmployeeImportBatch) => void;
}) {
  const errorRows =
    batch.rows?.filter((row) => row.validation_status === "invalid") ?? [];
  const [editing, setEditing] = useState<number | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const startEdit = (row: ImportRow) => {
    const field = row.errors?.[0]?.field;
    setEditing(row.id);
    setValues(
      field
        ? {
            [field]:
              row.correction_values?.[field] ?? row.raw_data[field] ?? "",
          }
        : {},
    );
  };
  const save = async () => {
    if (readOnly || editing === null) return;
    setSaving(true);
    try {
      onUpdated(
        await resources.correctEmployeeImportRow(batch.id, editing, values),
      );
      setEditing(null);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "修正失败");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className={styles.detail}>
      <Alert
        type={errorRows.length ? "warning" : "success"}
        showIcon
        message={
          errorRows.length ? `${errorRows.length} 行导入失败` : "没有失败行"
        }
        description={
          readOnly
            ? "历史详情只读，保留原始值、字段位置及全部失败原因。"
            : "错误行可逐行修正并重新校验，已入库的其他行不会重复写入。"
        }
      />
      <Descriptions batch={batch} />
      {readOnly ? (
        <ImportFailureTable rows={errorRows} />
      ) : (
        <Table<ImportRow>
          size="small"
          rowKey="id"
          dataSource={errorRows}
          pagination={false}
          columns={[
            { title: "原始行号", dataIndex: "source_row_number" },
            { title: "字段", render: (_, row) => row.errors?.[0]?.field },
            {
              title: "文件中的值",
              render: (_, row) =>
                row.errors?.[0] ? row.raw_data[row.errors[0].field] : "—",
            },
            { title: "错误", render: (_, row) => row.errors?.[0]?.message },
            {
              title: "操作",
              render: (_, row) =>
                editing === row.id ? (
                  <Space>
                    <Input
                      size="small"
                      value={Object.values(values)[0] ?? ""}
                      aria-label="修正值"
                      onChange={(event) =>
                        setValues({
                          [row.errors?.[0]?.field ?? ""]: event.target.value,
                        })
                      }
                    />
                    <Button
                      size="small"
                      type="primary"
                      loading={saving}
                      onClick={() => void save()}
                    >
                      保存修正
                    </Button>
                  </Space>
                ) : (
                  <Button
                    size="small"
                    type="link"
                    onClick={() => startEdit(row)}
                  >
                    修正
                  </Button>
                ),
            },
          ]}
        />
      )}
    </div>
  );
}

function Descriptions({ batch }: { batch: EmployeeImportBatch }) {
  return (
    <div className={styles.descriptionGrid}>
      <span>文件</span>
      <strong>{batch.original_filename}</strong>
      <span>哈希</span>
      <code>{batch.file_sha256}</code>
      <span>模板</span>
      <strong>{batch.template_version}</strong>
      <span>原文件</span>
      <a href={`${API_BASE}/imports/${batch.id}/file`}>下载原文件</a>
      <span>成功 / 失败</span>
      <strong>
        {batch.success_rows} / {batch.error_rows}
      </strong>
    </div>
  );
}
