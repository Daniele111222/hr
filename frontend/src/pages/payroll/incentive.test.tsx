import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntdApp } from "antd";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { AttendanceIncentivePage } from "./incentive";

const period = {
  id: 2,
  year: 2026,
  month: 9,
  period: "2026-09",
  period_start: "2026-09-01",
  period_end: "2026-09-30",
  payment_date: null,
  payment_date_confirmed: false,
  batch_count: 2,
  normal_batch_count: 2,
};
const workbench = { period, periods: [period], batches: [] };
const incentive = {
  period_id: 2,
  period: "2026-09",
  source_period: "2026-08",
  company_id: 1,
  status: "ready" as const,
  can_calculate: true,
  message: null,
  source_rows: [
    { subject_id: 1, subject_name: "主主体", attendance_deduction: "100.00" },
  ],
  current_rows: [
    {
      subject_id: 1,
      subject_name: "主主体",
      subject_code: "MAIN",
      batch_id: 2,
      trial_id: 3,
    },
  ],
  pool_amount: "100.00",
  candidate_snapshot: [
    {
      employee_id: 7,
      employee_no: "E007",
      employee_name: "张三",
      subject_id: 1,
      level_number: 6,
      eligible: true,
      reason: null,
    },
  ],
  run: null,
  input_fingerprint: "abc",
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <AntdApp>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/payroll/incentive?period=2026-09"]}>
          <AttendanceIncentivePage />
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

test("显示全公司激励池、候选快照并可计算", async () => {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      if (
        String(input).endsWith("/attendance-incentive") &&
        init?.method === "POST"
      ) {
        return Response.json({
          ...incentive,
          status: "calculated",
          run: {
            id: 9,
            company_id: 1,
            payroll_period_id: 2,
            source_period_id: 1,
            status: "calculated",
            input_fingerprint: "abc",
            pool_amount: "100.00",
            allocated_amount: "100.00",
            average_amount: "100.00",
            remainder_amount: "0.00",
            source_snapshot: [],
            candidate_snapshot: incentive.candidate_snapshot,
            allocations: [{ employee_id: 7, amount: "100.00" }],
            message: null,
            created_at: "2026-09-24T10:00:00Z",
            stale: false,
            ready: true,
          },
        });
      }
      if (String(input).includes("/attendance-incentive"))
        return Response.json(incentive);
      return Response.json(workbench);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  renderPage();

  expect(await screen.findByText("全公司考勤激励")).toBeInTheDocument();
  expect(screen.getByText("¥100.00")).toBeInTheDocument();
  expect(screen.getByText("张三 · E007")).toBeInTheDocument();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "计算本期激励" }));
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/payroll/periods/2/attendance-incentive",
      expect.objectContaining({ method: "POST" }),
    ),
  );
});

test("数据未就绪时禁用计算", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/attendance-incentive")
        ? Response.json({
            ...incentive,
            status: "blocked",
            can_calculate: false,
            message: "缺少上月锁定批次",
          })
        : Response.json(workbench),
    ),
  );
  renderPage();
  expect(await screen.findByText("全公司数据尚未就绪")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "计算本期激励" })).toBeDisabled();
});
