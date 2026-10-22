import type { components } from "./schema.d.ts";

const base = import.meta.env.VITE_API_BASE_URL ?? "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      typeof body.detail === "string"
        ? body.detail
        : "请求参数或筛选条件无效，请检查后重试",
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export type Company = components["schemas"]["CompanyOut"];
export type City = components["schemas"]["CityOut"];
export type SocialSecurityItemRule =
  components["schemas"]["SocialSecurityItemRuleOut"];
export type CityRule = components["schemas"]["CityRuleOut"];
export type AttendanceRule = components["schemas"]["AttendanceRuleOut"];
export type Subject = components["schemas"]["SubjectOut"];
export type Department = components["schemas"]["DepartmentOut"];
export type SubjectDepartment = components["schemas"]["SubjectDepartmentOut"];
export type DepartmentList = components["schemas"]["DepartmentListOut"];
export type SubjectDepartmentList =
  components["schemas"]["SubjectDepartmentListOut"];
export type Page<T> = Omit<components["schemas"]["Page_CityOut_"], "items"> & {
  items: T[];
};
export type PageParams = Pick<Page<unknown>, "page_no" | "page_size">;
export type Employee = components["schemas"]["EmployeeOut"];

export type ImportRow = components["schemas"]["ImportRowOut"];

export type EmployeeImportBatch = components["schemas"]["ImportBatchOut"];

export type AttendanceImportBatch =
  components["schemas"]["MonthlyImportBatchOut"];
export type PerformanceImportBatch = AttendanceImportBatch;
export type WorkbookImport = components["schemas"]["WorkbookImportOut"];

export type PayrollPeriod = components["schemas"]["PayrollPeriodOut"];
export type PayrollPreparationItem =
  components["schemas"]["PayrollPreparationItemOut"];
export type PayrollBatch = components["schemas"]["PayrollBatchOut"];
export type PayrollSupplementInput =
  components["schemas"]["PayrollSupplementInput-Output"];
export type PayrollWorkbench = components["schemas"]["PayrollWorkbenchOut"];
export type PayrollTrialRow = components["schemas"]["PayrollTrialRowOut"];
export type PayrollTrial = components["schemas"]["PayrollTrialOut"];
export type PayrollConfirmation =
  components["schemas"]["PayrollConfirmationOut"];
export type PayrollCorrection = components["schemas"]["PayrollCorrectionOut"];
export type PayrollCorrectionInput =
  components["schemas"]["PayrollCorrectionInputOut"];
export type PayrollLedger = components["schemas"]["PayrollLedgerOut"];
export type AttendanceIncentiveRun =
  components["schemas"]["AttendanceIncentiveRunOut"];
export type AttendanceIncentive =
  components["schemas"]["AttendanceIncentiveOut"];

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});
const pageQuery = (page: PageParams) =>
  new URLSearchParams({
    page_no: String(page.page_no),
    page_size: String(page.page_size),
  }).toString();
const upload = async <T>(path: string, form: FormData): Promise<T> => {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      typeof body.detail === "string"
        ? body.detail
        : "请求参数或筛选条件无效，请检查后重试",
    );
  }
  return response.json();
};
export const resources = {
  company: () => request<Company | null>("/organization/company"),
  createCompany: (v: unknown) =>
    request<Company>("/organization/company", json("POST", v)),
  updateCompany: (v: unknown) =>
    request<Company>("/organization/company", json("PATCH", v)),
  cities: () => request<City[]>("/organization/cities/options"),
  cityPage: (page: PageParams) =>
    request<Page<City>>(`/organization/cities?${pageQuery(page)}`),
  cityRules: () => request<CityRule[]>("/rules/city-rules"),
  createCityRule: (v: unknown) =>
    request<CityRule>("/rules/city-rules", json("POST", v)),
  attendanceRules: () => request<AttendanceRule[]>("/rules/attendance"),
  createAttendanceRule: (v: unknown) =>
    request<AttendanceRule>("/rules/attendance", json("POST", v)),
  createCity: (v: unknown) =>
    request<City>("/organization/cities", json("POST", v)),
  updateCity: (id: number, v: unknown) =>
    request<City>(`/organization/cities/${id}`, json("PATCH", v)),
  deleteCity: (id: number) =>
    request<void>(`/organization/cities/${id}`, json("DELETE")),
  subjects: () => request<Subject[]>("/organization/subjects/options"),
  subjectPage: (page: PageParams) =>
    request<Page<Subject>>(`/organization/subjects?${pageQuery(page)}`),
  createSubject: (v: unknown) =>
    request<Subject>("/organization/subjects", json("POST", v)),
  updateSubject: (id: number, v: unknown) =>
    request<Subject>(`/organization/subjects/${id}`, json("PATCH", v)),
  deleteSubject: (id: number) =>
    request<void>(`/organization/subjects/${id}`, json("DELETE")),
  departments: () => request<Department[]>("/organization/departments/options"),
  departmentPage: (page: PageParams) =>
    request<Page<DepartmentList>>(
      `/organization/departments?${pageQuery(page)}`,
    ),
  createDepartment: (v: unknown) =>
    request<Department>("/organization/departments", json("POST", v)),
  updateDepartment: (id: number, v: unknown) =>
    request<Department>(`/organization/departments/${id}`, json("PATCH", v)),
  deleteDepartment: (id: number) =>
    request<void>(`/organization/departments/${id}`, json("DELETE")),
  subjectDepartments: () =>
    request<SubjectDepartment[]>("/organization/subject-departments/options"),
  subjectDepartmentPage: (page: PageParams) =>
    request<Page<SubjectDepartmentList>>(
      `/organization/subject-departments?${pageQuery(page)}`,
    ),
  createSubjectDepartment: (v: unknown) =>
    request<SubjectDepartment>(
      "/organization/subject-departments",
      json("POST", v),
    ),
  updateSubjectDepartment: (id: number, v: unknown) =>
    request<SubjectDepartment>(
      `/organization/subject-departments/${id}`,
      json("PATCH", v),
    ),
  deleteSubjectDepartment: (id: number) =>
    request<void>(`/organization/subject-departments/${id}`, json("DELETE")),
  employees: () => request<Employee[]>("/employees"),
  createEmployee: (v: unknown) =>
    request<Employee>("/employees", json("POST", v)),
  updateEmployee: (id: number, v: unknown) =>
    request<Employee>(`/employees/${id}`, json("PATCH", v)),
  employeeImports: (companyId: number) =>
    request<EmployeeImportBatch[]>(`/imports?company_id=${companyId}`),
  uploadEmployeeImport: (companyId: number, file: File) => {
    const form = new FormData();
    form.set("file", file);
    return upload<EmployeeImportBatch>(
      `/imports/employee-master?company_id=${companyId}`,
      form,
    );
  },
  employeeImport: (id: number) =>
    request<EmployeeImportBatch>(`/imports/${id}`),
  workbookImports: (companyId: number) =>
    request<WorkbookImport[]>(`/imports/workbook?company_id=${companyId}`),
  workbookImport: (id: number) =>
    request<WorkbookImport>(`/imports/workbook/${id}`),
  uploadWorkbookImport: (companyId: number, periodId: number, file: File) => {
    const form = new FormData();
    form.set("file", file);
    return upload<WorkbookImport>(
      `/imports/workbook?company_id=${companyId}&payroll_period_id=${periodId}`,
      form,
    );
  },
  correctWorkbookRow: (
    id: number,
    rowId: number,
    values: Record<string, string>,
    expectedRevision: number,
  ) =>
    request<WorkbookImport>(
      `/imports/workbook/${id}/rows/${rowId}/correct`,
      json("POST", { values, expected_revision: expectedRevision }),
    ),
  attendanceImports: (companyId: number) =>
    request<AttendanceImportBatch[]>(
      `/imports/attendance?company_id=${companyId}`,
    ),
  attendanceImport: (id: number) =>
    request<AttendanceImportBatch>(`/imports/attendance/${id}`),
  uploadAttendanceImport: (companyId: number, periodId: number, file: File) => {
    const form = new FormData();
    form.set("file", file);
    return upload<AttendanceImportBatch>(
      `/imports/attendance?company_id=${companyId}&payroll_period_id=${periodId}`,
      form,
    );
  },
  correctAttendanceRow: (
    batchId: number,
    rowId: number,
    values: Record<string, string>,
  ) =>
    request<AttendanceImportBatch>(
      `/imports/attendance/${batchId}/rows/${rowId}/correct`,
      json("POST", { values }),
    ),
  performanceImports: (companyId: number) =>
    request<PerformanceImportBatch[]>(
      `/imports/performance?company_id=${companyId}`,
    ),
  performanceImport: (id: number) =>
    request<PerformanceImportBatch>(`/imports/performance/${id}`),
  uploadPerformanceImport: (
    companyId: number,
    periodId: number,
    file: File,
  ) => {
    const form = new FormData();
    form.set("file", file);
    return upload<PerformanceImportBatch>(
      `/imports/performance?company_id=${companyId}&payroll_period_id=${periodId}`,
      form,
    );
  },
  correctPerformanceRow: (
    batchId: number,
    rowId: number,
    values: Record<string, string>,
  ) =>
    request<PerformanceImportBatch>(
      `/imports/performance/${batchId}/rows/${rowId}/correct`,
      json("POST", { values }),
    ),
  correctEmployeeImportRow: (
    batchId: number,
    rowId: number,
    values: Record<string, string>,
    action: "retry" | "update_existing" | "ignore" = "retry",
  ) =>
    request<EmployeeImportBatch>(
      `/imports/${batchId}/rows/${rowId}/correct`,
      json("POST", { values, action }),
    ),
  payrollWorkbench: (period?: string) =>
    request<PayrollWorkbench>(
      `/payroll/workbench${period ? `?period=${encodeURIComponent(period)}` : ""}`,
    ),
  payrollLedgerDetail: (recordId: number) =>
    request<components["schemas"]["PayrollLedgerDetailOut"]>(
      `/payroll/ledger/records/${recordId}`,
    ),
  payrollBatch: (batchId: number) =>
    request<PayrollBatch>(`/payroll/batches/${batchId}`),
  payrollTrial: (batchId: number) =>
    request<PayrollTrial | null>(`/payroll/batches/${batchId}/trial`),
  runPayrollTrial: (batchId: number) =>
    request<PayrollTrial>(`/payroll/batches/${batchId}/trial`, json("POST")),
  payrollSupplementInputs: (batchId: number) =>
    request<PayrollSupplementInput[]>(
      `/payroll/batches/${batchId}/supplement-inputs`,
    ),
  savePayrollSupplementInputs: (
    batchId: number,
    rows: PayrollSupplementInput[],
  ) =>
    request<PayrollSupplementInput[]>(
      `/payroll/batches/${batchId}/supplement-inputs`,
      json("PUT", rows),
    ),
  confirmPayrollBatch: (batchId: number) =>
    request<
      PayrollConfirmation | components["schemas"]["PayrollSupplementStatusOut"]
    >(`/payroll/batches/${batchId}/confirm`, json("POST")),
  lockPayrollBatch: (batchId: number) =>
    request<
      PayrollConfirmation | components["schemas"]["PayrollSupplementStatusOut"]
    >(`/payroll/batches/${batchId}/lock`, json("POST")),
  attendanceIncentive: (periodId: number) =>
    request<AttendanceIncentive>(
      `/payroll/periods/${periodId}/attendance-incentive`,
    ),
  calculateAttendanceIncentive: (periodId: number) =>
    request<AttendanceIncentive>(
      `/payroll/periods/${periodId}/attendance-incentive`,
      json("POST"),
    ),
  payrollConfirmation: (periodId: number) =>
    request<PayrollConfirmation>(`/payroll/periods/${periodId}/confirmation`),
  confirmPayrollPeriod: (periodId: number) =>
    request<PayrollConfirmation>(
      `/payroll/periods/${periodId}/confirmation`,
      json("POST"),
    ),
  lockPayrollPeriod: (periodId: number) =>
    request<PayrollConfirmation>(
      `/payroll/periods/${periodId}/lock`,
      json("POST"),
    ),
  payrollCorrections: (batchId: number) =>
    request<PayrollCorrection[]>(`/payroll/batches/${batchId}/corrections`),
  requestPayrollCorrection: (batchId: number, reason: string) =>
    request<PayrollCorrection>(
      `/payroll/batches/${batchId}/corrections`,
      json("POST", { reason }),
    ),
  cancelPayrollCorrection: (correctionId: number) =>
    request<PayrollCorrection>(
      `/payroll/corrections/${correctionId}/cancel`,
      json("POST"),
    ),
  payrollCorrectionInputs: (correctionId: number) =>
    request<PayrollCorrectionInput[]>(
      `/payroll/corrections/${correctionId}/inputs`,
    ),
  updatePayrollCorrectionInputs: (
    correctionId: number,
    payload: components["schemas"]["PayrollCorrectionInputPatch"],
  ) =>
    request<PayrollCorrectionInput[]>(
      `/payroll/corrections/${correctionId}/inputs`,
      json("PUT", payload),
    ),
  payrollLedger: (
    periodId: number,
    filters?: {
      subject_id?: number;
      department?: string;
      employee_id?: number;
    },
  ) => {
    const query = new URLSearchParams({ period_id: String(periodId) });
    Object.entries(filters ?? {}).forEach(([key, value]) => {
      if (value !== undefined) query.set(key, String(value));
    });
    return request<PayrollLedger>(`/payroll/ledger?${query}`);
  },
  createPayrollPeriod: (v: components["schemas"]["PayrollPeriodCreate"]) =>
    request<PayrollPeriod>("/payroll/periods", json("POST", v)),
  createPayrollBatch: (
    periodId: number,
    v: components["schemas"]["PayrollBatchCreate"],
  ) =>
    request<PayrollBatch>(
      `/payroll/periods/${periodId}/batches`,
      json("POST", v),
    ),
};

export const exportLabels = {
  payroll: "工资表",
  bank: "代发工资表",
  "labor-cost": "人工成本表",
  tax: "申报辅助模板",
};
export type ExportKind = keyof typeof exportLabels;
export type PayrollExportPreview = components["schemas"]["ExportPreviewOut"];
export type PayrollExportReport = components["schemas"]["ExportReport"];
export const payrollExports = {
  preview: (period: number, subject?: number, kind: ExportKind = "payroll") =>
    request<PayrollExportPreview>(
      `/exports/${kind}/preview?period_id=${period}${subject ? `&subject_id=${subject}` : ""}`,
    ),
  history: (period: number, kind: ExportKind = "payroll") =>
    request<PayrollExportReport[]>(`/exports/${kind}?period_id=${period}`),
  create: (
    period_id: number,
    subject_id: number | undefined,
    request_id: string,
    kind: ExportKind = "payroll",
    subject_templates: Record<string, string> = {},
  ) =>
    request<PayrollExportReport>(
      `/exports/${kind}`,
      json("POST", { period_id, subject_id, request_id, subject_templates }),
    ),
  download: async (id?: number, kind: ExportKind = "payroll") => {
    const response = await fetch(
      `${base}/exports/${kind}/${id === undefined ? "template" : `${id}/file`}`,
    );
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(
        typeof body.detail === "string"
          ? body.detail
          : "下载失败，请检查后重试",
      );
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    const encoded = response.headers
      .get("Content-Disposition")
      ?.match(/filename\*=UTF-8''(.+)/)?.[1];
    link.download = encoded
      ? decodeURIComponent(encoded)
      : `${exportLabels[kind]}模板.xlsx`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
