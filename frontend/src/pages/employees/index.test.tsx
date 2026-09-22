import { App as AntdApp } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { EmployeesPage } from "./index.tsx";

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
        <EmployeesPage />
      </QueryClientProvider>
    </AntdApp>,
  );
}

const employee = {
  id: 1,
  company_id: 1,
  id_number: "11010119900101123X",
  employee_no: "E001",
  name: "测试员工",
  employee_type: "employee",
  formal_status: true,
  probation_status: "confirmed",
  probation_date: "2026-07-01",
  hire_date: "2026-01-01",
  termination_date: null,
  active: true,
  salary: {
    fixed_salary: "8000.00",
    performance_base: "2000.00",
    effective_from: "2026-01-01",
  },
  assignment: {
    subject_id: 1,
    subject_department_id: 1,
    position_title: "工程师",
  },
  base: { city_id: 1 },
  bank_account: { account_number: "6222000000000001" },
};

test("员工页面查询并修改员工资料", async () => {
  let current = employee;
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/employees/1") && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        current = { ...current, name: body.name };
        return Response.json(current);
      }
      if (path.endsWith("/employees")) return Response.json([current]);
      if (path.endsWith("/organization/company")) {
        return Response.json({ id: 1, code: "ACME", name: "示例公司" });
      }
      return Response.json([]);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  renderPage();

  expect(await screen.findByText("测试员工")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "编辑" }));
  const name = screen.getByRole("textbox", { name: "姓名" });
  await user.clear(name);
  await user.type(name, "更新员工");
  await user.click(screen.getByRole("button", { name: /保\s*存/ }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/employees/1",
      expect.objectContaining({ method: "PATCH" }),
    ),
  );
  expect(await screen.findByText("更新员工")).toBeInTheDocument();
});

test("员工页面显示查询错误", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/employees")) {
        return Response.json({ detail: "员工查询失败" }, { status: 500 });
      }
      if (String(input).endsWith("/organization/company"))
        return Response.json(null);
      return Response.json([]);
    }),
  );
  renderPage();

  expect(await screen.findByText("员工查询失败")).toBeInTheDocument();
});

test("员工页面可以按关键词筛选当前名单", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith("/employees")) {
        return Response.json([
          employee,
          { ...employee, id: 2, employee_no: "E002", name: "另一员工" },
        ]);
      }
      if (path.endsWith("/organization/company")) {
        return Response.json({ id: 1, code: "ACME", name: "示例公司" });
      }
      return Response.json([]);
    }),
  );
  const user = userEvent.setup();
  renderPage();

  expect(await screen.findByText("测试员工")).toBeInTheDocument();
  await user.type(
    screen.getByRole("textbox", { name: "姓名、编号或身份证号" }),
    "E002",
  );

  expect(screen.queryByText("测试员工")).not.toBeInTheDocument();
  expect(screen.getByText("另一员工")).toBeInTheDocument();
});

test("员工页面转正时提交保持不变的固定薪资和新绩效基数", async () => {
  const probationEmployee = {
    ...employee,
    formal_status: false,
    probation_status: "in_probation",
    probation_date: null,
    salary: { ...employee.salary, performance_base: "0.00" },
  };
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/employees/1") && init?.method === "PATCH") {
        return Response.json({
          ...probationEmployee,
          probation_status: "confirmed",
        });
      }
      if (path.endsWith("/employees"))
        return Response.json([probationEmployee]);
      if (path.endsWith("/organization/company")) {
        return Response.json({ id: 1, code: "ACME", name: "示例公司" });
      }
      return Response.json([]);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  renderPage();

  await user.click(await screen.findByRole("button", { name: "编辑" }));
  await user.click(screen.getByRole("combobox", { name: "转正状态" }));
  const confirmedOptions = await screen.findAllByText("已转正");
  await user.click(confirmedOptions.at(-1)!);
  await user.type(
    screen.getByRole("textbox", { name: "转正日期" }),
    "2026-07-01",
  );
  const performanceBase = screen.getByRole("spinbutton", {
    name: "绩效基数（20%）",
  });
  await user.clear(performanceBase);
  await user.type(performanceBase, "2000");
  await user.click(screen.getByRole("button", { name: /保\s*存/ }));

  await waitFor(() => {
    const patchCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith("/employees/1") && init?.method === "PATCH",
    );
    expect(JSON.parse(String(patchCall?.[1]?.body))).toMatchObject({
      probation_status: "confirmed",
      probation_date: "2026-07-01",
      salary: {
        fixed_salary: "8000.00",
        performance_base: "2000",
        effective_from: "2026-07-01",
      },
    });
  });
});

test("员工页面普通调薪提交整月生效日期", async () => {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/employees/1") && init?.method === "PATCH") {
        return Response.json(employee);
      }
      if (String(input).endsWith("/employees"))
        return Response.json([employee]);
      if (String(input).endsWith("/organization/company")) {
        return Response.json({ id: 1, code: "ACME", name: "示例公司" });
      }
      return Response.json([]);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  renderPage();

  await user.click(await screen.findByRole("button", { name: "编辑" }));
  const fixedSalary = screen.getByRole("spinbutton", {
    name: "固定薪资（80%）",
  });
  await user.clear(fixedSalary);
  await user.type(fixedSalary, "8800");
  const performanceBase = screen.getByRole("spinbutton", {
    name: "绩效基数（20%）",
  });
  await user.clear(performanceBase);
  await user.type(performanceBase, "2200");
  await user.type(
    screen.getByLabelText("调薪生效工资期间（月初）"),
    "2026-08-01",
  );
  await user.click(screen.getByRole("button", { name: /保\s*存/ }));

  await waitFor(() => {
    const patchCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith("/employees/1") && init?.method === "PATCH",
    );
    expect(JSON.parse(String(patchCall?.[1]?.body))).toMatchObject({
      salary: {
        fixed_salary: "8800",
        performance_base: "2200",
        effective_from: "2026-08-01",
      },
    });
  });
});
