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

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});
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
  payrollWorkbench: (period?: string) =>
    request<PayrollWorkbench>(
      `/payroll/workbench${period ? `?period=${encodeURIComponent(period)}` : ""}`,
    ),
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
