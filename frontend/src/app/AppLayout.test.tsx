import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { AppLayout } from "./AppLayout";
function Destination() {
  const location = useLocation();
  return <p>{location.pathname + location.search}</p>;
}
function setup(path: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/company")) return Response.json({ name: "测试公司" });
      if (url.includes("/ledger/records/5"))
        return Response.json({ period: "2026-07" });
      if (url.includes("/batches/5")) return Response.json({ period_id: 8 });
      return Response.json({
        period: { id: 9, period: "2026-09" },
        periods: [
          { id: 9, period: "2026-09" },
          { id: 8, period: "2026-08" },
        ],
      });
    }),
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="*" element={<Destination />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
test("台账期间 ID 转成菜单年月，跨页导航不会跳到最新期间", async () => {
  setup("/payroll/ledger?period_id=8");
  expect(await screen.findByText("2026-08")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("menuitem", { name: /结果导出/ }));
  expect(
    await screen.findByText("/exports?period=2026-08"),
  ).toBeInTheDocument();
});
test("直接打开旧员工快照时顶栏和导航跟随记录期间", async () => {
  setup("/payroll/ledger/records/5");
  expect(await screen.findByText("2026-07")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("menuitem", { name: /期间与批次/ }));
  expect(
    await screen.findByText("/payroll?period=2026-07"),
  ).toBeInTheDocument();
});

test("工资核算二级入口保持当前期间", async () => {
  setup("/payroll/batches/5");
  expect(await screen.findByText("2026-08")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("menuitem", { name: "考勤激励" }));
  expect(
    await screen.findByText("/payroll/incentive?period=2026-08"),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole("menuitem", { name: "工资台账" }));
  expect(
    await screen.findByText("/payroll/ledger?period=2026-08"),
  ).toBeInTheDocument();
});
