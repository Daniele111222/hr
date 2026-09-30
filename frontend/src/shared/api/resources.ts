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
  is_effective: boolean;
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
export type PayrollSupplementInput = { employee_id: number; amount: string };
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
export type PayrollConfirmation = {
  period_id: number;
  period: string;
  subject_count: number;
  batch_count: number;
  batches: {
    id: number;
    subject_id: number;
    status: PayrollBatch["status"];
    confirmed_trial_id: number | null;
    confirmed_at: string | null;
    locked_at: string | null;
  }[];
  confirmed: boolean;
  locked: boolean;
  can_confirm: boolean;
  can_lock: boolean;
  blockers: string[];
};
export type PayrollCorrection = {
  id: number;
  original_batch_id: number;
  replacement_batch_id: number;
  reason: string;
  input_history: {
    employee_id: number;
    source_note: string;
    created_at: string;
  }[];
  status: "requested" | "applied" | "cancelled";
  created_at: string;
  original_status: PayrollBatch["status"];
  replacement_status: PayrollBatch["status"];
  replacement_is_effective: boolean;
};
export type PayrollCorrectionInput = {
  employee_id: number;
  employee_name: string;
  attendance: {
    expected_work_days: string;
    late_minutes: number;
    early_leave_minutes: number;
    paid_leave_days: string;
    unpaid_leave_days: string;
    missed_punch_count: number;
    corrected_punch_count: number;
  } | null;
  performance_coefficient: string | null;
  source_note: string | null;
};
export type PayrollLedger = {
  period_id: number;
  period: string;
  filters: Record<string, unknown>;
  record_count: number;
  employee_count: number;
  records: {
    id: number;
    payroll_batch_id: number;
    batch_type: "normal" | "supplement";
    batch_no: number;
    batch_name: string | null;
    correction_of_batch_id: number | null;
    payment_date: string | null;
    subject_id: number;
    subject_name: string;
    employee_id: number;
    snapshot: Record<string, unknown>;
    amounts: Record<string, string>;
    items: Record<string, unknown>[];
    steps: Record<string, unknown>[];
    calculation_status: "confirmed" | "locked";
  }[];
  totals: Record<string, string>;
  untaxed_tax_notice: string;
};
export type AttendanceIncentiveRun = {
  id: number;
  company_id: number;
  payroll_period_id: number;
  source_period_id: number;
  status: "calculated" | "empty" | "stale";
  input_fingerprint: string;
  pool_amount: string;
  allocated_amount: string;
  average_amount: string;
  remainder_amount: string;
  source_snapshot: Record<string, unknown>[];
  candidate_snapshot: Record<string, unknown>[];
  allocations: Record<string, unknown>[];
  message: string | null;
  created_at: string;
  stale: boolean;
  ready: boolean;
};
export type AttendanceIncentive = {
  period_id: number;
  period: string;
  source_period: string | null;
  company_id: number;
  status: "blocked" | "ready" | "calculated" | "empty" | "stale";
  can_calculate: boolean;
  message: string | null;
  source_rows: Record<string, unknown>[];
  current_rows: Record<string, unknown>[];
  pool_amount: string;
  candidate_snapshot: Record<string, unknown>[];
  run: AttendanceIncentiveRun | null;
  input_fingerprint: string;
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
    request<{ id: number; status: PayrollBatch["status"] }>(
      `/payroll/batches/${batchId}/confirm`,
      json("POST"),
    ),
  lockPayrollBatch: (batchId: number) =>
    request<{ id: number; status: PayrollBatch["status"] }>(
      `/payroll/batches/${batchId}/lock`,
      json("POST"),
    ),
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
    payload: {
      employee_id: number;
      source_note: string;
      attendance?: Record<string, string>;
      performance_coefficient?: string;
    },
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
  createPayrollPeriod: (v: { period: string }) =>
    request<PayrollPeriod>("/payroll/periods", json("POST", v)),
  createPayrollBatch: (
    periodId: number,
    v: {
      subject_id: number;
      batch_type?: "normal" | "supplement";
      name?: string;
      payment_date?: string;
    },
  ) =>
    request<PayrollBatch>(
      `/payroll/periods/${periodId}/batches`,
      json("POST", v),
    ),
};

export type ExportKind = "payroll" | "bank";
export type PayrollExportPreview = {
  subjects: { id: number; name: string }[];
  template_sheets: string[];
  period: string;
  employee_count: number;
  record_count: number;
  untaxed_amount: string;
  template_version: string;
  can_export: boolean;
  blockers: string[];
  skipped_subjects: string[];
};
export type PayrollExportReport = {
  id: number;
  period_id: number;
  status: "started" | "completed" | "failed";
  template_version: string;
  created_at: string;
  completed_at: string | null;
  parameters: {
    period: string;
    subject_id: number | null;
    employee_count: number;
    record_count: number;
    untaxed_amount: string;
    versions: {
      batch_id: number;
      trial_id: number;
      batch_no: number;
      batch_type: string;
    }[];
  };
  warnings: {
    code: string;
    severity: string;
    message: string;
    employee_id: number | null;
    field_name: string | null;
  }[];
};
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
      throw new Error(body.detail ?? "下载失败");
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    const encoded = response.headers
      .get("Content-Disposition")
      ?.match(/filename\*=UTF-8''(.+)/)?.[1];
    link.download = encoded
      ? decodeURIComponent(encoded)
      : `${kind === "bank" ? "代发工资表" : "工资表"}模板.xlsx`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
