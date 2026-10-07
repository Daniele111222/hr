import { lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./AppLayout.tsx";

const OverviewPage = lazy(() =>
  import("../pages/overview/index.tsx").then((module) => ({
    default: module.OverviewPage,
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
const PayrollLedgerPage = lazy(() =>
  import("../pages/payroll/ledger.tsx").then((module) => ({
    default: module.PayrollLedgerPage,
  })),
);

const ExportsPage = lazy(() =>
  import("../pages/exports/index.tsx").then((module) => ({
    default: module.ExportsPage,
  })),
);

const PayrollLedgerDetailPage = lazy(() =>
  import("../pages/payroll/ledger-detail.tsx").then((module) => ({
    default: module.PayrollLedgerDetailPage,
  })),
);

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<OverviewPage />} />
          <Route path="organization" element={<OrganizationPage />} />
          <Route path="employees" element={<EmployeesPage />} />
          <Route path="imports" element={<ImportsPage />} />
          <Route path="exports" element={<ExportsPage />} />
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
          <Route path="payroll/ledger" element={<PayrollLedgerPage />} />
          <Route
            path="payroll/ledger/records/:recordId"
            element={<PayrollLedgerDetailPage />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
