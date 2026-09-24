import {
  CheckCircleOutlined,
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
import { useMemo, useRef, useState } from "react";
import {
  resources,
  type EmployeeImportBatch,
  type ImportRow,
} from "../../shared/api/resources.ts";
import styles from "./index.module.less";
import { AttendanceImportsPage } from "./attendance.tsx";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

export function ImportsPage() {
  const [type, setType] = useState<"employee" | "attendance">("employee");
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
        <Button disabled>月度绩效（后续提供）</Button>
      </Space>
      {type === "employee" ? (
        <EmployeeImportsPage />
      ) : (
        <AttendanceImportsPage />
      )}
    </>
  );
}

function EmployeeImportsPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const fileInput = useRef<HTMLInputElement>(null);
  const [selectedBatch, setSelectedBatch] =
    useState<EmployeeImportBatch | null>(null);
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
  const upload = useMutation({
    mutationFn: (file: File) =>
      resources.uploadEmployeeImport(company.data!.id, file),
    onSuccess: (batch) => {
      void client.invalidateQueries({ queryKey: ["employee-imports"] });
      setSelectedBatch(batch);
      messageApi.success(
        `已完成校验：${batch.success_rows} 行通过，${batch.error_rows} 行待修正`,
      );
    },
    onError: (error: Error) => messageApi.error(error.message),
  });
  const rows = selectedBatch?.rows ?? [];
  const errorRows = useMemo(
    () => rows.filter((row) => row.validation_status === "invalid"),
    [rows],
  );

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
            员工资料使用固定模板。正确行先入库，错误行留在批次中，修正后重新校验，不会重复导入。
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
            <span>身份证号是唯一匹配键；既有身份证不会被静默覆盖。</span>
          </div>
          <Alert
            type="info"
            showIcon
            icon={<InfoCircleOutlined />}
            message={`员工资料模板 ${"TPL-EMP-v2.4"}`}
            description="表头、工作表名称和列顺序固定。身份证号、银行卡号按文本保存，金额按 80%/20% 校验。"
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
          selectedBatch ? (
            <Tag color={selectedBatch.error_rows ? "warning" : "success"}>
              {selectedBatch.status === "imported" ? "全部成功" : "部分成功"}
            </Tag>
          ) : null
        }
      >
        {selectedBatch ? (
          <>
            <div className={styles.metrics}>
              <Metric
                label="总行数"
                value={selectedBatch.total_rows}
                hint="表头下方全部数据行"
              />
              <Metric
                label="通过行数"
                value={selectedBatch.success_rows}
                hint="校验通过并写入员工主档"
              />
              <Metric
                label="错误行数"
                value={selectedBatch.error_rows}
                warning
                hint="保留在批次中待修正"
              />
            </div>
            {selectedBatch.error_rows ? (
              <Alert
                className={styles.notice}
                type="warning"
                showIcon
                icon={<WarningOutlined />}
                message="正确行已先入库，错误行保留待修"
                description="错误行不会影响已写入的员工，但对应资料在修正并通过校验前不会进入员工主档。"
              />
            ) : (
              <Alert
                className={styles.notice}
                type="success"
                showIcon
                message="全部行校验通过，员工资料已写入。"
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
                  title: "身份证号",
                  render: (_, row) => (
                    <span className={styles.mono}>
                      {row.raw_data["身份证号"] || "—"}
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
              <Button onClick={() => setSelectedBatch(selectedBatch)}>
                查看导入批次详情与纠错 ({errorRows.length})
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
                  onClick={() => setSelectedBatch(row)}
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
        width={780}
      >
        {selectedBatch ? (
          <ImportDetail
            batch={selectedBatch}
            errorRows={errorRows}
            onUpdated={setSelectedBatch}
          />
        ) : null}
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
  errorRows,
  onUpdated,
}: {
  batch: EmployeeImportBatch;
  errorRows: ImportRow[];
  onUpdated: (batch: EmployeeImportBatch) => void;
}) {
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
    if (!editing) return;
    setSaving(true);
    try {
      const updated = await resources.correctEmployeeImportRow(
        batch.id,
        editing,
        values,
      );
      onUpdated(updated);
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
          errorRows.length
            ? `还有 ${errorRows.length} 行待修正`
            : "没有待修正行"
        }
        description={
          errorRows.length
            ? "错误行保留原始值、工作表和列位置；修正后重新上传一份新文件以保留完整原始批次。"
            : "本批次所有行已完成校验并写入员工主档。"
        }
      />
      <Descriptions batch={batch} />
      {errorRows.length ? (
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
                      onChange={(event) =>
                        setValues({
                          [row.errors?.[0]?.field ?? ""]: event.target.value,
                        })
                      }
                      aria-label="修正值"
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
      ) : (
        <Empty image={<CheckCircleOutlined />} description="全部行已入库" />
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
      <span>成功 / 错误</span>
      <strong>
        {batch.success_rows} / {batch.error_rows}
      </strong>
    </div>
  );
}
