import { MemoryRouter } from "react-router-dom";
import { App as AntdApp } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { ImportsPage } from "./index.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderPage(
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  }),
  path = "/imports",
) {
  return render(
    <AntdApp>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <ImportsPage />
        </MemoryRouter>
      </QueryClientProvider>
    </AntdApp>,
  );
}

test("绩效历史只读，不提供月度上传入口", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/organization/company")
        ? Response.json({ id: 1, name: "测试公司" })
        : String(input).includes("/payroll/workbench")
          ? Response.json({ period: null, periods: [], batches: [] })
          : Response.json([]),
    ),
  );
  renderPage(undefined, "/imports?type=performance");
  expect(await screen.findByText("绩效导入历史")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /把 Excel 拖到这里/ }),
  ).not.toBeInTheDocument();
  expect(document.querySelector('input[type="file"]')).toBeNull();
});

test("员工导入页面显示固定模板说明并限制 xlsx 文件", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/organization/company")) {
        return Response.json({ id: 1, code: "ACME", name: "测试公司" });
      }
      return Response.json([]);
    }),
  );
  renderPage();

  expect(
    await screen.findByText("员工资料模板 TPL-EMP-v3"),
  ).toBeInTheDocument();
  expect(screen.getByText(/固定 27 列/)).toBeInTheDocument();
  expect(screen.getByText(/生效日期为本次导入日期/)).toBeInTheDocument();
  expect(screen.getByText(/缺失部门会按层级自动创建/)).toBeInTheDocument();
  expect(
    screen.getByText(/绩效与年薪资料可留空，不参与月度核算/),
  ).toBeInTheDocument();
  expect(screen.queryByText(/80%\/20%/)).not.toBeInTheDocument();
  expect(
    screen.getByText(/支持本行引用、四则运算、括号、ROUND 和 EDATE/),
  ).toBeInTheDocument();
  expect(document.querySelector('input[type="file"]')).toHaveAttribute(
    "accept",
    ".xlsx",
  );
});

function workbookTask() {
  const employeeRow = {
    id: 100,
    sheet_name: "花名册",
    source_row_number: 3,
    validation_status: "invalid",
    raw_data: { 证件号码: "", 姓名: "源员工" },
    correction_values: null as Record<string, string> | null,
    normalized_data: { evaluated_values: {} },
    errors: [
      {
        code: "REQUIRED",
        field: "证件号码",
        cell: "B3",
        column: "B",
        message: "证件号码不能为空",
      },
    ],
    correction_history: [],
  };
  const attendanceRow = {
    ...employeeRow,
    id: 101,
    sheet_name: "考勤表",
    source_row_number: 4,
    raw_data: { 身份证号: "=花名册!B3", 姓名: "源员工" },
    errors: [
      {
        code: "DEPENDENCY_NOT_READY",
        field: "身份证号",
        cell: "A4",
        column: "A",
        message: "花名册员工或本期任职未就绪，考勤尚未保存",
      },
    ],
  };
  const summary = {
    company_id: 1,
    template_version: "TPL-WORKBOOK-v1",
    original_filename: "whole.xlsx",
    file_sha256: "source",
    status: "partially_imported",
    uploaded_at: "2026-10-11T01:00:00Z",
    total_rows: 2,
    success_rows: 1,
    error_rows: 1,
  };
  const task = {
    id: 50,
    company_id: 1,
    payroll_period_id: 7,
    period: "2026-07",
    revision: 1,
    original_filename: "whole.xlsx",
    file_sha256: "source",
    status: "partially_imported",
    template_version: "TPL-WORKBOOK-v1",
    uploaded_at: summary.uploaded_at,
    evaluation: { engine_version: "LibreOffice test" },
    employee_import: {
      ...summary,
      id: 51,
      import_type: "workbook_employee",
      field_mapping: { 证件号码: "B" },
      rows: [employeeRow],
    },
    attendance_import: {
      ...summary,
      id: 52,
      import_type: "attendance",
      field_mapping: { 身份证号: "A" },
      payroll_period_id: 7,
      payroll_batch_id: null,
      subject_name: "全公司",
      rows: [attendanceRow],
      subjects: [
        {
          subject_id: 2,
          subject_name: "归属主体",
          payroll_batch_id: 22,
          success_rows: 1,
          error_rows: 1,
          batch_created: true,
        },
      ],
    },
  };
  return task;
}

test("整本入口无期间时禁用上传", async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) =>
    String(input).endsWith("/organization/company")
      ? Response.json({ id: 1, name: "测试公司" })
      : String(input).includes("/payroll/workbench")
        ? Response.json({ period: null, periods: [], batches: [] })
        : Response.json([]),
  );
  vi.stubGlobal("fetch", fetcher);
  renderPage(undefined, "/imports?type=workbook");
  expect(
    await screen.findByText("请先建立工资期间，再上传原工作簿"),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: /上传原工资工作簿/ }),
  ).toBeDisabled();
  expect(
    fetcher.mock.calls.some((call) =>
      String(call[0]).includes("payroll_batch_id"),
    ),
  ).toBe(false);
});

test("整本上传处理中禁用入口，接口错误可见且不显示成功", async () => {
  let finish!: (response: Response) => void;
  const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST")
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    const url = String(input);
    return Promise.resolve(
      url.endsWith("/organization/company")
        ? Response.json({ id: 1, name: "测试公司" })
        : url.includes("/payroll/workbench")
          ? Response.json({
              period: { id: 7, period: "2026-07" },
              periods: [{ id: 7, period: "2026-07" }],
              batches: [],
            })
          : Response.json([]),
    );
  });
  vi.stubGlobal("fetch", fetcher);
  renderPage(undefined, "/imports?type=workbook&period=2026-07");
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: /上传原工资工作簿/ }),
    ).toBeEnabled(),
  );
  await userEvent
    .setup()
    .upload(
      document.querySelector('input[type="file"]')!,
      new File(["original"], "whole.xlsx"),
    );
  expect(
    await screen.findByRole("button", { name: /正在上传并处理/ }),
  ).toBeDisabled();
  await act(async () =>
    finish(
      Response.json(
        { detail: "Excel 引擎不可用，本次没有导入业务数据" },
        { status: 503 },
      ),
    ),
  );
  expect(
    await screen.findByText("Excel 引擎不可用，本次没有导入业务数据"),
  ).toBeInTheDocument();
  expect(screen.queryByText("全部输入已保存")).not.toBeInTheDocument();
  expect(
    screen.getByText("上传后查看花名册与考勤处理结果"),
  ).toBeInTheDocument();
});

test("整本历史详情只读且核算链接取任务期间", async () => {
  const task = workbookTask();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/organization/company"))
        return Response.json({ id: 1, name: "测试公司" });
      if (url.includes("/payroll/workbench"))
        return Response.json({
          period: { id: 9, period: "2026-09" },
          periods: [{ id: 9, period: "2026-09" }],
          batches: [],
        });
      if (url.endsWith("/imports/workbook/50")) return Response.json(task);
      return Response.json([task]);
    }),
  );
  renderPage(undefined, "/imports?type=workbook&period=2026-09");
  await userEvent
    .setup()
    .click(await screen.findByRole("button", { name: "查看详情" }));
  const drawer = await screen.findByRole("dialog");
  expect(
    await within(drawer).findByText(
      "历史详情只读，原文件、公式和失败原因保留追溯",
    ),
  ).toBeInTheDocument();
  expect(
    within(drawer).getByRole("link", { name: "查看本期工资核算" }),
  ).toHaveAttribute("href", "/payroll?period=2026-07");
  expect(
    within(drawer).getByRole("link", { name: /下载原工作簿/ }),
  ).toHaveAttribute("href", "/api/imports/workbook/50/file");
  expect(
    within(drawer).queryByRole("button", { name: /修正|保存/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText("上传后查看花名册与考勤处理结果"),
  ).toBeInTheDocument();
});

test("整本入口按所选期间上传，分别显示两类结果和原位置", async () => {
  const task = workbookTask();
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/organization/company"))
        return Response.json({ id: 1, name: "测试公司" });
      if (url.includes("/payroll/workbench"))
        return Response.json({
          period: { id: 7, period: "2026-07" },
          periods: [{ id: 7, period: "2026-07" }],
          batches: [],
        });
      if (init?.method === "POST") return Response.json(task);
      if (url.endsWith("/imports/workbook/50")) return Response.json(task);
      return Response.json([]);
    },
  );
  vi.stubGlobal("fetch", fetcher);
  renderPage(
    undefined,
    "/imports?type=workbook&period=2026-07&source_batch_id=22",
  );
  expect(
    await screen.findByRole("heading", { name: "整本工资工作簿导入" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("combobox", { name: "主体与批次" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "下载模板" }),
  ).not.toBeInTheDocument();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: /上传原工资工作簿/ }),
    ).toBeEnabled(),
  );
  await userEvent
    .setup()
    .upload(
      document.querySelector('input[type="file"]')!,
      new File(["original"], "whole.xlsx"),
    );
  expect(await screen.findByText("证件号码不能为空")).toBeInTheDocument();
  expect(screen.getByText("证件号码（B3）")).toBeInTheDocument();
  expect(screen.getByText("身份证号（A4）")).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "归属主体" })).toBeInTheDocument();
  expect(
    screen.getByText("花名册员工或本期任职未就绪，考勤尚未保存"),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "进入核算" })).toHaveAttribute(
    "href",
    "/payroll/batches/22?period=2026-07&subject_id=2",
  );
  expect(
    fetcher.mock.calls.some(
      ([url, init]) =>
        String(url).endsWith(
          "/imports/workbook?company_id=1&payroll_period_id=7",
        ) && init?.method === "POST",
    ),
  ).toBe(true);
});

test.each([22, 999])(
  "全公司导入只绑定历史期间，来源批次不限制数据 %s",
  async (requestedBatch) => {
    const oldPeriod = { id: 7, period: "2026-07" };
    const latestPeriod = { id: 9, period: "2026-09" };
    const oldBatch = {
      id: 22,
      subject: { id: 2, name: "旧主体" },
      batch_type: "normal",
      status: "draft",
    };
    const latestBatch = {
      ...oldBatch,
      id: 99,
      subject: { id: 1, name: "最新主体" },
    };
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/organization/company"))
          return Response.json({ id: 1, name: "测试公司" });
        if (url.includes("/payroll/workbench"))
          return Response.json({
            period: url.includes("period=2026-07") ? oldPeriod : latestPeriod,
            periods: [latestPeriod, oldPeriod],
            batches: url.includes("period=2026-07")
              ? [oldBatch]
              : [latestBatch],
          });
        if (init?.method === "POST")
          return Response.json({
            id: 12,
            payroll_batch_id: 22,
            payroll_period_id: 7,
            template_version: "TPL-PERF-v1",
            rows: [],
            success_rows: 1,
            error_rows: 0,
            total_rows: 1,
            file_sha256: "test",
          });
        return Response.json([]);
      },
    );
    vi.stubGlobal("fetch", fetcher);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const cachedKeys = [
      ["payroll", "batch", 22],
      ["payroll", "trial", 22],
      ["payroll", "confirmation", 7],
    ];
    cachedKeys.forEach((key) => client.setQueryData(key, {}));
    renderPage(
      client,
      `/imports?type=attendance&period=2026-07&subject_id=2&batch_id=${requestedBatch}`,
    );
    const user = userEvent.setup();
    expect(await screen.findByText("全公司所有主体")).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "主体与批次" }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /把 Excel 拖到这里/ }),
      ).toBeEnabled(),
    );
    if (requestedBatch === 22)
      expect(
        screen.getByRole("link", { name: "返回来源批次核算" }),
      ).toHaveAttribute(
        "href",
        "/payroll/batches/22?period=2026-07&subject_id=2",
      );
    else
      expect(
        screen.queryByRole("link", { name: "返回来源批次核算" }),
      ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "绩效历史" }));
    expect(document.querySelector('input[type="file"]')).toBeNull();
    await user.click(screen.getByRole("button", { name: "月度考勤" }));
    expect(await screen.findByText("2026-07")).toBeInTheDocument();
    await user.upload(
      document.querySelector('input[type="file"]')!,
      new File(["xlsx"], "attendance.xlsx"),
    );
    expect(
      await screen.findByText("全部行已保存为考勤事实"),
    ).toBeInTheDocument();
    expect(
      fetcher.mock.calls.some(
        ([url, init]) =>
          String(url).endsWith(
            "/imports/attendance?company_id=1&payroll_period_id=7",
          ) && init?.method === "POST",
      ),
    ).toBe(true);
    for (const key of cachedKeys)
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  },
);

test("员工本次上传可纠错，历史详情只读且不会改变预览入口", async () => {
  const batch = {
    id: 7,
    company_id: 1,
    import_type: "employee_master",
    original_filename: "employees.xlsx",
    file_sha256: "a".repeat(64),
    template_version: "TPL-EMP-v3",
    field_mapping: {},
    status: "partially_imported",
    total_rows: 2,
    success_rows: 1,
    error_rows: 1,
    rows: [
      {
        id: 1,
        sheet_name: "员工资料",
        source_row_number: 3,
        validation_status: "imported",
        raw_data: { 证件号码: "11010119900101123X", 姓名: "张三" },
        correction_values: null,
        normalized_data: {},
        errors: null,
        correction_history: [],
      },
      {
        id: 2,
        sheet_name: "员工资料",
        source_row_number: 4,
        validation_status: "invalid",
        raw_data: { 证件号码: "123", 银行卡号: "" },
        correction_values: null,
        normalized_data: null,
        errors: [
          {
            code: "INVALID_ID",
            field: "证件号码",
            column: "A",
            message: "证件号码须为 18 位文本",
          },
        ],
        correction_history: [],
      },
    ],
  };
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/organization/company"))
        return Response.json({ id: 1, code: "ACME", name: "测试公司" });
      if (path.endsWith("/imports?company_id=1"))
        return Response.json([{ ...batch, rows: null }]);
      if (path.endsWith("/imports/7/rows/2/correct"))
        return Response.json({
          ...batch,
          success_rows: 2,
          error_rows: 0,
          rows: batch.rows.map((row) => ({
            ...row,
            validation_status: "imported",
            errors: null,
          })),
        });
      if (
        path.endsWith("/imports/employee-master?company_id=1") &&
        init?.method === "POST"
      )
        return Response.json(batch);
      return Response.json(batch);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const cachedKeys = [
    ["org", "departments"],
    ["org", "relations"],
    ["employees"],
  ];
  for (const key of cachedKeys) client.setQueryData(key, []);
  renderPage(client);
  await user.upload(
    document.querySelector('input[type="file"]')!,
    new File(["xlsx"], "employees.xlsx"),
  );

  expect(
    await screen.findByText("正确行已先入库，失败原因保留"),
  ).toBeInTheDocument();
  for (const key of cachedKeys) {
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    client.setQueryData(key, []);
  }
  await user.click(
    screen.getByRole("button", { name: /查看导入批次详情与纠错/ }),
  );
  expect(
    (await screen.findAllByText("证件号码须为 18 位文本")).length,
  ).toBeGreaterThan(0);
  expect(
    await screen.findByRole("button", { name: "修正" }),
  ).toBeInTheDocument();
  await user.click(await screen.findByRole("button", { name: /关闭|Close/ }));
  await user.click(screen.getByRole("button", { name: "查看详情" }));
  expect(await screen.findByText("证件号码（A4）")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "修正" }),
  ).not.toBeInTheDocument();
  expect(
    fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(1);
  await user.click(await screen.findByRole("button", { name: /关闭|Close/ }));
  await user.click(
    screen.getByRole("button", { name: /查看导入批次详情与纠错/ }),
  );
  await user.click(await screen.findByRole("button", { name: "修正" }));
  await user.clear(screen.getByRole("textbox", { name: "修正值" }));
  await user.type(
    screen.getByRole("textbox", { name: "修正值" }),
    "11010119900101124X",
  );
  await user.click(screen.getByRole("button", { name: "保存修正" }));
  expect(await screen.findByText("没有失败行")).toBeInTheDocument();
  expect(
    fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(2);
  for (const key of cachedKeys)
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
});

test("员工导入无待处理行时正常完成且不提示重复或声称写入员工", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/organization/company"))
        return Response.json({ id: 1, code: "ACME", name: "测试公司" });
      if (
        path.endsWith("/imports/employee-master?company_id=1") &&
        init?.method === "POST"
      )
        return Response.json({
          id: 8,
          company_id: 1,
          import_type: "employee_master",
          original_filename: "employees.xlsx",
          status: "imported",
          total_rows: 0,
          success_rows: 0,
          error_rows: 0,
          rows: [],
        });
      return Response.json([]);
    }),
  );
  const user = userEvent.setup();
  renderPage();
  await screen.findByText("测试公司");
  await user.upload(
    document.querySelector('input[type="file"]')!,
    new File(["xlsx"], "employees.xlsx"),
  );
  expect(await screen.findByText("本次导入已完成。")).toBeInTheDocument();
  expect(screen.getByText("处理行数")).toBeInTheDocument();
  expect(screen.queryByText(/证件号码.*重复/)).not.toBeInTheDocument();
  expect(screen.queryByText(/员工资料已写入/)).not.toBeInTheDocument();
  expect(
    screen.queryByText("正确行已先入库，失败原因保留"),
  ).not.toBeInTheDocument();
});

test("从导入历史加载完整只读详情，并允许读取失败后重试", async () => {
  const batch = {
    id: 9,
    company_id: 1,
    import_type: "employee_master",
    original_filename: "history.xlsx",
    file_sha256: "d".repeat(64),
    template_version: "TPL-EMP-v3",
    field_mapping: {},
    status: "rejected",
    total_rows: 1,
    success_rows: 0,
    error_rows: 1,
    rows: [
      {
        id: 91,
        sheet_name: "员工资料",
        source_row_number: 71,
        validation_status: "invalid",
        raw_data: { 姓名: "历史员工", 转正固定薪资: "-1" },
        correction_values: { 转正固定薪资: "-2" },
        normalized_data: null,
        correction_history: [],
        errors: [
          {
            code: "INVALID_AMOUNT",
            field: "转正固定薪资",
            column: "S",
            message: "金额须为非负且最多两位小数",
          },
          {
            code: "REQUIRED",
            field: "银行卡号",
            column: "Q",
            message: "银行卡号不能为空",
          },
        ],
      },
    ],
  };
  let release: (response: Response) => void = () => {};
  let attempts = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith("/organization/company"))
        return Response.json({ id: 1, name: "测试公司" });
      if (path.endsWith("/imports?company_id=1"))
        return Response.json([{ ...batch, rows: null }]);
      if (path.endsWith("/imports/9")) {
        attempts += 1;
        return attempts === 1
          ? new Promise<Response>((resolve) => {
              release = resolve;
            })
          : Response.json(batch);
      }
      return Response.json([]);
    }),
  );
  const user = userEvent.setup();
  renderPage();
  await screen.findByText("history.xlsx");
  await user.click(screen.getByRole("button", { name: "查看详情" }));
  expect(await screen.findByText("正在加载导入批次详情…")).toBeInTheDocument();
  await act(async () =>
    release(Response.json({ detail: "暂时不可用" }, { status: 500 })),
  );
  expect(await screen.findByText("导入批次详情读取失败")).toBeInTheDocument();
  expect(screen.queryByText("没有失败行")).not.toBeInTheDocument();
  await user.click(await screen.findByRole("button", { name: /重\s*试/ }));
  expect(
    (await screen.findAllByText("金额须为非负且最多两位小数")).length,
  ).toBeGreaterThan(0);
  expect(screen.getByText("转正固定薪资（S71）")).toBeInTheDocument();
  expect(await screen.findByText("银行卡号不能为空")).toBeInTheDocument();
  expect(screen.getByText("校验值：-2")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "修正" }),
  ).not.toBeInTheDocument();
});

test.each([
  {
    kind: "attendance",
    label: "月度考勤",
    field: "应出勤天数",
    value: "0",
    reason: "须大于 0 且不超过当月自然日天数",
  },
  {
    kind: "performance",
    label: "绩效历史",
    field: "绩效系数",
    value: "",
    reason: "绩效系数缺失；0 须明确填写",
  },
])(
  "$label 历史详情展示失败原因且无修改入口",
  async ({ kind, label, field, value, reason }) => {
    const batch = {
      id: 19,
      company_id: 1,
      payroll_period_id: 3,
      payroll_batch_id: 9,
      subject_name: "测试主体",
      import_type: kind,
      original_filename: `${kind}.xlsx`,
      file_sha256: "a".repeat(64),
      template_version: "TPL",
      field_mapping: {},
      status: "rejected",
      total_rows: 1,
      success_rows: 0,
      error_rows: 1,
      rows: [
        {
          id: 191,
          sheet_name: label,
          source_row_number: 3,
          validation_status: "invalid",
          raw_data: {
            姓名: "测试员工",
            身份证号: "11010119900101123X",
            [field]: value,
          },
          correction_values: null,
          normalized_data: null,
          correction_history: [],
          errors: [{ code: "INVALID", field, column: "C", message: reason }],
        },
      ],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith("/organization/company"))
        return Response.json({ id: 1, name: "测试公司" });
      if (path.endsWith("/payroll/workbench"))
        return Response.json({ period: null, periods: [], batches: [] });
      if (path.endsWith(`/imports/${kind}?company_id=1`))
        return Response.json([{ ...batch, rows: null }]);
      if (path.endsWith(`/imports/${kind}/19`)) return Response.json(batch);
      return Response.json([]);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: label }));
    await screen.findByText(`${kind}.xlsx`);
    await user.click(screen.getByRole("button", { name: "查看详情" }));
    expect(await screen.findByText(reason)).toBeInTheDocument();
    expect(screen.getByText(`${field}（C3）`)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "修正" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "保存并重新校验" }),
    ).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.every(
        ([input]) => !String(input).endsWith("/correct"),
      ),
    ).toBe(true);
  },
);

test.each(["TPL-ATT-v1", "TPL-ATT-v2", "TPL-ATT-v3"])(
  "考勤本次上传保留逐行修正功能 %s",
  async (version) => {
    const daysField =
      version === "TPL-ATT-v2" ? "工作日天数合计" : "应出勤天数";
    const batch = {
      id: 12,
      company_id: 1,
      payroll_period_id: 3,
      payroll_batch_id: 9,
      import_type: "attendance",
      original_filename: "attendance.xlsx",
      file_sha256: "b".repeat(64),
      template_version: version,
      field_mapping: {
        身份证号: "A",
        姓名: "B",
        [daysField]:
          version === "TPL-ATT-v2" ? "T" : version === "TPL-ATT-v3" ? "D" : "C",
        旷工天数: "Z",
        病假天数: "AB",
        总扣款: "AS",
      },
      status: "partially_imported",
      total_rows: 2,
      success_rows: 1,
      error_rows: 1,
      rows: [
        {
          id: 1,
          sheet_name: "月度考勤",
          source_row_number: 3,
          validation_status: "imported",
          raw_data: { 身份证号: "11010119900101123X", 姓名: "张三" },
          correction_values: null,
          normalized_data: {
            expected_work_days: "21",
            late_minutes: 62,
            early_leave_minutes: 0,
            paid_leave_days: "0.5",
            unpaid_leave_days: "0",
            missed_punch_count: 2,
            corrected_punch_count: 1,
          },
          errors: null,
          correction_history: [],
        },
        {
          id: 2,
          sheet_name: "月度考勤",
          source_row_number: 4,
          validation_status: "invalid",
          raw_data: {
            ...(version !== "TPL-ATT-v1"
              ? { 病假天数: "0.5", 旷工天数: "0" }
              : {}),
            ...(version === "TPL-ATT-v2"
              ? { 总扣款: "=SUM(AL4:AR4)", 当月固定薪资标准: "8000" }
              : {}),
            [daysField]: "0",
            身份证号: "11010119900101124X",
            姓名: "李四",
          },
          correction_values: null,
          normalized_data: null,
          errors: [
            {
              code: "WORK_DAYS_OUT_OF_RANGE",
              field: daysField,
              column: version === "TPL-ATT-v2" ? "T" : "C",
              message: "须大于 0 且不超过当月自然日天数",
            },
          ],
          correction_history: [],
        },
      ],
    };
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path.endsWith("/organization/company"))
          return Response.json({ id: 1, name: "测试公司" });
        if (path.endsWith("/payroll/workbench"))
          return Response.json({
            period: { id: 3, period: "2027-02" },
            periods: [{ id: 3, period: "2027-02" }],
            batches: [
              {
                id: 9,
                batch_type: "normal",
                status: "draft",
                subject: { name: "上海主体" },
              },
            ],
          });
        if (path.endsWith("/imports/attendance?company_id=1"))
          return Response.json([]);
        if (
          path.endsWith(
            "/imports/attendance?company_id=1&payroll_period_id=3",
          ) &&
          init?.method === "POST"
        )
          return Response.json(batch);
        if (path.endsWith("/imports/attendance/12/rows/2/correct"))
          return Response.json({
            ...batch,
            success_rows: 2,
            error_rows: 0,
            rows: batch.rows.map((row) => ({
              ...row,
              validation_status: "imported",
              errors: null,
            })),
          });
        return Response.json(batch);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "月度考勤" }));
    expect(await screen.findByText("考勤导入模版")).toBeInTheDocument();
    expect(screen.getByText(/固定 19 列/)).toBeInTheDocument();
    expect(screen.getByText(/只计算有效输入及其必要依赖/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /下载模板/ })).toHaveAttribute(
      "href",
      "/api/imports/attendance-template",
    );
    expect(screen.getByText("全公司所有主体")).toBeInTheDocument();
    await user.upload(
      document.querySelector('input[type="file"]')!,
      new File(["xlsx"], "attendance.xlsx"),
    );
    expect(
      await screen.findByText("正确行已保存，错误行未进入有效考勤"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("本页仅展示考勤事实", { exact: false }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("columnheader", { name: "应出勤天数" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("columnheader", { name: "未补卡次数" }).length,
    ).toBeGreaterThan(0);
    expect(
      (await screen.findAllByText("须大于 0 且不超过当月自然日天数")).length,
    ).toBeGreaterThan(0);
    await user.click(await screen.findByRole("button", { name: "修正" }));
    expect(
      screen
        .getAllByRole("textbox")
        .map((input) => input.getAttribute("aria-label")),
    ).toEqual(
      version !== "TPL-ATT-v1"
        ? [
            "修正身份证号",
            "修正姓名",
            `修正${daysField}`,
            "修正旷工天数",
            "修正病假天数",
          ]
        : ["修正身份证号", "修正姓名", `修正${daysField}`],
    );
    expect(
      screen.queryByRole("textbox", { name: "修正总扣款" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "修正当月固定薪资标准" }),
    ).not.toBeInTheDocument();
    if (version === "TPL-ATT-v2") {
      const drawer = screen.getByRole("dialog");
      await user.click(
        within(drawer).getAllByRole("button", { name: /展开行|Expand row/ })[1],
      );
      expect(within(drawer).getByText("=SUM(AL4:AR4)")).toBeInTheDocument();
      expect(
        within(drawer).getAllByText("原始数据（只读）").length,
      ).toBeGreaterThan(0);
    }
    await user.clear(screen.getByRole("textbox", { name: `修正${daysField}` }));
    await user.type(
      screen.getByRole("textbox", { name: `修正${daysField}` }),
      "=10+10",
    );
    await user.click(screen.getByRole("button", { name: "保存并重新校验" }));
    expect(await screen.findByText("没有失败行")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(2);
    const correctionRequest = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/imports/attendance/12/rows/2/correct"),
    );
    expect(JSON.parse(String(correctionRequest?.[1]?.body))).toEqual({
      values: { [daysField]: "=10+10" },
    });
  },
);

test("考勤导入在未建立工资期间时禁用上传并提示范围", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith("/organization/company"))
        return Response.json({ id: 1, name: "测试公司" });
      if (path.endsWith("/payroll/workbench"))
        return Response.json({ period: null, periods: [], batches: [] });
      return Response.json([]);
    }),
  );
  const user = userEvent.setup();
  renderPage();
  await user.click(screen.getByRole("button", { name: "月度考勤" }));
  expect(
    await screen.findByText("请先建立并选择工资期间，无需提前建立主体批次"),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: /把 Excel 拖到这里/ }),
  ).toBeDisabled();
  expect(screen.getByText("暂无月度考勤导入记录")).toBeInTheDocument();
});

test("绩效历史失败行保留来源且禁止修正", async () => {
  const batch = {
    id: 17,
    company_id: 1,
    payroll_period_id: 3,
    payroll_batch_id: 9,
    import_type: "performance",
    original_filename: "performance.xlsx",
    file_sha256: "c".repeat(64),
    template_version: "TPL-PERF-v1",
    field_mapping: {},
    status: "partially_imported",
    total_rows: 2,
    success_rows: 1,
    error_rows: 1,
    rows: [
      {
        id: 1,
        sheet_name: "绩效历史",
        source_row_number: 3,
        validation_status: "imported",
        raw_data: {
          身份证号: "11010119900101123X",
          姓名: "张三",
          绩效系数: "0",
        },
        correction_values: null,
        normalized_data: { coefficient: "0" },
        errors: null,
        correction_history: [],
      },
      {
        id: 2,
        sheet_name: "绩效历史",
        source_row_number: 4,
        validation_status: "invalid",
        raw_data: {
          身份证号: "11010119900101124X",
          姓名: "李四",
          绩效系数: "",
        },
        correction_values: null,
        normalized_data: null,
        errors: [
          {
            code: "COEFFICIENT_REQUIRED",
            field: "绩效系数",
            column: "C",
            message: "绩效系数缺失；0 须明确填写",
          },
        ],
        correction_history: [],
      },
    ],
  };
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/organization/company"))
        return Response.json({ id: 1, name: "测试公司" });
      if (path.endsWith("/payroll/workbench"))
        return Response.json({
          period: { id: 3, period: "2027-03" },
          periods: [{ id: 3, period: "2027-03" }],
          batches: [
            {
              id: 9,
              batch_type: "normal",
              status: "draft",
              subject: { name: "上海主体" },
            },
          ],
        });
      if (path.endsWith("/imports/performance?company_id=1"))
        return Response.json([batch]);
      if (path.endsWith("/imports/attendance?company_id=1"))
        return Response.json([]);
      if (
        path.endsWith(
          "/imports/performance?company_id=1&payroll_period_id=3",
        ) &&
        init?.method === "POST"
      )
        return Response.json(batch);
      if (path.endsWith("/imports/performance/17/rows/2/correct"))
        return Response.json({
          ...batch,
          success_rows: 2,
          error_rows: 0,
          rows: batch.rows.map((row) => ({
            ...row,
            validation_status: "imported",
            errors: null,
          })),
        });
      return Response.json(batch);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  renderPage();
  await user.click(screen.getByRole("button", { name: "绩效历史" }));
  await screen.findByText("performance.xlsx");
  await user.click(screen.getByRole("button", { name: "查看详情" }));
  expect(
    (await screen.findAllByText("绩效系数缺失；0 须明确填写")).length,
  ).toBeGreaterThan(0);
  expect(
    screen.queryByRole("button", { name: "修正" }),
  ).not.toBeInTheDocument();
  expect(document.querySelector('input[type="file"]')).toBeNull();
  expect(
    fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(0);
  await user.click(screen.getByRole("button", { name: "月度考勤" }));
  expect(
    screen.getByText("上传月度考勤模板后显示导入结果"),
  ).toBeInTheDocument();
});

test("全公司月度输入无需预建批次，展示按主体归集及自动补齐结果", async () => {
  const result = {
    id: 30,
    company_id: 1,
    payroll_period_id: 7,
    payroll_batch_id: null,
    subject_name: "全公司",
    subjects: [
      {
        subject_id: 1,
        subject_name: "主体甲",
        payroll_batch_id: 101,
        success_rows: 1,
        error_rows: 0,
        batch_created: true,
      },
      {
        subject_id: 2,
        subject_name: "主体乙",
        payroll_batch_id: 102,
        success_rows: 1,
        error_rows: 0,
        batch_created: true,
      },
    ],
    rows: [],
    success_rows: 2,
    error_rows: 0,
    total_rows: 2,
    template_version: "TPL-ATT-v2",
    file_sha256: "test",
    status: "imported",
  };
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/organization/company"))
        return Response.json({ id: 1, name: "测试公司" });
      if (url.includes("/workbench"))
        return Response.json({
          period: { id: 7, period: "2026-07" },
          periods: [{ id: 7, period: "2026-07" }],
          batches: [],
        });
      if (init?.method === "POST") return Response.json(result);
      return Response.json([]);
    },
  );
  vi.stubGlobal("fetch", fetcher);
  renderPage(
    undefined,
    "/imports?type=attendance&period=2026-07&subject_id=999&batch_id=999",
  );
  const user = userEvent.setup();
  expect(await screen.findByText("全公司所有主体")).toBeInTheDocument();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: /把 Excel 拖到这里/ }),
    ).toBeEnabled(),
  );
  await user.upload(
    document.querySelector('input[type="file"]')!,
    new File(["xlsx"], "company.xlsx"),
  );
  const dialog = within(await screen.findByRole("dialog"));
  expect(
    await dialog.findByRole("link", { name: "查看核算 #101" }),
  ).toHaveAttribute("href", "/payroll/batches/101");
  expect(dialog.getByRole("link", { name: "查看核算 #102" })).toHaveAttribute(
    "href",
    "/payroll/batches/102",
  );
  expect(dialog.getAllByText("自动补齐草稿")).toHaveLength(2);
  expect(
    fetcher.mock.calls.some(
      ([url, init]) =>
        String(url).endsWith(
          "/imports/attendance?company_id=1&payroll_period_id=7",
        ) && init?.method === "POST",
    ),
  ).toBe(true);
});

test("整本失败行修正携带任务版本并更新依赖结果，历史保持只读", async () => {
  let task = workbookTask();
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/organization/company"))
        return Response.json({ id: 1, name: "测试公司" });
      if (path.includes("/payroll/workbench"))
        return Response.json({
          period: { id: 7, period: "2026-07" },
          periods: [{ id: 7, period: "2026-07" }],
          batches: [],
        });
      if (path.endsWith("/imports/workbook/50/rows/100/correct")) {
        expect(JSON.parse(String(init?.body))).toEqual({
          values: { 证件号码: "11010120000101002X" },
          expected_revision: 1,
        });
        task = {
          ...task,
          revision: 2,
          employee_import: {
            ...task.employee_import,
            error_rows: 0,
            success_rows: 2,
            rows: task.employee_import.rows.map((row) => ({
              ...row,
              validation_status: "imported",
              correction_values: { 证件号码: "11010120000101002X" },
              errors: [],
            })),
          },
          attendance_import: {
            ...task.attendance_import,
            error_rows: 0,
            success_rows: 2,
            rows: task.attendance_import.rows.map((row) => ({
              ...row,
              validation_status: "imported",
              errors: [],
            })),
          },
        } as typeof task;
        return Response.json(task);
      }
      if (init?.method === "POST" || path.endsWith("/imports/workbook/50"))
        return Response.json(task);
      return Response.json([task]);
    },
  );
  vi.stubGlobal("fetch", fetcher);
  renderPage(undefined, "/imports?type=workbook&period=2026-07");
  const user = userEvent.setup();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: /上传原工资工作簿/ }),
    ).toBeEnabled(),
  );
  await user.upload(
    screen.getByLabelText("原工资工作簿"),
    new File(["xlsx"], "whole.xlsx"),
  );
  await user.click(
    await screen.findByRole("button", { name: "修正花名册第3行" }),
  );
  await user.type(
    screen.getByRole("textbox", { name: /证件号码（B3）/ }),
    "11010120000101002X",
  );
  await user.click(screen.getByRole("button", { name: "保存并重验" }));
  await screen.findByText("全部输入已保存");
  expect(
    screen.queryByRole("button", { name: "修正花名册第3行" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "查看详情" }));
  expect(
    within(await screen.findByRole("dialog")).queryByRole("button", {
      name: /修正/,
    }),
  ).not.toBeInTheDocument();
});

test.each([false, true])(
  "新整本上传隔离上一任务的编辑状态及晚返回结果（保存中=%s）",
  async (pending) => {
    const first = workbookTask();
    const second = {
      ...workbookTask(),
      id: 60,
      original_filename: "next.xlsx",
    };
    let uploads = 0;
    let finish!: (value: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path.endsWith("/organization/company"))
          return Response.json({ id: 1, name: "测试公司" });
        if (path.includes("/payroll/workbench"))
          return Response.json({
            period: { id: 7, period: "2026-07" },
            periods: [{ id: 7, period: "2026-07" }],
            batches: [],
          });
        if (path.endsWith("/rows/100/correct"))
          return new Promise<Response>((resolve) => {
            finish = resolve;
          });
        if (init?.method === "POST")
          return Response.json(++uploads === 1 ? first : second);
        return Response.json([]);
      }),
    );
    renderPage(undefined, "/imports?type=workbook&period=2026-07");
    const user = userEvent.setup();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /上传原工资工作簿/ }),
      ).toBeEnabled(),
    );
    await user.upload(
      screen.getByLabelText("原工资工作簿"),
      new File(["xlsx"], "whole.xlsx"),
    );
    await user.click(
      await screen.findByRole("button", { name: "修正花名册第3行" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: /证件号码（B3）/ }),
      "11010120000101002X",
    );
    if (pending)
      await user.click(screen.getByRole("button", { name: "保存并重验" }));
    await user.upload(
      screen.getByLabelText("原工资工作簿"),
      new File(["xlsx"], "next.xlsx"),
    );
    await screen.findByText("next.xlsx");
    expect(
      screen.queryByRole("textbox", { name: /证件号码（B3）/ }),
    ).not.toBeInTheDocument();
    if (pending) {
      await act(async () => finish(Response.json(first)));
      expect(screen.getByText("next.xlsx")).toBeInTheDocument();
      expect(screen.queryByText("whole.xlsx")).not.toBeInTheDocument();
    }
  },
);

test.each([409, 503])(
  "整本纠错失败保留填写内容，支持刷新任务结果（%s）",
  async (status) => {
    const task = workbookTask();
    let refreshed = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path.endsWith("/organization/company"))
          return Response.json({ id: 1, name: "测试公司" });
        if (path.includes("/payroll/workbench"))
          return Response.json({
            period: { id: 7, period: "2026-07" },
            periods: [{ id: 7, period: "2026-07" }],
            batches: [],
          });
        if (path.endsWith("/rows/100/correct"))
          return Response.json(
            { detail: "任务已有新版本或引擎未就绪，请刷新后重试" },
            { status },
          );
        if (path.endsWith("/imports/workbook/50")) {
          refreshed = true;
          return Response.json({ ...task, revision: 2 });
        }
        if (init?.method === "POST") return Response.json(task);
        return Response.json([]);
      }),
    );
    renderPage(undefined, "/imports?type=workbook&period=2026-07");
    const user = userEvent.setup();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /上传原工资工作簿/ }),
      ).toBeEnabled(),
    );
    await user.upload(
      screen.getByLabelText("原工资工作簿"),
      new File(["xlsx"], "whole.xlsx"),
    );
    await user.click(
      await screen.findByRole("button", { name: "修正花名册第3行" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: /证件号码（B3）/ }),
      "核实值",
    );
    await user.click(screen.getByRole("button", { name: "保存并重验" }));
    await screen.findByText("任务已有新版本或引擎未就绪，请刷新后重试");
    expect(screen.getByRole("textbox", { name: /证件号码（B3）/ })).toHaveValue(
      "核实值",
    );
    await user.click(screen.getByRole("button", { name: "刷新任务结果" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("textbox", { name: /证件号码（B3）/ }),
      ).not.toBeInTheDocument(),
    );
    expect(refreshed).toBe(true);
  },
);
