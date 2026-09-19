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
export type Subject = { id: number; company_id: number; code: string; name: string };
export type Department = { id: number; company_id: number; code: string; name: string; parent_id: number | null };
export type SubjectDepartment = { id: number; company_id: number; subject_id: number; department_id: number; code: string; name: string };
export type Employee = { id: number; company_id: number; id_number: string; employee_no: string; name: string; employee_type: string; formal_status: boolean; probation_status: string; probation_date: string | null; hire_date: string; termination_date: string | null; active: boolean; salary: { fixed_salary: string; performance_base: string; effective_from: string } | null; assignment: { subject_id: number; subject_department_id: number; position_title: string } | null; base: { city_id: number } | null; bank_account: { account_number: string } | null };

const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });
export const resources = {
  company: () => request<Company | null>("/organization/company"),
  createCompany: (v: unknown) => request<Company>("/organization/company", json("POST", v)),
  updateCompany: (v: unknown) => request<Company>("/organization/company", json("PATCH", v)),
  cities: () => request<City[]>("/organization/cities"),
  createCity: (v: unknown) => request<City>("/organization/cities", json("POST", v)),
  updateCity: (id: number, v: unknown) => request<City>(`/organization/cities/${id}`, json("PATCH", v)),
  deleteCity: (id: number) => request<void>(`/organization/cities/${id}`, json("DELETE")),
  subjects: () => request<Subject[]>("/organization/subjects"),
  createSubject: (v: unknown) => request<Subject>("/organization/subjects", json("POST", v)),
  updateSubject: (id: number, v: unknown) => request<Subject>(`/organization/subjects/${id}`, json("PATCH", v)),
  deleteSubject: (id: number) => request<void>(`/organization/subjects/${id}`, json("DELETE")),
  departments: () => request<Department[]>("/organization/departments"),
  createDepartment: (v: unknown) => request<Department>("/organization/departments", json("POST", v)),
  updateDepartment: (id: number, v: unknown) => request<Department>(`/organization/departments/${id}`, json("PATCH", v)),
  deleteDepartment: (id: number) => request<void>(`/organization/departments/${id}`, json("DELETE")),
  subjectDepartments: () => request<SubjectDepartment[]>("/organization/subject-departments"),
  createSubjectDepartment: (v: unknown) => request<SubjectDepartment>("/organization/subject-departments", json("POST", v)),
  updateSubjectDepartment: (id: number, v: unknown) => request<SubjectDepartment>(`/organization/subject-departments/${id}`, json("PATCH", v)),
  deleteSubjectDepartment: (id: number) => request<void>(`/organization/subject-departments/${id}`, json("DELETE")),
  employees: () => request<Employee[]>("/employees"),
  createEmployee: (v: unknown) => request<Employee>("/employees", json("POST", v)),
  updateEmployee: (id: number, v: unknown) => request<Employee>(`/employees/${id}`, json("PATCH", v)),
};
