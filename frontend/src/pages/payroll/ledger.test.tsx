import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntdApp } from "antd";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PayrollLedgerPage } from "./ledger";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("工资台账只展示正式结果并标明未扣个税金额", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) =>
      Response.json(
        String(input).includes("/workbench")
          ? {
              period: { id: 1, period: "2026-08" },
              periods: [{ id: 1, period: "2026-08" }],
              batches: [],
            }
          : {
              period_id: 1,
              period: "2026-08",
              filters: {},
              record_count: 1,
              records: [
                {
                  id: 5,
                  payroll_batch_id: 3,
                  subject_id: 2,
                  subject_name: "主主体",
                  employee_id: 8,
                  snapshot: {
                    name: "张三",
                    employee_no: "E01",
                    department_name: "研发",
                  },
                  amounts: {
                    gross: "10000.00",
                    deduction: "1000.00",
                    untaxed_amount: "9000.00",
                    employer_cost: "11000.00",
                  },
                  calculation_status: "locked",
                },
              ],
              totals: {
                gross: "10000.00",
                deduction: "1000.00",
                untaxed_amount: "9000.00",
                employer_cost: "11000.00",
              },
              untaxed_tax_notice: "金额为未扣个税金额；系统未计算个税。",
            },
      ),
    ),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <AntdApp>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/payroll/ledger?period_id=1"]}>
          <Routes>
            <Route path="/payroll/ledger" element={<PayrollLedgerPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </AntdApp>,
  );
  expect(await screen.findByText("工资台账与汇总")).toBeInTheDocument();
  expect(screen.getAllByText("未扣个税金额").length).toBeGreaterThan(0);
  expect(await screen.findByText("张三")).toBeInTheDocument();
  expect(screen.getAllByText("¥9,000.00").length).toBeGreaterThan(0);
});
