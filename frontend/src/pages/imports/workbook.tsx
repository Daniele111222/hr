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
} from "antd";
import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  resources,
  type EmployeeImportBatch,
  type ImportRow,
  type WorkbookImport,
} from "../../shared/api/resources.ts";
import { ImportFailureTable } from "./failure-table.tsx";
import styles from "./index.module.less";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

export function WorkbookImportsPage() {
  const [params, setParams] = useSearchParams();
  const period = params.get("period") ?? undefined;
  const client = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<WorkbookImport | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const company = useQuery({
    queryKey: ["org", "company"],
    queryFn: resources.company,
  });
  const workbench = useQuery({
    queryKey: ["payroll", "workbench", period],
    queryFn: () => resources.payrollWorkbench(period),
  });
  const history = useQuery({
    queryKey: ["workbook", "imports", company.data?.id],
    queryFn: () => resources.workbookImports(company.data!.id),
    enabled: !!company.data,
  });
  const detail = useQuery({
    queryKey: ["workbook", "import", selectedId],
    queryFn: () => resources.workbookImport(selectedId!),
    enabled: selectedId !== null,
  });
  const selectedPeriod = workbench.data?.period;
  const updateTask = (task: WorkbookImport, currentOnly = false) => {
    setPreview((current) =>
      !currentOnly || current?.id === task.id ? task : current,
    );
    client.setQueryData(["workbook", "import", task.id], task);
    void client.invalidateQueries({ queryKey: ["workbook", "imports"] });
    void client.invalidateQueries({ queryKey: ["employee-imports"] });
    void client.invalidateQueries({ queryKey: ["attendance", "imports"] });
    void client.invalidateQueries({ queryKey: ["employees"] });
    void client.invalidateQueries({ queryKey: ["org"] });
    void client.invalidateQueries({ queryKey: ["payroll"] });
  };
  const upload = useMutation({
    mutationFn: (file: File) => {
      if (!company.data || !selectedPeriod)
        throw new Error("请选择已建立的工资期间");
      return resources.uploadWorkbookImport(
        company.data.id,
        selectedPeriod.id,
        file,
      );
    },
    onSuccess: (task) => updateTask(task),
  });
  const chooseFile = (file?: File) => {
    if (
      !file ||
      upload.isPending ||
      !company.data ||
      !selectedPeriod ||
      workbench.isFetching
    )
      return;
    setFileError(null);
    upload.reset();
    if (!file.name.toLowerCase().endsWith(".xlsx"))
      setFileError("整本导入仅支持 .xlsx 工作簿");
    else if (file.size > 20 * 1024 * 1024) setFileError("文件不能超过 20MB");
    else upload.mutate(file);
  };
  return (
    <div className={styles.page}>
      <div className={styles.lead}>
        <div>
          <Typography.Title level={2}>整本工资工作簿导入</Typography.Title>
          <Typography.Paragraph type="secondary">
            先处理花名册，再保存全公司考勤。工资、扣款、绩效和税务结果只保留来源，不成为月度输入。
          </Typography.Paragraph>
        </div>
        <Space wrap>
          <Tag color="blue">{company.data?.name ?? "目标公司未初始化"}</Tag>
          {selectedPeriod && (
            <Link to={`/payroll?period=${selectedPeriod.period}`}>
              返回本期工资核算
            </Link>
          )}
        </Space>
      </div>
      <Card title="导入流程" extra="一次上传 · 两类输入">
        <Steps
          size="small"
          current={preview ? 3 : 1}
          items={[
            "选择工资期间",
            "上传原工作簿",
            "花名册初始化",
            "考勤保存与归集",
          ].map((title) => ({ title }))}
        />
      </Card>
      <Card title="导入设置">
        <div className={styles.settings}>
          <Space wrap>
            <label>
              工资期间{" "}
              <Select
                aria-label="工资期间"
                style={{ width: 150 }}
                loading={workbench.isPending}
                disabled={upload.isPending}
                value={selectedPeriod?.period}
                placeholder="请先建立期间"
                options={(workbench.data?.periods ?? []).map((p) => ({
                  value: p.period,
                  label: p.period,
                }))}
                onChange={(value) =>
                  setParams((current) => {
                    const next = new URLSearchParams(current);
                    next.set("period", value);
                    return next;
                  })
                }
              />
            </label>
            <Tag>全公司所有主体</Tag>
          </Space>
          <Alert
            showIcon
            type="info"
            message="直接上传已约定的整本 .xlsx"
            description="固定花名册和考勤结构，必要跨表公式在本机重新计算。新增员工以期间月初和入职日中较晚者生效；已有员工不覆盖、不回填历史。文件月份须与所选期间一致，无需拆表或整表粘贴为值。每个输入工作表最多 5,000 条有效记录。"
          />
          {(company.isError || workbench.isError) && (
            <Alert
              showIcon
              type="error"
              message={company.error?.message ?? workbench.error?.message}
            />
          )}
          {!workbench.isPending && !workbench.isError && !selectedPeriod && (
            <Alert
              showIcon
              type="warning"
              message="请先建立工资期间，再上传原工作簿"
            />
          )}
          <button
            type="button"
            className={styles.dropzone}
            disabled={
              !company.data ||
              !selectedPeriod ||
              upload.isPending ||
              workbench.isFetching
            }
            onClick={() => fileInput.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              chooseFile(event.dataTransfer.files[0]);
            }}
          >
            <UploadOutlined className={styles.dropIcon} />
            <strong>
              {upload.isPending ? "正在上传并处理…" : "上传原工资工作簿"}
            </strong>
            <span>支持 .xlsx，单次不超过 20MB；原文件保留追溯</span>
          </button>
          <input
            ref={fileInput}
            className={styles.hiddenInput}
            type="file"
            accept=".xlsx"
            aria-label="原工资工作簿"
            onChange={(event) => {
              chooseFile(event.target.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
          {(fileError || upload.isError) && (
            <Alert
              showIcon
              type="error"
              message={fileError ?? upload.error?.message}
            />
          )}
        </div>
      </Card>
      <Card title="整本导入结果">
        {preview ? (
          <WorkbookResult
            key={preview.id}
            task={preview}
            onUpdated={(task) => updateTask(task, true)}
          />
        ) : (
          <Empty description="上传后查看花名册与考勤处理结果" />
        )}
      </Card>
      <Card title="整本导入历史" extra="历史详情只读">
        {history.isError && (
          <Alert showIcon type="error" message={history.error.message} />
        )}
        <Table
          size="small"
          rowKey="id"
          loading={history.isPending && !!company.data}
          dataSource={history.data ?? []}
          scroll={{ x: 850 }}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          locale={{ emptyText: "暂无整本导入任务" }}
          columns={[
            { title: "期间", dataIndex: "period", width: 90 },
            { title: "原文件", dataIndex: "original_filename" },
            {
              title: "花名册 新增 / 失败",
              width: 155,
              render: (_, task) =>
                `${task.employee_import.success_rows} / ${task.employee_import.error_rows}`,
            },
            {
              title: "考勤 保存 / 失败",
              width: 145,
              render: (_, task) =>
                `${task.attendance_import.success_rows} / ${task.attendance_import.error_rows}`,
            },
            {
              title: "操作",
              width: 100,
              render: (_, task) => (
                <Button size="small" onClick={() => setSelectedId(task.id)}>
                  查看详情
                </Button>
              ),
            },
          ]}
        />
      </Card>
      <Drawer
        title="整本导入历史详情"
        size="large"
        open={selectedId !== null}
        onClose={() => setSelectedId(null)}
        destroyOnClose
      >
        {detail.isPending ? (
          <Typography.Text>正在读取原任务…</Typography.Text>
        ) : detail.isError ? (
          <Alert showIcon type="error" message={detail.error.message} />
        ) : (
          detail.data && (
            <>
              <Alert
                showIcon
                type="info"
                message="历史详情只读，原文件、公式和失败原因保留追溯"
              />
              <WorkbookResult task={detail.data} />
            </>
          )
        )}
      </Drawer>
    </div>
  );
}

const EMPLOYEE_FIELDS = new Set([
  "证件号码",
  "姓名",
  "公司主体全称",
  "一级部门",
  "二级部门",
  "三级部门",
  "岗位",
  "职级",
  "入职时间",
  "转正日期",
  "离职时间",
  "银行卡号",
  "开户行",
  "转正固定薪资",
  "试用期底薪",
]);

function WorkbookResult({
  task,
  onUpdated,
}: {
  task: WorkbookImport;
  onUpdated?: (task: WorkbookImport) => void;
}) {
  const [editing, setEditing] = useState<ImportRow | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () =>
      resources.correctWorkbookRow(task.id, editing!.id, values, task.revision),
    onSuccess: (updated) => {
      onUpdated?.(updated);
      const row = [
        ...(updated.employee_import.rows ?? []),
        ...(updated.attendance_import.rows ?? []),
      ].find((row) => row.id === editing?.id);
      setEditing(row?.validation_status === "invalid" ? row : null);
      setValues({});
    },
  });
  const refresh = useMutation({
    mutationFn: () => resources.workbookImport(task.id),
    onSuccess: (updated) => {
      onUpdated?.(updated);
      setEditing(null);
      setValues({});
      save.reset();
    },
  });
  const edit = onUpdated
    ? (row: ImportRow) => {
        setEditing(row);
        setValues({});
        save.reset();
        refresh.reset();
      }
    : undefined;
  const mapping =
    editing?.sheet_name === "花名册"
      ? task.employee_import.field_mapping
      : task.attendance_import.field_mapping;
  const busy = save.isPending || refresh.isPending;
  const period = task.period;
  const failed =
    task.employee_import.error_rows + task.attendance_import.error_rows;
  return (
    <div className={styles.detail}>
      <Space wrap>
        <Tag color={failed ? "warning" : "success"}>
          {task.status === "rejected"
            ? "全部输入未保存"
            : failed
              ? "部分输入未保存"
              : "全部输入已保存"}
        </Tag>
        <strong>{period}</strong>
        <Typography.Text>{task.original_filename}</Typography.Text>
        <Button
          size="small"
          icon={<DownloadOutlined />}
          href={`${API_BASE}/imports/workbook/${task.id}/file`}
        >
          下载原工作簿
        </Button>
        <Link to={`/payroll?period=${period}`}>查看本期工资核算</Link>
      </Space>
      {failed > 0 && (
        <Alert
          showIcon
          type="warning"
          message={
            task.status === "rejected"
              ? "本次输入均未保存，请核对来源"
              : "合法行已保存，失败输入尚未保存"
          }
          description="按原工作表、原始行号和单元格核对失败原因；已保存事实不会重新覆盖。"
        />
      )}
      <InputResult
        title="花名册"
        savedLabel="新增员工"
        batch={task.employee_import}
        onEdit={edit}
        disabled={busy}
      />
      <InputResult
        title="考勤表"
        savedLabel="已保存考勤"
        batch={task.attendance_import}
        onEdit={edit}
        disabled={busy}
      />
      {editing && (
        <section className={styles.correctionForm} aria-label="整本输入修正">
          <Typography.Text strong>
            修正{editing.sheet_name} · 原始行 {editing.source_row_number} ·
            任务版本 {task.revision}
          </Typography.Text>
          <Typography.Text type="secondary">
            只编辑有效输入。按任务期间重新计算，仅重验依赖的失败考勤，已保存事实不重写。日期填
            YYYY-MM-DD；可用核实值替换输入公式。
          </Typography.Text>
          <ImportFailureTable rows={[editing]} />
          <div className={styles.correctionGrid}>
            {Object.keys(editing.raw_data)
              .filter(
                (field) =>
                  editing.sheet_name !== "花名册" || EMPLOYEE_FIELDS.has(field),
              )
              .map((field) => (
                <label key={field}>
                  {field}（{mapping[field]}
                  {editing.source_row_number}）
                  <Input
                    aria-label={`${field}（${mapping[field]}${editing.source_row_number}）`}
                    aria-invalid={editing.errors?.some(
                      (error) => error.field === field,
                    )}
                    disabled={busy}
                    value={
                      values[field] ??
                      editing.correction_values?.[field] ??
                      editing.raw_data[field]
                    }
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [field]: event.target.value,
                      }))
                    }
                  />
                </label>
              ))}
          </div>
          {(save.isError || refresh.isError) && (
            <Alert
              showIcon
              type="error"
              message={save.error?.message ?? refresh.error?.message}
            />
          )}
          <Space wrap>
            <Button
              type="primary"
              loading={save.isPending}
              disabled={busy || !Object.keys(values).length}
              onClick={() => save.mutate()}
            >
              保存并重验
            </Button>
            <Button disabled={busy} onClick={() => setEditing(null)}>
              取消
            </Button>
            <Button
              loading={refresh.isPending}
              disabled={busy}
              onClick={() => refresh.mutate()}
            >
              刷新任务结果
            </Button>
          </Space>
        </section>
      )}
      <Typography.Title level={5}>考勤主体归集</Typography.Title>
      <Table
        size="small"
        rowKey="subject_id"
        dataSource={task.attendance_import.subjects}
        pagination={false}
        scroll={{ x: 650 }}
        locale={{ emptyText: "尚无确定归属的考勤" }}
        columns={[
          { title: "归属主体", dataIndex: "subject_name" },
          { title: "已保存", dataIndex: "success_rows", width: 85 },
          { title: "未保存", dataIndex: "error_rows", width: 85 },
          {
            title: "工资批次",
            render: (_, item) => item.payroll_batch_id ?? "尚未建立",
          },
          {
            title: "操作",
            width: 100,
            render: (_, item) =>
              item.payroll_batch_id ? (
                <Link
                  to={`/payroll/batches/${item.payroll_batch_id}?period=${period}&subject_id=${item.subject_id}`}
                >
                  进入核算
                </Link>
              ) : (
                "—"
              ),
          },
        ]}
      />
    </div>
  );
}

function InputResult({
  title,
  savedLabel,
  batch,
  onEdit,
  disabled,
}: {
  onEdit?: (row: ImportRow) => void;
  disabled?: boolean;
  title: string;
  savedLabel: string;
  batch: EmployeeImportBatch;
}) {
  const rows = batch.rows ?? [];
  return (
    <section className={styles.detail}>
      <Typography.Title level={5}>{title}</Typography.Title>
      <div className={styles.metrics}>
        {[
          ["处理行数", batch.total_rows],
          [savedLabel, batch.success_rows],
          ["未保存行数", batch.error_rows],
        ].map(([label, value]) => (
          <div className={styles.metric} key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      {batch.error_rows > 0 && (
        <ImportFailureTable
          rows={rows.filter((row) => row.validation_status === "invalid")}
        />
      )}
      <Table
        aria-label={`${title}原始输入`}
        size="small"
        rowKey="id"
        dataSource={rows}
        scroll={{ x: 620 }}
        pagination={{ pageSize: 8, showSizeChanger: false }}
        expandable={{
          expandedRowRender: (row) => (
            <OriginalRow row={row} mapping={batch.field_mapping} />
          ),
        }}
        columns={[
          { title: "原始行号", dataIndex: "source_row_number", width: 100 },
          {
            title: "姓名",
            render: (_, row) =>
              String(
                (
                  row.normalized_data?.evaluated_values as
                    Record<string, string> | undefined
                )?.姓名 ??
                  row.raw_data.姓名 ??
                  "—",
              ),
          },
          {
            title: "员工标识",
            render: (_, row) => {
              const values = (row.normalized_data?.evaluated_values ??
                row.raw_data) as Record<string, string>;
              return values.证件号码 ?? values.身份证号 ?? "—";
            },
          },
          {
            title: "结果",
            width: 100,
            render: (_, row) => (
              <Tag
                color={
                  row.validation_status === "invalid" ? "warning" : "success"
                }
              >
                {row.validation_status === "imported"
                  ? "已保存"
                  : row.validation_status === "invalid"
                    ? "未保存"
                    : "已处理"}
              </Tag>
            ),
          },
          ...(onEdit
            ? [
                {
                  title: "操作",
                  width: 170,
                  render: (_: unknown, row: ImportRow) =>
                    row.validation_status === "invalid" ? (
                      <Button
                        size="small"
                        disabled={disabled}
                        onClick={() => onEdit(row)}
                      >
                        修正{title}第{row.source_row_number}行
                      </Button>
                    ) : null,
                },
              ]
            : []),
        ]}
      />
    </section>
  );
}

function OriginalRow({
  row,
  mapping,
}: {
  row: ImportRow;
  mapping: Record<string, string>;
}) {
  const values = (row.normalized_data?.evaluated_values ?? {}) as Record<
    string,
    string
  >;
  return (
    <div className={styles.detail}>
      <Table
        size="small"
        pagination={false}
        scroll={{ x: 800 }}
        rowKey="field"
        dataSource={Object.entries(row.raw_data).map(([field, raw]) => ({
          field,
          raw,
          computed: values[field],
          correction: row.correction_values?.[field],
        }))}
        columns={[
          {
            title: "字段 / 原单元格",
            width: 210,
            render: (_, item) =>
              `${item.field}（${mapping[item.field]}${row.source_row_number}）`,
          },
          {
            title: "原始值 / 公式",
            render: (_, item) => (
              <span className={styles.mono}>{item.raw || "（空）"}</span>
            ),
          },
          {
            title: "当前核实值",
            render: (_, item) => item.correction ?? "—",
          },
          {
            title: "解析值",
            width: 160,
            render: (_, item) => item.computed ?? "—",
          },
        ]}
      />
      {!!row.correction_history.length && (
        <Table
          size="small"
          pagination={false}
          scroll={{ x: 620 }}
          rowKey="index"
          dataSource={row.correction_history.map(
            (item, index): Record<string, unknown> & { index: number } => ({
              ...item,
              index,
            }),
          )}
          columns={[
            {
              title: "版本",
              render: (_, item) => String(item.revision ?? "—"),
              width: 70,
            },
            {
              title: "核实与重验",
              render: (_, item) => {
                const before = (item.before_values ?? {}) as Record<
                  string,
                  string
                >;
                const after = (item.evaluated_values ?? {}) as Record<
                  string,
                  string
                >;
                const changes = Object.entries(after).filter(
                  ([field, value]) => before[field] !== value,
                );
                return (
                  <div>
                    {item.source_row_id
                      ? `依赖行 #${item.source_row_id} 修正后重验`
                      : "本行修正"}
                    {changes.map(([field, value]) => (
                      <div key={field}>
                        {field}：{before[field] || "（空）"} →{" "}
                        {value || "（空）"}
                      </div>
                    ))}
                  </div>
                );
              },
            },
            {
              title: "结果",
              render: (_, item) =>
                item.result === "invalid" ? "未保存" : "已处理",
              width: 90,
            },
            {
              title: "失败原因",
              render: (_, item) =>
                ((item.errors ?? []) as { message: string }[])
                  .map((error) => error.message)
                  .join("；") || "—",
            },
          ]}
        />
      )}
    </div>
  );
}
