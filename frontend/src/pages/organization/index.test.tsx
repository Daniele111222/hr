import { App as AntdApp } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { OrganizationPage } from "./index.tsx";

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
        <OrganizationPage />
      </QueryClientProvider>
    </AntdApp>,
  );
}

test("组织页面展示加载状态和空数据初始化入口", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>(() => undefined)),
  );

  const { container } = renderPage();

  await waitFor(() =>
    expect(
      container.querySelectorAll(".ant-card-loading").length,
    ).toBeGreaterThan(0),
  );
});

test("组织页面可以初始化目标公司并刷新结果", async () => {
  let company: { id: number; code: string; name: string } | null = null;
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/organization/company") && init?.method === "POST") {
        company = { id: 1, code: "ACME", name: "示例公司" };
        return Response.json(company, { status: 201 });
      }
      if (path.endsWith("/organization/company")) return Response.json(company);
      return Response.json([]);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  renderPage();

  expect(await screen.findByText("初始化目标公司")).toBeInTheDocument();
  await user.type(screen.getByRole("textbox", { name: "编码" }), "ACME");
  await user.type(screen.getByRole("textbox", { name: "名称" }), "示例公司");
  await user.click(screen.getByRole("button", { name: /保\s*存/ }));

  expect(await screen.findByText("示例公司")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/organization/company",
    expect.objectContaining({ method: "POST" }),
  );
});

test("组织页面显示后端业务错误", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (
        String(input).endsWith("/organization/company") &&
        init?.method === "POST"
      ) {
        return Response.json({ detail: "公司编码已存在" }, { status: 409 });
      }
      if (String(input).endsWith("/organization/company"))
        return Response.json(null);
      return Response.json([]);
    }),
  );
  const user = userEvent.setup();
  renderPage();

  await user.type(await screen.findByRole("textbox", { name: "编码" }), "ACME");
  await user.type(screen.getByRole("textbox", { name: "名称" }), "重复公司");
  await user.click(screen.getByRole("button", { name: /保\s*存/ }));

  expect(await screen.findByText("公司编码已存在")).toBeInTheDocument();
});
