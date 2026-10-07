import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { PayrollLedgerDetailPage } from "./ledger-detail";
const detail = {
  period_id: 1,
  period: "2026-09",
  untaxed_tax_notice: "金额为未扣个税金额；系统未计算个税。",
  attendance: { late_minutes: 10, expected_work_days: "20" },
  record: {
    id: 5,
    payroll_batch_id: 3,
    employee_id: 8,
    subject_name: "主主体",
    is_effective: true,
    calculation_status: "locked",
    payment_date: null,
    snapshot: {
      name: "计算时姓名",
      employee_no: "E01",
      id_number: "11010119900101001X",
      bank_account: "000012345678901234",
      fixed_salary: "8000.00",
    },
    amounts: {
      gross: "10000.00",
      deduction: "1000.00",
      untaxed_amount: "9000.00",
      employer_cost: "11000.00",
    },
    items: [
      {
        code: "fixed_salary",
        name: "固定薪资",
        category: "income",
        amount: "8000.00",
      },
    ],
    steps: [
      {
        code: "fixed_salary",
        formula: "计薪自然日折算",
        inputs: { month_days: "30" },
        amount: "8000.00",
      },
    ],
  },
  history: [
    {
      id: 4,
      period: "2026-08",
      subject_name: "原主体",
      batch_type: "normal",
      batch_no: 1,
      gross: "9000.00",
      untaxed_amount: "8000.00",
      is_effective: true,
      calculation_status: "locked",
    },
  ],
};
function renderPage(path = "/payroll/ledger/records/5") {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/payroll/ledger/records/:recordId"
            element={<PayrollLedgerDetailPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
test("正式明细使用快照、公式及历史导航，敏感号码脱敏且不重新试算", async () => {
  const fetch = vi.fn(async () => Response.json(detail));
  vi.stubGlobal("fetch", fetch);
  renderPage();
  expect(
    await screen.findByRole("heading", { name: "计算时姓名 · 员工计算明细" }),
  ).toBeInTheDocument();
  expect(screen.getByText("计薪自然日折算")).toBeInTheDocument();
  expect(screen.getByText("迟到分钟")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "2026-08" })).toHaveAttribute(
    "href",
    "/payroll/ledger/records/4",
  );
  expect(
    screen.queryByText(detail.record.snapshot.id_number),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText(detail.record.snapshot.bank_account),
  ).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]).toEqual([
    "/api/payroll/ledger/records/5",
    expect.anything(),
  ]);
});
test("已替代版本明确提示历史追溯", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        ...detail,
        record: { ...detail.record, is_effective: false },
      }),
    ),
  );
  renderPage();
  expect(
    await screen.findByText(
      "此记录已被整批更正替代，仅用于历史追溯；金额为未扣个税金额。",
    ),
  ).toBeInTheDocument();
});
test("正式明细错误保留台账返回入口", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ detail: "记录尚未确认" }, { status: 404 }),
    ),
  );
  renderPage();
  expect(await screen.findByText("记录尚未确认")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "返回台账" })).toHaveAttribute(
    "href",
    "/payroll/ledger",
  );
});
test("非法编号不请求接口", () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  renderPage("/payroll/ledger/records/invalid");
  expect(screen.getByText("工资记录编号无效")).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});
