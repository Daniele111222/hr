import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from "antd";
import { useRef, useState } from "react";
import {
  payrollExports,
  exportLabels,
  resources,
  type PayrollExportReport,
  type ExportKind,
} from "../../shared/api/resources";
import styles from "./index.module.less";

export function ExportsPage() {
  const client = useQueryClient();
  const [kind, setKind] = useState<ExportKind>("payroll");
  const [subjectTemplates, setSubjectTemplates] = useState<
    Record<string, string>
  >({});
  const label = exportLabels[kind];
  const [selectedPeriod, setPeriod] = useState<number>();
  const [subject, setSubject] = useState<number>();
  const [report, setReport] = useState<PayrollExportReport>();
  const [downloadError, setDownloadError] = useState<string>();
  const requestId = useRef<string | undefined>(undefined);
  const workbench = useQuery({
    queryKey: ["payroll", "workbench"],
    queryFn: () => resources.payrollWorkbench(),
  });
  const subjects = useQuery({
    queryKey: ["subjects"],
    queryFn: resources.subjects,
  });
  const period = selectedPeriod ?? workbench.data?.period?.id;
  const preview = useQuery({
    queryKey: ["exports", "preview", kind, period, subject],
    queryFn: () => payrollExports.preview(period!, subject, kind),
    enabled: !!period,
  });
  const history = useQuery({
    queryKey: ["exports", "history", kind, period],
    queryFn: () => payrollExports.history(period!, kind),
    enabled: !!period,
  });
  const generate = useMutation({
    mutationFn: () => {
      requestId.current ??= crypto.randomUUID();
      return payrollExports.create(
        period!,
        subject,
        requestId.current,
        kind,
        subjectTemplates,
      );
    },
    onSuccess: (result) => {
      requestId.current = undefined;
      setReport(result);
      void client.invalidateQueries({ queryKey: ["exports"] });
    },
  });
  const download = useMutation({
    mutationFn: (id?: number) => payrollExports.download(id, kind),
    onMutate: () => setDownloadError(undefined),
    onError: (error) => setDownloadError(error.message),
  });
  const data = preview.data;
  const mappingMissing =
    kind === "bank" && data?.subjects.some((s) => !subjectTemplates[s.id]);
  const error =
    workbench.error ?? subjects.error ?? preview.error ?? history.error;
  return (
    <div className={styles.page}>
      <header>
        <Typography.Title level={2}>导出中心</Typography.Title>
        <p>
          将已锁定的有效批次生成四类
          Excel，包括申报辅助模板。系统只输出「未扣个税金额」，个税由你在 Excel
          中计算、核对，暂不回填系统。
        </p>
      </header>
      {error && (
        <Alert
          type="error"
          showIcon
          title="导出数据加载失败"
          description={error.message}
          action={
            <Button
              onClick={() => {
                void workbench.refetch();
                void subjects.refetch();
                if (period) {
                  void preview.refetch();
                  void history.refetch();
                }
              }}
            >
              重试
            </Button>
          }
        />
      )}
      {(workbench.isLoading || subjects.isLoading || preview.isFetching) && (
        <Spin aria-label="正在加载导出数据" />
      )}
      {!workbench.isLoading && !workbench.error && !period && (
        <Empty description="尚无工资期间，请先建立工资期间并完成确认锁定" />
      )}
      {data && (
        <Alert
          showIcon
          type={data.can_export ? "success" : "warning"}
          title={
            data.can_export ? "所选范围已通过导出门槛" : "当前范围暂不能导出"
          }
          description={
            data.can_export
              ? "正常工资、更正和独立补发均取当前有效锁定版本。"
              : data.blockers.join("；")
          }
        />
      )}
      <section className={styles.metrics} aria-label="导出概况">
        {[
          ["导出期间", data?.period ?? "—"],
          ["导出人数", data?.employee_count ?? "—"],
          ["可用模板", "4 套"],
          ["最近导出", history.data?.[0] ? `#${history.data[0].id}` : "—"],
        ].map(([title, value]) => (
          <div key={title}>
            <span>{title}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </section>
      <Card title="选择导出模板" size="small">
        <div className={styles.templates}>
          {(["payroll", "bank", "labor-cost", "tax"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-label={exportLabels[value]}
              aria-pressed={kind === value}
              className={`${styles.template} ${kind === value ? styles.selected : ""}`}
              disabled={generate.isPending || download.isPending}
              onClick={() => {
                setKind(value);
                setReport(undefined);
                setDownloadError(undefined);
                requestId.current = undefined;
                generate.reset();
              }}
            >
              <strong>{exportLabels[value]}</strong>
              {kind === value && <Tag color="blue">已选择</Tag>}
              <p>
                {
                  {
                    payroll:
                      "按员工与批次列出收入、扣缴和未扣个税金额，保留来源。",
                    bank: "按主体选择银行模板，查看账户问题并生成未扣个税文件。",
                    "labor-cost":
                      "按员工与主体核对个人扣款、公司缴费及人工成本，项目工时留空。",
                    tax: "保留 33 列申报辅助结构，未知税务字段留空并逐项报告，供线下补充核对。",
                  }[value]
                }
              </p>
              {kind === value && (
                <small>{data?.template_version ?? "正在读取模板版本"}</small>
              )}
            </button>
          ))}
        </div>
      </Card>
      <div className={styles.config}>
        <Card title="导出范围与选项" size="small">
          <div className={styles.fields}>
            <label>
              主体范围
              <Select
                aria-label="主体范围"
                allowClear
                placeholder="全部主体"
                disabled={generate.isPending}
                value={subject}
                options={subjects.data?.map((s) => ({
                  value: s.id,
                  label: s.name,
                }))}
                onChange={(value) => {
                  setSubject(value);
                  requestId.current = undefined;
                  generate.reset();
                }}
              />
            </label>
            <label>
              工资期间
              <Select
                aria-label="工资期间"
                placeholder="选择工资期间"
                disabled={generate.isPending}
                value={period}
                options={workbench.data?.periods.map((p) => ({
                  value: p.id,
                  label: p.period,
                }))}
                onChange={(value) => {
                  setPeriod(value);
                  requestId.current = undefined;
                  generate.reset();
                }}
              />
            </label>
          </div>
          {kind === "bank" && (
            <div className={styles.fields}>
              {data?.subjects.map((s) => (
                <label key={s.id}>
                  {s.name}的代发模板
                  <Select
                    aria-label={`${s.name}的代发模板`}
                    placeholder="选择对应模板"
                    disabled={generate.isPending}
                    value={subjectTemplates[s.id]}
                    options={data.template_sheets.map((name) => ({
                      value: name,
                      label: name,
                    }))}
                    onChange={(value) => {
                      setSubjectTemplates((current) => ({
                        ...current,
                        [s.id]: value,
                      }));
                      requestId.current = undefined;
                      generate.reset();
                    }}
                  />
                </label>
              ))}
            </div>
          )}
          {mappingMissing && <p>请为范围内每个主体选择代发模板后生成。</p>}
          <p className={styles.note}>
            {kind === "bank"
              ? "保留原模板工作表结构，同一主体内按员工合并；每次生成均保存模板映射、版本及导出报告。"
              : "保留原模板工作表结构，明细按主体和批次排列；每次生成均保存版本及导出报告。"}
          </p>
        </Card>
        <Card title="导出预览" size="small">
          <dl>
            <dt>工资记录</dt>
            <dd>{data?.record_count ?? "—"}</dd>
            <dt>未扣个税金额</dt>
            <dd>{data?.untaxed_amount ?? "—"}</dd>
            {kind === "labor-cost" && (
              <>
                <dt>公司成本</dt>
                <dd>{data?.employer_cost ?? "—"}</dd>
              </>
            )}
            <dt>无工资主体</dt>
            <dd>{data?.skipped_subjects.join("、") || "无"}</dd>
          </dl>
        </Card>
      </div>
      <Card title="字段口径" size="small">
        {kind === "tax" && (
          <Alert
            type="warning"
            showIcon
            title="仅为申报辅助，未完成税务申报"
            description="本期收入取锁定应发金额，个人社保分项与公积金只填有明确来源的项目；未扣个税金额在备注标识。所得期间、证件类型、免税收入、累计扣除及已缴税额等无来源字段留空，报告逐项提示；请线下补充核对，不回填系统。"
          />
        )}
        {kind === "labor-cost" && (
          <Alert
            type="info"
            showIcon
            title="个人社保、公积金计入个人扣款；公司部分只计入公司成本"
            description="公司成本取锁定台账，不从工资重复扣除公司缴费。主体按 ID 顺序填充模板页，页内显示真实主体；汇总按主体，明细保留锁定部门名称，部门层级及项目工时无来源留空。"
          />
        )}
        {kind === "bank" && (
          <Alert
            type="warning"
            showIcon
            title="缺银行卡或负金额阻断整次代发导出；零金额保留并提示"
            description="户名取锁定员工姓名；开户行无锁定快照来源，留空待线下核对。主体模板映射随导出报告保存。"
          />
        )}
        <p>
          {kind === "bank"
            ? "同一主体内按员工合并有效正常工资与独立补发；备注保留批次、补发原因和发放日期，未填日期注明未填写。"
            : "金额来自锁定台账快照；更正仅计最新有效版本，独立补发单列来源且只计一次。"}
          身份证和银行卡按文本导出，零工资保留并提示。
        </p>
        <Alert
          showIcon
          type="warning"
          title="个税相关字段留空"
          description="缺少个税不阻断导出。无来源辅助字段留空并在报告中说明，人工核对前不能作为最终发薪文件。"
        />
      </Card>
      <Card
        title="导出记录"
        size="small"
        extra="最近 100 次，可查看报告与重复下载"
      >
        <Table<PayrollExportReport>
          size="small"
          rowKey="id"
          loading={history.isLoading}
          dataSource={history.data ?? []}
          scroll={{ x: 820 }}
          locale={{ emptyText: "暂无导出记录" }}
          columns={[
            { title: "导出编号", render: (_, r) => `#${r.id}` },
            { title: "期间", render: (_, r) => r.parameters.period },
            {
              title: "范围",
              render: (_, r) =>
                r.parameters.subject_id
                  ? (subjects.data?.find(
                      (s) => s.id === r.parameters.subject_id,
                    )?.name ?? `主体 #${r.parameters.subject_id}`)
                  : "全部主体",
            },
            { title: "人数", render: (_, r) => r.parameters.employee_count },
            {
              title: "时间",
              render: (_, r) => new Date(r.created_at).toLocaleString(),
            },
            {
              title: "结果",
              render: (_, r) => (
                <Tag
                  color={
                    r.status === "completed"
                      ? "success"
                      : r.status === "failed"
                        ? "error"
                        : "processing"
                  }
                >
                  {
                    {
                      completed: "已生成",
                      failed: "失败",
                      started: "生成中 / 中断",
                    }[r.status]
                  }
                </Tag>
              ),
            },
            {
              title: "操作",
              render: (_, r) => (
                <Space>
                  <Button size="small" onClick={() => setReport(r)}>
                    报告
                  </Button>
                  <Button
                    size="small"
                    disabled={r.status !== "completed"}
                    loading={download.isPending && download.variables === r.id}
                    onClick={() => download.mutate(r.id)}
                  >
                    下载
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>
      {(generate.error || downloadError) && (
        <Alert
          type="error"
          showIcon
          title={generate.error?.message ?? downloadError}
        />
      )}
      <footer className={styles.actions}>
        <span>下载时会再次核对有效版本；失败或中断后可重新生成。</span>
        <Button
          onClick={() => download.mutate(undefined)}
          loading={download.isPending && download.variables === undefined}
        >
          下载 Excel 模板
        </Button>
        <Button
          type="primary"
          disabled={
            !data?.can_export || !!error || preview.isFetching || mappingMissing
          }
          loading={generate.isPending}
          onClick={() => generate.mutate()}
        >
          生成导出文件
        </Button>
      </footer>
      <Drawer
        title={report ? `导出报告 #${report.id}` : "导出报告"}
        open={!!report}
        onClose={() => setReport(undefined)}
        size="large"
      >
        {report && (
          <Space orientation="vertical" style={{ width: "100%" }}>
            {downloadError && (
              <Alert type="error" showIcon title={downloadError} />
            )}
            <Typography.Text>
              模板版本：{report.template_version}
            </Typography.Text>
            <Typography.Text>
              输入批次：
              {report.parameters.versions
                .map((v) => `#${v.batch_id} / 试算 #${v.trial_id}`)
                .join("、") || "无"}
            </Typography.Text>
            <Typography.Text>
              未扣个税金额：{report.parameters.untaxed_amount}
            </Typography.Text>
            {kind === "labor-cost" && (
              <Typography.Text>
                公司成本：{report.parameters.employer_cost ?? "—"}
              </Typography.Text>
            )}
            {report.warnings.map((w, i) => (
              <Alert
                key={i}
                showIcon
                type={w.severity === "error" ? "error" : "warning"}
                title={
                  w.employee_id
                    ? `员工 #${w.employee_id}：${w.message}`
                    : w.message
                }
              />
            ))}
            {report.status === "failed" && (
              <Alert
                type="error"
                title="生成失败，文件不可下载；处理报告中的问题后重新生成。"
              />
            )}
            <Button
              disabled={report.status !== "completed"}
              onClick={() => download.mutate(report.id)}
            >
              下载{label}
            </Button>
          </Space>
        )}
      </Drawer>
    </div>
  );
}
