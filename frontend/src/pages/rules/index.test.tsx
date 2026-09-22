import { App as AntdApp } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { RulesPage } from "./index.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <AntdApp>
      <QueryClientProvider client={client}>
        <RulesPage />
      </QueryClientProvider>
    </AntdApp>,
  );
}

test("规则页面展示版本和固定口径", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith("/rules/city-rules"))
        return Response.json([
          {
            id: 1,
            city_id: 1,
            city_name: "北京",
            effective_from: "2026-01-01",
            effective_to: "2026-12-31",
            version: "v2026.1",
            source: "政策",
            fixed_base: "6821.00",
            social_items: [],
            housing_company_rate: "0.05000000",
            housing_employee_rate: "0.05000000",
            housing_base_source: "fixed_salary",
          },
        ]);
      if (path.endsWith("/rules/attendance"))
        return Response.json([
          {
            id: 1,
            effective_from: "2026-01-01",
            effective_to: null,
            standard_hours: "8.00",
            missed_punch_amount: "30.00",
            exempt_level_number: 7,
            makeup_punch_exempt: true,
            version: "v2026.1",
            source: "制度",
          },
        ]);
      if (path.endsWith("/organization/cities"))
        return Response.json([{ id: 1, code: "BJ", name: "北京" }]);
      return Response.json([]);
    }),
  );
  renderPage();
  expect(await screen.findByText("北京")).toBeInTheDocument();
  expect(screen.getByText("当前有效")).toBeInTheDocument();
  expect(screen.getByText("固定薪资 · 5%/5%")).toBeInTheDocument();
  expect(screen.getByText("补卡免扣 · P7+")).toBeInTheDocument();
});

test("规则页面新增城市规则并显示后端错误", async () => {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/rules/city-rules") && init?.method === "POST")
        return Response.json({ detail: "规则有效期重叠" }, { status: 409 });
      if (path.endsWith("/rules/city-rules")) return Response.json([]);
      if (path.endsWith("/rules/attendance")) return Response.json([]);
      if (path.endsWith("/organization/cities"))
        return Response.json([{ id: 1, code: "BJ", name: "北京" }]);
      return Response.json([]);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByRole("button", { name: /新增城市规则/ }));
  await user.selectOptions(screen.getByRole("combobox", { name: "城市" }), "1");
  await user.type(screen.getByRole("textbox", { name: "版本号" }), "v2026.1");
  await user.type(
    screen.getByRole("spinbutton", { name: "社保固定缴费基数" }),
    "6821",
  );
  fireEvent.change(document.querySelector('input[type="date"]')!, {
    target: { value: "2026-01-01" },
  });
  await user.type(screen.getByPlaceholderText("代码"), "pension");
  await user.type(screen.getByPlaceholderText("险种名称"), "养老");
  await user.type(screen.getByPlaceholderText("个人比例"), "0.08");
  await user.type(screen.getByPlaceholderText("公司比例"), "0.16");
  await user.click(screen.getByRole("button", { name: /保\s*存/ }));
  expect(await screen.findByText("规则有效期重叠")).toBeInTheDocument();
});
