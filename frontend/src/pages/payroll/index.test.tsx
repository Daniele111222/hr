import { App as AntdApp } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { PayrollPage } from "./index.tsx";

const period = {
  id: 1,
  year: 2026,
  month: 9,
  period: "2026-09",
  period_start: "2026-09-01",
  period_end: "2026-09-30",
  payment_date: null,
  payment_date_confirmed: false,
  batch_count: 1,
  normal_batch_count: 1,
};

const batch = {
  id: 10,
  period_id: 1,
  subject: { id: 2, code: "MAIN", name: "主主体" },
  batch_type: "normal" as const,
  batch_no: 1,
  name: null,
  status: "draft" as const,
  scope: {
    source: "employee_assignment_for_period",
    criteria: { period: "2026-09" },
    employee_count: 2,
    employee_ids: [1, 2],
    ambiguous_employee_ids: [],
    status: "ready" as const,
  },
  data_preparation: {
    attendance: { status: "partial" as const, prepared_count: 1, missing_count: 1, message: null },
    performance: { status: "missing" as const, prepared_count: 0, missing_count: 2, message: null },
    city_rules: { status: "ready" as const, prepared_count: 2, missing_count: 0, message: null },
    overall_status: "partial" as const,
  },
  payment_date: null,
  payment_date_confirmed: false,
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <AntdApp>
      <QueryClientProvider client={client}>
        <PayrollPage />
      </QueryClientProvider>
    </AntdApp>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("工资工作台显示期间、员工范围、准备情况和未确认发放日期", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/organization/subjects")
        ? Response.json([batch.subject])
        : Response.json({ period, periods: [period], batches: [batch] }),
    ),
  );

  renderPage();

  expect(await screen.findByText("工资期间与批次")).toBeInTheDocument();
  expect(await screen.findByText("期间有效任职关系")).toBeInTheDocument();
  expect(screen.getByText("2 人")).toBeInTheDocument();
  expect(screen.getByText("考勤 1/2")).toBeInTheDocument();
  expect(screen.getAllByText("未确认").length).toBeGreaterThan(0);
});

test("工资工作台显示 API 错误", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/organization/subjects")
        ? Response.json([])
        : Response.json({ detail: "工资期间查询失败" }, { status: 500 }),
    ),
  );

  renderPage();

  expect(await screen.findByText("工资期间查询失败")).toBeInTheDocument();
});

test("工资工作台可以幂等创建期间并刷新当前期间", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.endsWith("/payroll/periods") && init?.method === "POST") {
      return Response.json(period);
    }
    if (path.includes("/organization/subjects")) {
      return Response.json([]);
    }
    if (path.includes("/payroll/workbench")) {
      return Response.json({ period, periods: [period], batches: [] });
    }
    return Response.json([]);
  });
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();

  renderPage();
  await user.click(await screen.findByText("建立工资期间"));
  await user.type(screen.getByRole("textbox", { name: "工资期间" }), "2026-09");
  await user.click(screen.getByText("OK"));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/payroll/periods",
      expect.objectContaining({ method: "POST" }),
    ),
  );
  expect(await screen.findByText("2026-09 本期批次")).toBeInTheDocument();
});

test("没有现有批次时仍可选择主体建立首个批次", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.includes("/organization/subjects")) return Response.json([batch.subject]);
    if (path.endsWith("/payroll/periods/1/batches") && init?.method === "POST") {
      return Response.json(batch, { status: 201 });
    }
    return Response.json({ period, periods: [period], batches: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();

  renderPage();
  await user.click(await screen.findByText("建立批次"));
  await user.click(screen.getByRole("combobox", { name: "工资主体" }));
  await user.click(await screen.findByText("主主体（MAIN）"));
  await user.click(screen.getByText("OK"));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/payroll/periods/1/batches",
      expect.objectContaining({ method: "POST" }),
    ),
  );
});

test("重复正常批次显示后端冲突", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/payroll/periods/1/batches") && init?.method === "POST") {
        return Response.json({ detail: "该主体在此工资期间已有正常批次" }, { status: 409 });
      }
      if (String(input).includes("/organization/subjects")) return Response.json([batch.subject]);
      return Response.json({ period, periods: [period], batches: [batch] });
    }),
  );
  const user = userEvent.setup();

  renderPage();
  await user.click(await screen.findByText("建立批次"));
  await user.click(screen.getByRole("combobox", { name: "工资主体" }));
  await user.click(await screen.findByText("主主体（MAIN）"));
  await user.click(screen.getByText("OK"));

  expect(await screen.findByText("该主体在此工资期间已有正常批次")).toBeInTheDocument();
});
