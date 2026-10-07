import { MemoryRouter } from "react-router-dom";
import { App as AntdApp } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
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
) {
  return render(
    <AntdApp>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ImportsPage />
        </MemoryRouter>
      </QueryClientProvider>
    </AntdApp>,
  );
}

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
  expect(screen.getByText(/按实际金额填写，不限制比例/)).toBeInTheDocument();
  expect(screen.queryByText(/80%\/20%/)).not.toBeInTheDocument();
  expect(
    screen.getByText(/支持本行引用、四则运算、括号、ROUND 和 EDATE/),
  ).toBeInTheDocument();
  expect(document.querySelector('input[type="file"]')).toHaveAttribute(
    "accept",
    ".xlsx",
  );
});

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
    label: "月度绩效",
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

test("考勤本次上传保留逐行修正功能", async () => {
  const batch = {
    id: 12,
    company_id: 1,
    payroll_period_id: 3,
    payroll_batch_id: 9,
    import_type: "attendance",
    original_filename: "attendance.xlsx",
    file_sha256: "b".repeat(64),
    template_version: "TPL-ATT-v1",
    field_mapping: {},
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
        normalized_data: {},
        errors: null,
        correction_history: [],
      },
      {
        id: 2,
        sheet_name: "月度考勤",
        source_row_number: 4,
        validation_status: "invalid",
        raw_data: {
          身份证号: "11010119900101124X",
          姓名: "李四",
          应出勤天数: "0",
        },
        correction_values: null,
        normalized_data: null,
        errors: [
          {
            code: "WORK_DAYS_OUT_OF_RANGE",
            field: "应出勤天数",
            column: "C",
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
        path.endsWith("/imports/attendance?payroll_batch_id=9") &&
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
  expect(await screen.findByText("固定模板 TPL-ATT-v1")).toBeInTheDocument();
  expect(await screen.findByText("上海主体 · 批次 #9")).toBeInTheDocument();
  await user.upload(
    document.querySelector('input[type="file"]')!,
    new File(["xlsx"], "attendance.xlsx"),
  );
  expect(
    await screen.findByText("正确行已保存，错误行未进入有效考勤"),
  ).toBeInTheDocument();
  expect(
    (await screen.findAllByText("须大于 0 且不超过当月自然日天数")).length,
  ).toBeGreaterThan(0);
  await user.click(await screen.findByRole("button", { name: "修正" }));
  await user.clear(screen.getByRole("textbox", { name: "修正应出勤天数" }));
  await user.type(
    screen.getByRole("textbox", { name: "修正应出勤天数" }),
    "20",
  );
  await user.click(screen.getByRole("button", { name: "保存并重新校验" }));
  expect(await screen.findByText("没有失败行")).toBeInTheDocument();
  expect(
    fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(2);
});

test("考勤导入在未建立工资批次时禁用上传并提示范围", async () => {
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
    await screen.findByText("请先在工资核算中建立本期间的正常工资批次"),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: /把 Excel 拖到这里/ }),
  ).toBeDisabled();
  expect(screen.getByText("暂无月度考勤导入记录")).toBeInTheDocument();
});

test("绩效本次上传保留逐行修正功能", async () => {
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
        sheet_name: "月度绩效",
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
        sheet_name: "月度绩效",
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
        return Response.json([]);
      if (path.endsWith("/imports/attendance?company_id=1"))
        return Response.json([]);
      if (
        path.endsWith("/imports/performance?payroll_batch_id=9") &&
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
  await user.click(screen.getByRole("button", { name: "月度绩效" }));
  expect(await screen.findByText("固定模板 TPL-PERF-v1")).toBeInTheDocument();
  expect(screen.getByText(/试用期不考核绩效/)).toBeInTheDocument();
  await user.upload(
    document.querySelector('input[type="file"]')!,
    new File(["xlsx"], "performance.xlsx"),
  );
  expect(
    await screen.findByText("正确行已保存，错误行未进入有效绩效"),
  ).toBeInTheDocument();
  expect(
    (await screen.findAllByText("绩效系数缺失；0 须明确填写")).length,
  ).toBeGreaterThan(0);
  await user.click(await screen.findByRole("button", { name: "修正" }));
  await user.type(screen.getByRole("textbox", { name: "修正绩效系数" }), "1.5");
  await user.click(screen.getByRole("button", { name: "保存并重新校验" }));
  expect(await screen.findByText("没有失败行")).toBeInTheDocument();
  expect(
    fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: "月度考勤" }));
  expect(
    screen.getByText("上传月度考勤模板后显示校验结果"),
  ).toBeInTheDocument();
});
