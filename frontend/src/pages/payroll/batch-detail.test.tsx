import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntdApp } from "antd";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { PayrollBatchDetailPage } from "./batch-detail";

const prep = {
  status: "ready",
  prepared_count: 1,
  missing_count: 0,
  message: null,
};
const batch = {
  id: 10,
  period_id: 1,
  subject: { id: 2, code: "MAIN", name: "主主体" },
  batch_type: "normal",
  batch_no: 1,
  name: null,
  status: "draft",
  scope: {
    source: "employee_assignment_for_period",
    criteria: {},
    employee_count: 1,
    employee_ids: [1],
    ambiguous_employee_ids: [],
    status: "ready",
  },
  data_preparation: {
    attendance: prep,
    performance: prep,
    city_rules: prep,
    overall_status: "ready",
  },
  payment_date: null,
  payment_date_confirmed: false,
};
const trial = {
  id: 31,
  payroll_batch_id: 10,
  input_fingerprint: "abc123",
  created_at: "2026-09-24T10:00:00Z",
  stale: false,
  success_count: 1,
  error_count: 0,
  total_count: 1,
  totals: {
    gross: "10000.00",
    untaxed_amount: "9000.00",
    employer_cost: "11000.00",
  },
  results: [
    {
      employee_id: 1,
      employee_name: "张三",
      snapshot: {
        employee_no: "E01",
        department_name: "研发",
        position_title: "工程师",
        level_number: 6,
        last_effective_subject_id: 2,
      },
      errors: [],
      warnings: [],
      amounts: {
        fixed: "8000.00",
        performance: "2000.00",
        attendance_deduction: "0.00",
        gross: "10000.00",
        employee_social: "600.00",
        employee_housing: "400.00",
        untaxed_amount: "9000.00",
        employer_cost: "11000.00",
      },
      items: [],
      steps: [
        {
          code: "fixed_salary",
          formula: "固定月薪 × 自然日",
          inputs: {},
          amount: "8000.00",
        },
      ],
    },
  ],
  includes_final_incentive: false,
  ready_for_confirmation: false,
  confirmation_blockers: ["尚未计算全公司考勤激励"],
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <AntdApp>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/payroll/batches/10"]}>
          <Routes>
            <Route
              path="/payroll/batches/:batchId"
              element={<PayrollBatchDetailPage />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </AntdApp>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("未试算时展示数据准备，并可发起普通试算查看计算明细", async () => {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/trial"))
        return Response.json(init?.method === "POST" ? trial : null);
      return Response.json(batch);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  renderPage();
  const user = userEvent.setup();
  expect(await screen.findByText("员工名册")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /开始普通试算/ }));
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/payroll/batches/10/trial",
      expect.objectContaining({ method: "POST" }),
    ),
  );
  await user.click(screen.getByRole("tab", { name: /试算结果/ }));
  expect(await screen.findByText("张三")).toBeInTheDocument();
  expect(screen.getAllByText("¥9,000.00").length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: "整批确认" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: /明\s*细/ }));
  expect(await screen.findByText("固定月薪 × 自然日")).toBeInTheDocument();
});

test("过期试算显示失效提示且保留上次金额", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/trial")
        ? Response.json({ ...trial, stale: true })
        : Response.json(batch),
    ),
  );
  renderPage();
  expect(
    await screen.findByText("试算已失效：输入或规则已更新"),
  ).toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole("tab", { name: /试算结果/ }));
  expect(await screen.findByText("张三")).toBeInTheDocument();
});

test("批次详情接口错误显示明确反馈", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ detail: "批次不存在" }, { status: 404 })),
  );
  renderPage();
  expect(await screen.findByText("批次详情加载失败")).toBeInTheDocument();
  expect(screen.getByText("批次不存在")).toBeInTheDocument();
});

test("大额金额展示保持接口文本精度", async () => {
  const large = "9007199254740993.00";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/trial")
        ? Response.json({
            ...trial,
            totals: { ...trial.totals, untaxed_amount: large },
          })
        : Response.json(batch),
    ),
  );
  renderPage();
  await userEvent
    .setup()
    .click(await screen.findByRole("tab", { name: /试算结果/ }));
  expect(
    await screen.findByText("¥9,007,199,254,740,993.00"),
  ).toBeInTheDocument();
});

test("已锁定批次可发起整批更正并保存原因", async () => {
  const lockedBatch = { ...batch, status: "locked", is_effective: true };
  const correction = {
    id: 50,
    original_batch_id: 10,
    replacement_batch_id: 11,
    reason: "修正绩效导入",
    status: "requested",
    created_at: "2026-09-28T10:00:00Z",
    original_status: "locked",
    replacement_status: "draft",
    replacement_is_effective: false,
  };
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/corrections")) {
        return init?.method === "POST"
          ? Response.json(correction, { status: 201 })
          : Response.json([]);
      }
      if (path.endsWith("/trial")) return Response.json(null);
      return Response.json(lockedBatch);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  renderPage();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "发起整批更正" }));
  await user.type(
    screen.getByPlaceholderText("请填写更正原因，便于后续追溯"),
    "修正绩效导入",
  );
  await user.click(screen.getByRole("button", { name: "生成替代版本" }));
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/payroll/batches/10/corrections",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ reason: "修正绩效导入" }),
      }),
    ),
  );
});

test("替代版本可修正月度输入并保存来源说明", async () => {
  const replacement = {
    ...batch,
    id: 10,
    status: "draft",
    is_effective: false,
  };
  const correction = {
    id: 50,
    original_batch_id: 9,
    replacement_batch_id: 10,
    reason: "修正考勤",
    status: "requested",
    created_at: "2026-09-28T10:00:00Z",
    original_status: "locked",
    replacement_status: "draft",
    replacement_is_effective: false,
  };
  const inputs = [
    {
      employee_id: 1,
      employee_name: "张三",
      attendance: {
        expected_work_days: "20.00",
        late_minutes: 0,
        early_leave_minutes: 0,
        paid_leave_days: "0.00",
        unpaid_leave_days: "0.00",
        missed_punch_count: 0,
        corrected_punch_count: 0,
      },
      performance_coefficient: "1",
      source_note: null,
    },
  ];
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, _init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/corrections")) return Response.json([correction]);
      if (path.endsWith("/inputs")) return Response.json(inputs);
      if (path.endsWith("/trial")) return Response.json(null);
      return Response.json(replacement);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  renderPage();
  const user = userEvent.setup();
  expect(
    await screen.findByText(/本次仅修正考勤与绩效；薪酬和规则沿用原确认快照/),
  ).toBeInTheDocument();
  await user.click(await screen.findByRole("button", { name: "修正输入" }));
  expect(screen.getByRole("button", { name: "保存修正输入" })).toBeDisabled();
  await user.clear(screen.getByRole("textbox", { name: "迟到分钟" }));
  await user.type(screen.getByRole("textbox", { name: "迟到分钟" }), "30");
  await user.clear(screen.getByRole("textbox", { name: "绩效系数" }));
  await user.type(screen.getByRole("textbox", { name: "绩效系数" }), "1.5");
  await user.type(
    screen.getByRole("textbox", { name: "修正来源说明" }),
    "考勤核对单",
  );
  await user.click(screen.getByRole("button", { name: "保存修正输入" }));
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/payroll/corrections/50/inputs",
      expect.objectContaining({
        method: "PUT",
        body: expect.stringContaining('"late_minutes":"30"'),
      }),
    ),
  );
  expect(
    fetchMock.mock.calls.some(
      ([, init]) =>
        init?.method === "PUT" &&
        String(init.body).includes('"source_note":"考勤核对单"'),
    ),
  ).toBe(true);
});

test("替代版本锁定后自动生效，无需单独应用", async () => {
  const replacement = { ...batch, status: "confirmed", is_effective: false };
  const correction = {
    id: 50,
    original_batch_id: 9,
    replacement_batch_id: 10,
    reason: "修正考勤",
    status: "requested",
    created_at: "2026-09-28T10:00:00Z",
    original_status: "locked",
    replacement_status: "confirmed",
    replacement_is_effective: false,
  };
  const confirmation = {
    period_id: 1,
    period: "2026-09",
    subject_count: 1,
    batch_count: 1,
    batches: [],
    confirmed: true,
    locked: false,
    can_confirm: false,
    can_lock: true,
    blockers: [],
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith("/corrections")) return Response.json([correction]);
    if (path.endsWith("/confirmation")) return Response.json(confirmation);
    if (path.endsWith("/lock"))
      return Response.json({ ...confirmation, locked: true, can_lock: false });
    if (path.endsWith("/trial"))
      return Response.json({ ...trial, ready_for_confirmation: true });
    return Response.json(replacement);
  });
  vi.stubGlobal("fetch", fetchMock);
  renderPage();
  await userEvent
    .setup()
    .click(await screen.findByRole("button", { name: "锁定本期批次" }));
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/payroll/periods/1/lock",
      expect.objectContaining({ method: "POST" }),
    ),
  );
  expect(
    screen.queryByRole("button", { name: "使替代版本生效" }),
  ).not.toBeInTheDocument();
});

test("独立补发校验金额并在保存后重新试算", async () => {
  const supplement = { ...batch, batch_type: "supplement", name: "补发差额", is_effective: true };
  const supplementTrial = {
    ...trial,
    totals: { gross: "50.00", untaxed_amount: "50.00", employer_cost: "50.00" },
    results: [{ employee_id: 1, employee_name: "张三", amounts: { untaxed_amount: "50.00" } }],
    ready_for_confirmation: true,
    confirmation_blockers: [],
  };
  let savedRows: { employee_id: number; amount: string }[] = [];
  let latestTrial: typeof supplementTrial | null = null;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.endsWith("/supplement-inputs")) {
      if (init?.method === "PUT") savedRows = JSON.parse(String(init.body));
      return Response.json(savedRows);
    }
    if (path.endsWith("/employees"))
      return Response.json([{ id: 1, name: "张三", employee_no: "E01" }]);
    if (path.endsWith("/trial")) {
      if (init?.method === "POST") latestTrial = supplementTrial;
      return Response.json(latestTrial);
    }
    return Response.json(supplement);
  });
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByText("录入员工金额"));
  await user.click(screen.getByRole("combobox", { name: "员工" }));
  await user.click(await screen.findByText("张三 · E01"));
  await user.type(screen.getByRole("textbox", { name: "补发金额（未扣个税）" }), "0");
  await user.click(screen.getByText("OK"));
  expect(await screen.findByText("补发金额须为大于零且最多两位小数的数字")).toBeInTheDocument();
  expect(savedRows).toEqual([]);
  await user.clear(screen.getByRole("textbox", { name: "补发金额（未扣个税）" }));
  await user.type(screen.getByRole("textbox", { name: "补发金额（未扣个税）" }), "50.00");
  await user.click(screen.getByText("OK"));
  await waitFor(() => expect(savedRows).toEqual([{ employee_id: 1, amount: "50.00" }]));
  await user.click(screen.getByRole("button", { name: "重新试算" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
    "/api/payroll/batches/10/trial", expect.objectContaining({ method: "POST" }),
  ));
  expect(await screen.findByText("试算合计：", { exact: false })).toBeInTheDocument();
});
