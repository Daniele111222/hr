const base = import.meta.env.VITE_API_BASE_URL ?? "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail ?? "请求失败");
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export type Company = { id: number; code: string; name: string };
export type City = { id: number; code: string; name: string };
export type SocialSecurityItemRule = {
  id: number;
  item_code: string;
  item_name: string;
  company_rate: string;
  employee_rate: string;
};
export type CityRule = {
  id: number;
  city_id: number;
  city_name: string;
  effective_from: string;
  effective_to: string | null;
  version: string;
  source: string | null;
  fixed_base: string | null;
  social_items: SocialSecurityItemRule[];
  housing_company_rate: string | null;
  housing_employee_rate: string | null;
  housing_base_source: string | null;
};
export type AttendanceRule = {
  id: number;
  effective_from: string;
  effective_to: string | null;
  standard_hours: string;
  missed_punch_amount: string;
  exempt_level_number: number;
  makeup_punch_exempt: boolean;
  version: string;
  source: string | null;
};
export type Subject = {
  id: number;
  company_id: number;
  code: string;
  name: string;
};
export type Department = {
  id: number;
  company_id: number;
  code: string;
  name: string;
  parent_id: number | null;
};
export type SubjectDepartment = {
  id: number;
  company_id: number;
  subject_id: number;
  department_id: number;
  code: string;
  name: string;
};
export type Employee = {
  id: number;
  company_id: number;
  id_number: string;
  employee_no: string;
  name: string;
  employee_type: string;
  level_code?: string | null;
  level_number?: number | null;
  formal_status: boolean;
  probation_status: string;
  probation_date: string | null;
  hire_date: string;
  termination_date: string | null;
  active: boolean;
  salary: {
    fixed_salary: string;
    performance_base: string;
    effective_from: string;
  } | null;
  assignment: {
    subject_id: number;
    subject_department_id: number;
    position_title: string;
    level_code?: string | null;
    level_number?: number | null;
  } | null;
  base: { city_id: number } | null;
  bank_account: {
    account_number: string;
    bank_name?: string | null;
    branch_name?: string | null;
  } | null;
};

export type ImportRow = {
  id: number;
  sheet_name: string;
  source_row_number: number;
  validation_status: "invalid" | "imported" | "corrected" | "valid";
  raw_data: Record<string, string>;
  correction_values: Record<string, string> | null;
  normalized_data: Record<string, unknown> | null;
  errors:
    { code: string; field: string; column: string; message: string }[] | null;
  correction_history: Record<string, unknown>[];
};

export type EmployeeImportBatch = {
  id: number;
  company_id: number;
  import_type: "employee_master";
  original_filename: string;
  file_sha256: string;
  template_version: string;
  field_mapping: Record<string, number>;
  status: "uploaded" | "partially_imported" | "imported" | "rejected";
  total_rows: number;
  success_rows: number;
  error_rows: number;
  rows: ImportRow[] | null;
};

export type AttendanceImportBatch = Omit<EmployeeImportBatch, "import_type"> & {
  import_type: "attendance";
  payroll_period_id: number;
  payroll_batch_id: number;
  subject_name: string;
};
export type PerformanceImportBatch = Omit<
  AttendanceImportBatch,
  "import_type"
> & {
  import_type: "performance";
};

export type PayrollPeriod = {
  id: number;
  year: number;
  month: number;
  period: string;
  period_start: string;
  period_end: string;
  payment_date: string | null;
  payment_date_confirmed: boolean;
  batch_count: number;
  normal_batch_count: number;
};
export type PayrollPreparationItem = {
  status: "ready" | "partial" | "missing" | "blocked" | "not_required";
  prepared_count: number;
  missing_count: number;
  message: string | null;
};
export type PayrollBatch = {
  id: number;
  period_id: number;
  subject: Subject;
  batch_type: "normal" | "supplement" | "performance_supplement" | "other";
  batch_no: number;
  name: string | null;
  status: "draft" | "trial" | "confirmed" | "locked" | "exported" | "cancelled";
  scope: {
    source: string;
    criteria: Record<string, unknown>;
    employee_count: number;
    employee_ids: number[];
    ambiguous_employee_ids: number[];
    status: "ready" | "blocked" | "empty";
  };
  data_preparation: {
    attendance: PayrollPreparationItem;
    performance: PayrollPreparationItem;
    city_rules: PayrollPreparationItem;
    overall_status: "ready" | "partial" | "blocked";
  };
  payment_date: string | null;
  payment_date_confirmed: boolean;
};
export type PayrollWorkbench = {
  period: PayrollPeriod | null;
  periods: PayrollPeriod[];
  batches: PayrollBatch[];
};
export type PayrollTrialRow = {
  employee_id: number;
  employee_name: string;
  snapshot: {
    employee_no: string;
    department_name: string | null;
    position_title: string | null;
    level_number: number | null;
    last_effective_subject_id: number | null;
  };
  errors: { code: string; message: string }[];
  warnings: string[];
  amounts: Record<string, string> | null;
  items: { code: string; name: string; category: string; amount: string }[];
  steps: {
    code: string;
    formula: string;
    inputs: Record<string, string>;
    amount: string;
  }[];
};
export type PayrollTrial = {
  id: number;
  payroll_batch_id: number;
  input_fingerprint: string;
  created_at: string;
  stale: boolean;
  success_count: number;
  error_count: number;
  total_count: number;
  totals: Record<string, string>;
  results: PayrollTrialRow[];
  includes_final_incentive: boolean;
  ready_for_confirmation: boolean;
  confirmation_blockers: string[];
};

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});
const upload = async <T>(path: string, form: FormData): Promise<T> => {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail ?? "请求失败");
  }
  return response.json();
};
export const resources = {
  company: () => request<Company | null>("/organization/company"),
  createCompany: (v: unknown) =>
    request<Company>("/organization/company", json("POST", v)),
  updateCompany: (v: unknown) =>
    request<Company>("/organization/company", json("PATCH", v)),
  cities: () => request<City[]>("/organization/cities"),
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
  subjects: () => request<Subject[]>("/organization/subjects"),
  createSubject: (v: unknown) =>
    request<Subject>("/organization/subjects", json("POST", v)),
  updateSubject: (id: number, v: unknown) =>
    request<Subject>(`/organization/subjects/${id}`, json("PATCH", v)),
  deleteSubject: (id: number) =>
    request<void>(`/organization/subjects/${id}`, json("DELETE")),
  departments: () => request<Department[]>("/organization/departments"),
  createDepartment: (v: unknown) =>
    request<Department>("/organization/departments", json("POST", v)),
  updateDepartment: (id: number, v: unknown) =>
    request<Department>(`/organization/departments/${id}`, json("PATCH", v)),
  deleteDepartment: (id: number) =>
    request<void>(`/organization/departments/${id}`, json("DELETE")),
  subjectDepartments: () =>
    request<SubjectDepartment[]>("/organization/subject-departments"),
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
  attendanceImports: (companyId: number) =>
    request<AttendanceImportBatch[]>(
      `/imports/attendance?company_id=${companyId}`,
    ),
  attendanceImport: (id: number) =>
    request<AttendanceImportBatch>(`/imports/attendance/${id}`),
  uploadAttendanceImport: (batchId: number, file: File) => {
    const form = new FormData();
    form.set("file", file);
    return upload<AttendanceImportBatch>(
      `/imports/attendance?payroll_batch_id=${batchId}`,
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
  uploadPerformanceImport: (batchId: number, file: File) => {
    const form = new FormData();
    form.set("file", file);
    return upload<PerformanceImportBatch>(
      `/imports/performance?payroll_batch_id=${batchId}`,
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
  payrollBatch: (batchId: number) =>
    request<PayrollBatch>(`/payroll/batches/${batchId}`),
  payrollTrial: (batchId: number) =>
    request<PayrollTrial | null>(`/payroll/batches/${batchId}/trial`),
  runPayrollTrial: (batchId: number) =>
    request<PayrollTrial>(`/payroll/batches/${batchId}/trial`, json("POST")),
  createPayrollPeriod: (v: { period: string }) =>
    request<PayrollPeriod>("/payroll/periods", json("POST", v)),
  createPayrollBatch: (
    periodId: number,
    v: {
      subject_id: number;
      batch_type?: "normal";
      name?: string;
    },
  ) =>
    request<PayrollBatch>(
      `/payroll/periods/${periodId}/batches`,
      json("POST", v),
    ),
};
