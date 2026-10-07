import { App as AntdApp } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { OrganizationPage } from "./index.tsx";
import { MemoryRouter } from "react-router-dom";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderPage(entry = "/organization") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <AntdApp>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[entry]}>
          <OrganizationPage />
        </MemoryRouter>
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
      return Response.json({ items: [], total: 0, page_no: 1, page_size: 10 });
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
      return Response.json({ items: [], total: 0, page_no: 1, page_size: 10 });
    }),
  );
  const user = userEvent.setup();
  renderPage();

  await user.type(await screen.findByRole("textbox", { name: "编码" }), "ACME");
  await user.type(screen.getByRole("textbox", { name: "名称" }), "重复公司");
  await user.click(screen.getByRole("button", { name: /保\s*存/ }));

  expect(await screen.findByText("公司编码已存在")).toBeInTheDocument();
});

test("四个列表独立恢复页码，翻页从接口加载且摘要使用总数", async () => {
  const names: Record<string, string> = {
    cities: "城市",
    subjects: "主体",
    departments: "部门",
    "subject-departments": "关联",
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname.endsWith("/organization/company"))
      return Response.json({ id: 1, code: "PAGE", name: "分页测试公司" });
    const path = url.pathname.split("/").at(-1)!;
    const pageNo = Number(url.searchParams.get("page_no"));
    const pageSize = Number(url.searchParams.get("page_size"));
    const start = (pageNo - 1) * pageSize;
    return Response.json({
      items: Array.from(
        { length: Math.min(pageSize, 23 - start) },
        (_, index) => ({
          id: start + index + 1,
          code: `P${start + index + 1}`,
          name: `${names[path]} ${start + index + 1}`,
          parent_name: null,
          subject_name: "分页主体",
          department_name: "共用研发部门",
        }),
      ),
      total: 23,
      page_no: pageNo,
      page_size: pageSize,
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  renderPage("/organization?department_page=2&city_page_size=20");
  expect(await screen.findByText("部门 11")).toBeInTheDocument();
  expect(screen.queryByText("部门 1")).not.toBeInTheDocument();
  expect(await screen.findByText("城市 20")).toBeInTheDocument();
  expect(screen.getByText(/同名关联引用原部门/)).toBeInTheDocument();
  const card = screen.getByRole("region", { name: "共用部门" });
  expect(within(card).getByText("共 23 条")).toBeInTheDocument();
  const cityRequests = () =>
    fetchMock.mock.calls.filter(([input]) => String(input).includes("/cities?"))
      .length;
  const before = cityRequests();
  await user.click(within(card).getByTitle("3"));
  expect(await within(card).findByText("部门 21")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/organization/departments?page_no=3&page_size=10",
    expect.anything(),
  );
  expect(cityRequests()).toBe(before);
  await user.click(within(card).getByRole("combobox"));
  await user.click(
    screen.getByText("20 / page", {
      selector: ".ant-select-item-option-content",
    }),
  );
  expect(await within(card).findByText("部门 1")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/organization/departments?page_no=1&page_size=20",
    expect.anything(),
  );
  expect(cityRequests()).toBe(before);
  const companyCard = screen.getByText("公司基本信息").closest(".ant-card")!;
  expect(within(companyCard as HTMLElement).getAllByText("23")).toHaveLength(2);
});

test("删除末页唯一记录后回到上一页并重新加载", async () => {
  let total = 11;
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      if (init?.method === "DELETE") {
        total = 10;
        return new Response(null, { status: 204 });
      }
      if (url.pathname.endsWith("/organization/company"))
        return Response.json({ id: 1, code: "PAGE", name: "分页测试公司" });
      const pageNo = Number(url.searchParams.get("page_no"));
      const isDepartment = url.pathname.endsWith("/departments");
      return Response.json({
        items: isDepartment
          ? [
              {
                id: pageNo === 2 ? 11 : 1,
                code: "D",
                name: pageNo === 2 ? "末页部门" : "上一页部门",
                parent_name: null,
              },
            ]
          : [],
        total: isDepartment ? total : 0,
        page_no: pageNo,
        page_size: 10,
      });
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  renderPage("/organization?department_page=2");
  expect(await screen.findByText("末页部门")).toBeInTheDocument();
  const card = screen.getByRole("region", { name: "共用部门" });
  await user.click(within(card).getByRole("button", { name: /删\s*除/ }));
  await user.click(await screen.findByRole("button", { name: "OK" }));
  expect(await screen.findByText("上一页部门")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/organization/departments?page_no=1&page_size=10",
    expect.anything(),
  );
});

test("分页错误明确显示并可重试，非法 URL 分页参数使用默认值", async () => {
  let failed = true;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith("/organization/company"))
      return Response.json({ id: 1, code: "PAGE", name: "分页测试公司" });
    if (path.includes("/departments?") && failed)
      return Response.json({ detail: "部门分页加载失败" }, { status: 500 });
    return Response.json({ items: [], total: 0, page_no: 1, page_size: 10 });
  });
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  renderPage("/organization?department_page=-1&department_page_size=101");
  expect(await screen.findByText("部门分页加载失败")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/organization/departments?page_no=1&page_size=10",
    expect.anything(),
  );
  failed = false;
  await user.click(screen.getByRole("button", { name: /重\s*试/ }));
  await waitFor(() =>
    expect(screen.queryByText("部门分页加载失败")).not.toBeInTheDocument(),
  );
});

test.each([false, true])(
  "新增关联使用完整选项，选项失败时阻止保存（失败=%s）",
  async (failed) => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "http://localhost");
        const path = url.pathname;
        if (path.endsWith("/organization/company"))
          return Response.json({ id: 1, code: "PAGE", name: "分页测试公司" });
        if (path.endsWith("/subjects/options"))
          return Response.json([
            { id: 1, name: "首页主体" },
            { id: 2, name: "跨页主体" },
          ]);
        if (path.endsWith("/departments/options"))
          return failed
            ? Response.json({ detail: "部门选项服务不可用" }, { status: 500 })
            : Response.json([
                { id: 1, name: "首页部门" },
                { id: 2, name: "跨页部门" },
              ]);
        if (init?.method === "POST")
          return Response.json(
            { id: 3, ...JSON.parse(String(init.body)) },
            { status: 201 },
          );
        const pageSize = Number(url.searchParams.get("page_size"));
        return Response.json({
          items: [
            {
              id: 1,
              code: "ONE",
              name: "首页记录",
              parent_name: null,
              subject_name: "首页主体",
              department_name: "首页部门",
            },
          ],
          total: 2,
          page_no: 1,
          page_size: pageSize,
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderPage("/organization?subject_page_size=1&department_page_size=1");
    await screen.findAllByText("首页记录");
    const card = screen.getByRole("region", { name: "主体与部门关联" });
    await user.click(within(card).getByRole("button", { name: /新\s*增/ }));
    if (failed) {
      expect(await screen.findByText("组织选项加载失败")).toBeInTheDocument();
      expect(screen.getByText("部门选项服务不可用")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /保\s*存/ })).toBeDisabled();
      return;
    }
    await user.click(screen.getByRole("combobox", { name: "主体" }));
    await user.click(
      await screen.findByText("跨页主体", {
        selector: ".ant-select-item-option-content",
      }),
    );
    await user.click(screen.getByRole("combobox", { name: "部门" }));
    await user.click(
      await screen.findByText("跨页部门", {
        selector: ".ant-select-item-option-content",
      }),
    );
    await user.type(screen.getByRole("textbox", { name: "编码" }), "LINK");
    await user.type(screen.getByRole("textbox", { name: "名称" }), "关联名称");
    await user.click(screen.getByRole("button", { name: /保\s*存/ }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/organization/subject-departments",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            code: "LINK",
            name: "关联名称",
            subject_id: 2,
            department_id: 2,
            company_id: 1,
          }),
        }),
      ),
    );
  },
);
