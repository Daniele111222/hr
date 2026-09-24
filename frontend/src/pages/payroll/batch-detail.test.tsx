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
