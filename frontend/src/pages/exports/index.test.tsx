import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { ExportsPage } from "./index";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function setup(canExport = true, fail = false, completed = false) {
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (fail) return Response.json({ detail: "连接失败" }, { status: 500 });
      if (url.includes("workbench"))
        return Response.json({
          period: { id: 1, period: "2026-09" },
          periods: [{ id: 1, period: "2026-09" }],
        });
      if (url.includes("organization"))
        return Response.json([{ id: 2, name: "测试主体" }]);
      if (url.includes("preview"))
        return Response.json({
          period: "2026-09",
          employee_count: 1,
          record_count: 1,
          untaxed_amount: "900.00",
          template_version: "v1",
          can_export: canExport,
          blockers: canExport ? [] : ["批次尚未锁定"],
          skipped_subjects: [],
          subjects: [{ id: 2, name: "测试主体" }],
          template_sheets: ["导入模版（武汉）"],
        });
      if (url.endsWith("/file"))
        return Response.json({ detail: "有效版本已变化" }, { status: 409 });
      if (init?.method === "POST")
        return Response.json({
          id: 8,
          period_id: 1,
          status: completed ? "completed" : "failed",
          template_version: "v1",
          parameters: {
            period: "2026-09",
            employee_count: 1,
            untaxed_amount: "900.00",
            versions: [],
          },
          warnings: [
            {
              code: "GENERATION_FAILED",
              severity: "error",
              message: "文件生成失败",
            },
          ],
        });
      return Response.json([]);
    },
  );
  vi.stubGlobal("fetch", fetcher);
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <ExportsPage />
    </QueryClientProvider>,
  );
  return fetcher;
}
test("未锁定范围禁用生成并展示原因", async () => {
  setup(false);
  expect(await screen.findByText("批次尚未锁定")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "生成导出文件" })).toBeDisabled();
});
test("生成失败保留报告且不能下载为成功文件", async () => {
  const fetcher = setup();
  await screen.findByText("所选范围已通过导出门槛");
  await userEvent.click(screen.getByRole("button", { name: "生成导出文件" }));
  expect(await screen.findByText("文件生成失败")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "下载工资表" })).toBeDisabled();
  expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(
    true,
  );
});
test("接口错误反馈且禁止生成", async () => {
  setup(true, true);
  expect(await screen.findByText("导出数据加载失败")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "生成导出文件" })).toBeDisabled();
});

test("报告抽屉内下载过期文件显示错误", async () => {
  setup(true, false, true);
  await screen.findByText("所选范围已通过导出门槛");
  await userEvent.click(screen.getByRole("button", { name: "生成导出文件" }));
  const drawer = await screen.findByRole("dialog");
  await userEvent.click(
    within(drawer).getByRole("button", { name: "下载工资表" }),
  );
  expect(await within(drawer).findByText("有效版本已变化")).toBeInTheDocument();
});

test("代发模板切换后须先选择主体模板，生成请求保留映射", async () => {
  const fetcher = setup();
  await screen.findByText("所选范围已通过导出门槛");
  await userEvent.click(screen.getByRole("button", { name: "代发工资表" }));
  const mapping = await screen.findByRole("combobox", {
    name: "测试主体的代发模板",
  });
  expect(screen.getByRole("button", { name: "生成导出文件" })).toBeDisabled();
  await userEvent.click(mapping);
  await userEvent.click(
    (await screen.findAllByText("导入模版（武汉）")).at(-1)!,
  );
  await userEvent.click(screen.getByRole("button", { name: "生成导出文件" }));
  expect(await screen.findByText("文件生成失败")).toBeInTheDocument();
  const call = fetcher.mock.calls.find(
    ([url, init]) =>
      String(url).endsWith("/exports/bank") && init?.method === "POST",
  );
  expect(JSON.parse(String(call?.[1]?.body)).subject_templates).toEqual({
    "2": "导入模版（武汉）",
  });
  expect(screen.getByRole("button", { name: "下载代发工资表" })).toBeDisabled();
});
