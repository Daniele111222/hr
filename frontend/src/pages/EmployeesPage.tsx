import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Drawer, Form, Input, InputNumber, Select, Space, Table, Tag, Typography } from "antd";
import { useState } from "react";
import { resources, type Employee } from "../shared/api/resources";
import styles from "./EmployeesPage.module.css";

export function EmployeesPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [editing, setEditing] = useState<Employee | null>(null);
  const [open, setOpen] = useState(false);
  const employees = useQuery({ queryKey: ["employees"], queryFn: resources.employees });
  const company = useQuery({ queryKey: ["org", "company"], queryFn: resources.company });
  const cities = useQuery({ queryKey: ["org", "cities"], queryFn: resources.cities });
  const subjects = useQuery({ queryKey: ["org", "subjects"], queryFn: resources.subjects });
  const relations = useQuery({ queryKey: ["org", "relations"], queryFn: resources.subjectDepartments });
  const selectedSubject = Form.useWatch("subject_id", form);
  const availableRelations = (relations.data ?? []).filter((row) => row.subject_id === selectedSubject);
  const close = () => { setOpen(false); setEditing(null); form.resetFields(); };
  const refresh = () => { close(); queryClient.invalidateQueries({ queryKey: ["employees"] }); };
  const create = useMutation({ mutationFn: resources.createEmployee, onSuccess: () => { message.success("员工已保存"); refresh(); }, onError: (e) => message.error(e.message) });
  const update = useMutation({ mutationFn: ({ id, data }: { id: number; data: unknown }) => resources.updateEmployee(id, data), onSuccess: () => { message.success("员工已更新"); refresh(); }, onError: (e) => message.error(e.message) });
  const openCreate = () => { setEditing(null); form.resetFields(); form.setFieldsValue({ employee_type: "employee", probation_status: "not_applicable", active: true }); setOpen(true); };
  const openEdit = (row: Employee) => { setEditing(row); form.setFieldsValue({ ...row, fixed_salary: row.salary?.fixed_salary, performance_base: row.salary?.performance_base, subject_id: row.assignment?.subject_id, subject_department_id: row.assignment?.subject_department_id, position_title: row.assignment?.position_title, city_id: row.base?.city_id, account_number: row.bank_account?.account_number }); setOpen(true); };
  const submit = (values: Record<string, unknown>) => {
    if (editing) {
      update.mutate({ id: editing.id, data: { name: values.name, employee_type: values.employee_type, active: values.active, formal_status: values.formal_status, probation_status: values.probation_status, probation_date: values.probation_date, termination_date: values.termination_date } });
      return;
    }
    create.mutate({ company_id: company.data!.id, id_number: values.id_number, employee_no: values.employee_no, name: values.name, employee_type: values.employee_type, level_code: values.level_code, level_number: values.level_number, formal_status: values.formal_status ?? false, probation_status: values.probation_status ?? "not_applicable", probation_date: values.probation_date, hire_date: values.hire_date, active: true, assignment: { subject_id: values.subject_id, subject_department_id: values.subject_department_id, position_title: values.position_title, level_code: values.level_code, level_number: values.level_number, effective_from: values.hire_date }, salary: { fixed_salary: values.fixed_salary, performance_base: values.performance_base, effective_from: values.hire_date }, base: { city_id: values.city_id, effective_from: values.hire_date }, bank_account: { account_number: values.account_number, account_name: values.name, bank_name: values.bank_name, branch_name: values.branch_name, effective_from: values.hire_date } });
  };
  return <div className={styles.page}>
    <Space className={styles.heading} align="center"><Typography.Title level={2}>员工与薪酬</Typography.Title><Button type="primary" onClick={openCreate} disabled={!company.data}>新增员工</Button></Space>
    {!company.data && !company.isLoading ? <Alert type="warning" showIcon message="请先在“公司与组织”中初始化目标公司" /> : null}
    {employees.isError ? <Alert type="error" showIcon message={employees.error.message} /> : null}
    <Table rowKey="id" loading={employees.isLoading} dataSource={employees.data ?? []} columns={[{ title: "员工编号", dataIndex: "employee_no" }, { title: "姓名", dataIndex: "name" }, { title: "身份证号", dataIndex: "id_number" }, { title: "状态", render: (_: unknown, row: Employee) => <Tag color={row.active ? "green" : "default"}>{row.active ? "在职" : "停用"}</Tag> }, { title: "固定薪资", render: (_: unknown, row: Employee) => row.salary?.fixed_salary ?? "-" }, { title: "操作", render: (_: unknown, row: Employee) => <Button type="link" onClick={() => openEdit(row)}>编辑</Button> }]} />
    <Drawer title={editing ? "编辑员工" : "新增员工"} open={open} onClose={close} width={560} extra={<Button type="primary" onClick={() => form.submit()} loading={create.isPending || update.isPending}>保存</Button>}>
      <Form form={form} layout="vertical" onFinish={submit}>
        <Form.Item name="employee_no" label="员工编号" rules={[{ required: true }]}><Input disabled={!!editing} /></Form.Item>
        <Form.Item name="id_number" label="身份证号" rules={[{ required: true }]}><Input disabled={!!editing} /></Form.Item>
        <Form.Item name="name" label="姓名" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="employee_type" label="员工类型" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="hire_date" label="入职日期" rules={[{ required: !editing }]}><Input placeholder="YYYY-MM-DD" disabled={!!editing} /></Form.Item>
        <Form.Item name="formal_status" label="是否正式"><Select options={[{ label: "正式", value: true }, { label: "试用", value: false }]} /></Form.Item>
        <Form.Item name="probation_status" label="转正状态"><Select options={[{ label: "不适用", value: "not_applicable" }, { label: "试用期", value: "in_probation" }, { label: "已转正", value: "confirmed" }]} /></Form.Item>
        <Form.Item name="probation_date" label="转正日期"><Input placeholder="YYYY-MM-DD" /></Form.Item>
        <Form.Item name="level_code" label="职级"><Input placeholder="如 P6" /></Form.Item>
        <Form.Item name="level_number" label="职级数字"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item>
        <Form.Item name="subject_id" label="任职主体" rules={[{ required: !editing }]}><Select disabled={!!editing} options={(subjects.data ?? []).map((row) => ({ label: `${row.code} ${row.name}`, value: row.id }))} /></Form.Item>
        <Form.Item name="subject_department_id" label="主体部门" rules={[{ required: !editing }]}><Select disabled={!!editing} options={availableRelations.map((row) => ({ label: `${row.code} ${row.name}`, value: row.id }))} /></Form.Item>
        <Form.Item name="position_title" label="职位" rules={[{ required: !editing }]}><Input disabled={!!editing} /></Form.Item>
        <Form.Item name="city_id" label="base 地城市" rules={[{ required: !editing }]}><Select disabled={!!editing} options={(cities.data ?? []).map((row) => ({ label: `${row.code} ${row.name}`, value: row.id }))} /></Form.Item>
        <Form.Item name="fixed_salary" label="固定薪资（80%）" rules={[{ required: !editing }]}><InputNumber min={0} style={{ width: "100%" }} /></Form.Item>
        <Form.Item name="performance_base" label="绩效基数（20%）" rules={[{ required: !editing }]}><InputNumber min={0} style={{ width: "100%" }} /></Form.Item>
        <Form.Item name="account_number" label="银行卡号" rules={[{ required: !editing }]}><Input disabled={!!editing} /></Form.Item>
        {!editing ? <><Form.Item name="bank_name" label="银行名称"><Input /></Form.Item><Form.Item name="branch_name" label="支行名称"><Input /></Form.Item></> : null}
        {editing ? <Form.Item name="active" label="状态"><Select options={[{ label: "在职", value: true }, { label: "停用", value: false }]} /></Form.Item> : null}
      </Form>
    </Drawer>
  </div>;
}
