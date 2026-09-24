import { App as AntdApp } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { ImportsPage } from "./index.tsx";

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
        <ImportsPage />
      </QueryClientProvider>
    </AntdApp>,
  );
}

test("员工导入页面显示固定模板说明并限制 xlsx 文件", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/organization/company")) {
        return Response.json({ id: 1, code: "ACME", name: "测试公司" });
      }
      return Response.json([]);
    }),
  );
  renderPage();

  expect(
    await screen.findByText("员工资料模板 TPL-EMP-v2.4"),
  ).toBeInTheDocument();
  expect(document.querySelector('input[type="file"]')).toHaveAttribute(
    "accept",
    ".xlsx",
  );
});

test("员工导入页面展示部分成功行并打开逐行修正入口", async () => {
  const batch = {
    id: 7,
    company_id: 1,
    import_type: "employee_master",
    original_filename: "employees.xlsx",
    file_sha256: "a".repeat(64),
    template_version: "TPL-EMP-v1",
    field_mapping: {},
    status: "partially_imported",
    total_rows: 2,
    success_rows: 1,
    error_rows: 1,
    rows: [
      {
        id: 1,
        sheet_name: "员工资料",
        source_row_number: 3,
        validation_status: "imported",
        raw_data: { 身份证号: "11010119900101123X", 姓名: "张三" },
        correction_values: null,
        normalized_data: {},
        errors: null,
        correction_history: [],
      },
      {
        id: 2,
        sheet_name: "员工资料",
        source_row_number: 4,
        validation_status: "invalid",
        raw_data: { 身份证号: "123" },
        correction_values: null,
        normalized_data: null,
        errors: [
          {
            code: "INVALID_ID",
            field: "身份证号",
            column: "A",
            message: "身份证号须为 18 位文本",
          },
        ],
        correction_history: [],
      },
    ],
  };
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/organization/company"))
        return Response.json({ id: 1, code: "ACME", name: "测试公司" });
      if (path.endsWith("/imports?company_id=1")) return Response.json([]);
      if (
        path.endsWith("/imports/employee-master?company_id=1") &&
        init?.method === "POST"
      )
        return Response.json(batch);
      return Response.json(batch);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  renderPage();
  await user.upload(
    document.querySelector('input[type="file"]')!,
    new File(["xlsx"], "employees.xlsx"),
  );

  expect(
    await screen.findByText("正确行已先入库，错误行保留待修"),
  ).toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: /查看导入批次详情与纠错/ }),
  );
  expect(
    (await screen.findAllByText("身份证号须为 18 位文本")).length,
  ).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: "修正" })).toBeInTheDocument();
});

test("考勤导入选择真实工资批次并修正错误行", async () => {
  const batch = {
    id: 12,
    company_id: 1,
    payroll_period_id: 3,
    payroll_batch_id: 9,
    import_type: "attendance",
    original_filename: "attendance.xlsx",
    file_sha256: "b".repeat(64),
    template_version: "TPL-ATT-v1",
    field_mapping: {},
    status: "partially_imported",
    total_rows: 2,
    success_rows: 1,
    error_rows: 1,
    rows: [
      {
        id: 1,
        sheet_name: "月度考勤",
        source_row_number: 3,
        validation_status: "imported",
        raw_data: { 身份证号: "11010119900101123X", 姓名: "张三" },
        correction_values: null,
        normalized_data: {},
        errors: null,
        correction_history: [],
      },
      {
        id: 2,
        sheet_name: "月度考勤",
        source_row_number: 4,
        validation_status: "invalid",
        raw_data: {
          身份证号: "11010119900101124X",
          姓名: "李四",
          应出勤天数: "0",
        },
        correction_values: null,
        normalized_data: null,
        errors: [
          {
            code: "WORK_DAYS_OUT_OF_RANGE",
            field: "应出勤天数",
            column: "C",
            message: "须大于 0 且不超过当月自然日天数",
          },
        ],
        correction_history: [],
      },
    ],
  };
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/organization/company"))
        return Response.json({ id: 1, name: "测试公司" });
      if (path.endsWith("/payroll/workbench"))
        return Response.json({
          period: { id: 3, period: "2027-02" },
          periods: [{ id: 3, period: "2027-02" }],
          batches: [
            {
              id: 9,
              batch_type: "normal",
              status: "draft",
              subject: { name: "上海主体" },
            },
          ],
        });
      if (path.endsWith("/imports/attendance?company_id=1"))
        return Response.json([]);
      if (
        path.endsWith("/imports/attendance?payroll_batch_id=9") &&
        init?.method === "POST"
      )
        return Response.json(batch);
      if (path.endsWith("/imports/attendance/12/rows/2/correct")) {
        return Response.json({
          ...batch,
          status: "imported",
          success_rows: 2,
          error_rows: 0,
          rows: batch.rows.map((row) =>
            row.id === 2
              ? { ...row, validation_status: "imported", errors: null }
              : row,
          ),
        });
      }
      return Response.json(batch);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  renderPage();
  await user.click(screen.getByRole("button", { name: "月度考勤" }));
  expect(await screen.findByText("固定模板 TPL-ATT-v1")).toBeInTheDocument();
  expect(await screen.findByText("上海主体 · 批次 #9")).toBeInTheDocument();
  await user.upload(
    document.querySelector('input[type="file"]')!,
    new File(["xlsx"], "attendance.xlsx"),
  );
  expect(
    await screen.findByText("正确行已保存，错误行未进入有效考勤"),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "修正" }));
  await user.clear(screen.getByRole("textbox", { name: "修正应出勤天数" }));
  await user.type(
    screen.getByRole("textbox", { name: "修正应出勤天数" }),
    "20",
  );
  await user.click(screen.getByRole("button", { name: "保存并重新校验" }));
  expect(await screen.findByText("全部行已保存")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining("/imports/attendance/12/rows/2/correct"),
    expect.objectContaining({ method: "POST" }),
  );
});

test("考勤导入在未建立工资批次时禁用上传并提示范围", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith("/organization/company"))
        return Response.json({ id: 1, name: "测试公司" });
      if (path.endsWith("/payroll/workbench"))
        return Response.json({ period: null, periods: [], batches: [] });
      return Response.json([]);
    }),
  );
  const user = userEvent.setup();
  renderPage();
  await user.click(screen.getByRole("button", { name: "月度考勤" }));
  expect(
    await screen.findByText("请先在工资核算中建立本期间的正常工资批次"),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: /把 Excel 拖到这里/ }),
  ).toBeDisabled();
  expect(screen.getByText("暂无月度考勤导入记录")).toBeInTheDocument();
});
