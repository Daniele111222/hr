import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { App as AntdApp } from "antd";
import { PayrollPage } from "../payroll/index";
import { afterEach, expect, test, vi } from "vitest";
import { OverviewPage } from "./index";

const period = { id: 1, period: "2026-09" };
const subject = { id: 2, code: "LOCAL", name: "本机主体" };
const prepared = { status: "ready", prepared_count: 1, missing_count: 0 };
const batch = {
  id: 10,
  subject,
  batch_no: 1,
  batch_type: "normal",
  status: "trial",
  scope: { employee_count: 1, employee_ids: [8], status: "ready" },
  data_preparation: {
    attendance: prepared,
    performance: prepared,
    city_rules: prepared,
  },
  trial_summary: { stale: true, error_count: 0, total_count: 1 },
};
function renderPage() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={["/?period=2026-09"]}>
        <OverviewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
function stub(empty = false) {
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("/health")) return Response.json({ status: "ok" });
    if (url.includes("/company"))
      return Response.json(empty ? null : { id: 1, name: "本机公司" });
    if (url.includes("/subjects")) return Response.json(empty ? [] : [subject]);
    if (url.includes("/workbench"))
      return Response.json(
        empty
          ? { period: null, periods: [], batches: [] }
          : { period, periods: [period], batches: [batch] },
      );
    if (url.includes("/ledger"))
      return Response.json({
        record_count: 0,
        totals: { untaxed_amount: "0.00" },
      });
    if (url.includes("/confirmation"))
      return Response.json({
        locked: false,
        confirmed: false,
        blockers: ["最新试算尚未查看"],
      });
    if (url.includes("/attendance-incentive"))
      return Response.json({
        status: "ready",
        message: "等待激励计算",
        run: null,
      });
    if (url.includes("/preview"))
      return Response.json({ versions: [], can_export: false });
    return Response.json([]);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
test("首页按真实期间显示过期试算和待办，不自动查看试算也不把未确认金额当零", async () => {
  const fetch = stub();
  renderPage();
  expect(await screen.findByText("试算已过期")).toBeInTheDocument();
  expect(
    await screen.findByText("本机主体：输入已变化，重新试算"),
  ).toBeInTheDocument();
  expect(screen.getByText("最新试算尚未查看")).toBeInTheDocument();
  expect(screen.queryByText("¥0.00")).not.toBeInTheDocument();
  expect(
    fetch.mock.calls.some(([input]) => String(input).includes("/trial")),
  ).toBe(false);
  expect(
    fetch.mock.calls.some(([input]) =>
      String(input).includes("period=2026-09"),
    ),
  ).toBe(true);
});
test("首页空状态提供初始化与建立期间入口", async () => {
  stub(true);
  renderPage();
  expect(await screen.findByText("尚无工资期间")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "初始化目标公司" })).toHaveAttribute(
    "href",
    "/organization",
  );
  expect(
    screen.getByRole("link", { name: "建立工资期间并为主体建立正常工资批次" }),
  ).toHaveAttribute("href", "/payroll");
});
test("首页接口失败反馈原因", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ detail: "本机数据库不可用" }, { status: 503 }),
    ),
  );
  renderPage();
  await waitFor(() =>
    expect(screen.getByText("月度工作台加载失败")).toBeInTheDocument(),
  );
  expect(screen.getByText("本机数据库不可用")).toBeInTheDocument();
});
test("首页加载期间不显示假进度", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>(() => {})),
  );
  renderPage();
  expect(screen.getByText("整体进度 — / 7")).toBeInTheDocument();
  expect(screen.queryByText("当前没有待处理事项")).not.toBeInTheDocument();
});

test.each([false, true])(
  "首页建立批次入口正确跳转，已有期间：%s",
  async (hasPeriod) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.includes("/health")) return Response.json({ status: "ok" });
        if (url.includes("/company"))
          return Response.json({ id: 1, name: "本机公司" });
        if (url.includes("/subjects")) return Response.json([subject]);
        if (url.includes("/workbench"))
          return Response.json({
            period: hasPeriod ? period : null,
            periods: hasPeriod ? [period] : [],
            batches: [],
          });
        if (url.includes("/confirmation"))
          return Response.json({
            locked: false,
            confirmed: false,
            blockers: [],
          });
        if (url.includes("/ledger"))
          return Response.json({
            record_count: 0,
            totals: { untaxed_amount: "0.00" },
          });
        return Response.json([]);
      }),
    );
    const user = userEvent.setup();
    render(
      <AntdApp>
        <QueryClientProvider
          client={
            new QueryClient({ defaultOptions: { queries: { retry: false } } })
          }
        >
          <MemoryRouter initialEntries={["/"]}>
            <Routes>
              <Route path="/" element={<OverviewPage />} />
              <Route path="/payroll" element={<PayrollPage />} />
              <Route path="*" element={<div>无效地址</div>} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </AntdApp>,
    );
    const link = await screen.findByRole("link", { name: "建立批次" });
    expect(link).toHaveAttribute(
      "href",
      hasPeriod
        ? "/payroll?period=2026-09&subject_id=2"
        : "/payroll?subject_id=2",
    );
    await user.click(link);
    expect(await screen.findByText("工资期间与批次")).toBeInTheDocument();
    if (hasPeriod) {
      await user.click(
        screen.getByRole("button", { name: /^(plus )?建立批次$/ }),
      );
      expect(
        await screen.findByRole("combobox", { name: "工资主体" }),
      ).toBeInTheDocument();
    } else {
      expect(
        screen.getByRole("button", { name: /^(plus )?建立批次$/ }),
      ).toBeDisabled();
      await user.click(screen.getByRole("button", { name: /建立工资期间/ }));
      expect(
        await screen.findByRole("textbox", { name: "工资期间" }),
      ).toBeInTheDocument();
    }
  },
);
