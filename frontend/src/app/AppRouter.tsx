import { lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./AppLayout.tsx";

const OverviewPage = lazy(() =>
  import("../pages/overview/index.tsx").then((module) => ({
    default: module.OverviewPage,
  })),
);

const FeaturePlaceholderPage = lazy(() =>
  import("../pages/feature-placeholder/index.tsx").then((module) => ({
    default: module.FeaturePlaceholderPage,
  })),
);

const OrganizationPage = lazy(() =>
  import("../pages/organization/index.tsx").then((module) => ({
    default: module.OrganizationPage,
  })),
);
const EmployeesPage = lazy(() =>
  import("../pages/employees/index.tsx").then((module) => ({
    default: module.EmployeesPage,
  })),
);
const ImportsPage = lazy(() =>
  import("../pages/imports/index.tsx").then((module) => ({
    default: module.ImportsPage,
  })),
);
const RulesPage = lazy(() =>
  import("../pages/rules/index.tsx").then((module) => ({
    default: module.RulesPage,
  })),
);

const PayrollPage = lazy(() =>
  import("../pages/payroll/index.tsx").then((module) => ({
    default: module.PayrollPage,
  })),
);
const PayrollBatchDetailPage = lazy(() =>
  import("../pages/payroll/batch-detail.tsx").then((module) => ({
    default: module.PayrollBatchDetailPage,
  })),
);
const AttendanceIncentivePage = lazy(() =>
  import("../pages/payroll/incentive.tsx").then((module) => ({
    default: module.AttendanceIncentivePage,
  })),
);

const placeholders = [
  {
    path: "employees",
    title: "员工管理",
    description: "维护员工主档、任职信息和薪酬标准。",
  },
  {
    path: "imports",
    title: "数据导入",
    description: "导入并校验考勤、绩效及员工数据。",
  },
  {
    path: "payroll",
    title: "工资核算",
    description: "按期间执行试算、确认、锁定和更正。",
  },
  {
    path: "exports",
    title: "结果导出",
    description: "生成工资表、代发文件和人工成本表。",
  },
] as const;

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<OverviewPage />} />
          <Route path="organization" element={<OrganizationPage />} />
          <Route path="employees" element={<EmployeesPage />} />
          <Route path="imports" element={<ImportsPage />} />
          <Route path="rules" element={<RulesPage />} />
          <Route path="payroll" element={<PayrollPage />} />
          <Route
            path="payroll/batches/:batchId"
            element={<PayrollBatchDetailPage />}
          />
          <Route
            path="payroll/incentive"
            element={<AttendanceIncentivePage />}
          />
          {placeholders
            .filter(
              (item) => item.path !== "employees" && item.path !== "payroll",
            )
            .map((item) => (
              <Route
                key={item.path}
                path={item.path}
                element={
                  <FeaturePlaceholderPage
                    title={item.title}
                    description={item.description}
                  />
                }
              />
            ))}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
