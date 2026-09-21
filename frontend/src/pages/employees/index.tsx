import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App,
  Button,
  Card,
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import { useMemo, useState } from "react";
import { resources, type Employee } from "../../shared/api/resources";
import styles from "./index.module.less";

const probationLabels: Record<string, string> = {
  not_applicable: "不适用",
  in_probation: "试用期",
  confirmed: "已转正",
};

function maskIdNumber(value: string) {
  return value.length > 10
    ? `${value.slice(0, 6)}********${value.slice(-4)}`
    : value;
}

export function EmployeesPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [editing, setEditing] = useState<Employee | null>(null);
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [activeFilter, setActiveFilter] = useState<boolean | undefined>();
  const [probationFilter, setProbationFilter] = useState<string>();
  const [subjectFilter, setSubjectFilter] = useState<number>();
  const employees = useQuery({
    queryKey: ["employees"],
    queryFn: resources.employees,
  });
  const company = useQuery({
    queryKey: ["org", "company"],
    queryFn: resources.company,
  });
  const cities = useQuery({
    queryKey: ["org", "cities"],
    queryFn: resources.cities,
  });
  const subjects = useQuery({
    queryKey: ["org", "subjects"],
    queryFn: resources.subjects,
  });
  const relations = useQuery({
    queryKey: ["org", "relations"],
    queryFn: resources.subjectDepartments,
  });
  const selectedSubject = Form.useWatch("subject_id", form);
  const selectedProbationStatus = Form.useWatch("probation_status", form);
  const confirming =
    editing?.probation_status === "in_probation" &&
    selectedProbationStatus === "confirmed";
  const availableRelations = (relations.data ?? []).filter(
    (row) => row.subject_id === selectedSubject,
  );
  const subjectNames = new Map(
    (subjects.data ?? []).map((row) => [row.id, row.name]),
  );
  const relationNames = new Map(
    (relations.data ?? []).map((row) => [row.id, row.name]),
  );
  const cityNames = new Map(
    (cities.data ?? []).map((row) => [row.id, row.name]),
  );
  const visibleEmployees = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    return (employees.data ?? []).filter((employee) => {
      const matchesKeyword =
        !normalizedKeyword ||
        employee.name.toLowerCase().includes(normalizedKeyword) ||
        employee.employee_no.toLowerCase().includes(normalizedKeyword) ||
        employee.id_number.toLowerCase().includes(normalizedKeyword);
      return (
        matchesKeyword &&
        (activeFilter === undefined || employee.active === activeFilter) &&
        (!probationFilter || employee.probation_status === probationFilter) &&
        (!subjectFilter || employee.assignment?.subject_id === subjectFilter)
      );
    });
  }, [activeFilter, employees.data, keyword, probationFilter, subjectFilter]);

  const close = () => {
    setOpen(false);
    setEditing(null);
    form.resetFields();
  };
  const refresh = () => {
    close();
    queryClient.invalidateQueries({ queryKey: ["employees"] });
  };
  const create = useMutation({
    mutationFn: resources.createEmployee,
    onSuccess: () => {
      message.success("员工已保存");
      refresh();
    },
    onError: (error) => message.error(error.message),
  });
  const update = useMutation({
    mutationFn: ({ id, data }: { id: number; data: unknown }) =>
      resources.updateEmployee(id, data),
    onSuccess: () => {
      message.success("员工已更新");
      refresh();
    },
    onError: (error) => message.error(error.message),
  });
  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      employee_type: "employee",
      probation_status: "not_applicable",
      active: true,
    });
    setOpen(true);
  };
  const openEdit = (row: Employee) => {
    setEditing(row);
    form.setFieldsValue({
      ...row,
      fixed_salary: row.salary?.fixed_salary,
      performance_base: row.salary?.performance_base,
      subject_id: row.assignment?.subject_id,
      subject_department_id: row.assignment?.subject_department_id,
      position_title: row.assignment?.position_title,
      city_id: row.base?.city_id,
      account_number: row.bank_account?.account_number,
    });
    setOpen(true);
  };
  const submit = (values: Record<string, unknown>) => {
    if (editing) {
      const data: Record<string, unknown> = {
        name: values.name,
        employee_type: values.employee_type,
        active: values.active,
        formal_status: values.formal_status,
        probation_status: values.probation_status,
        probation_date: values.probation_date,
        termination_date: values.termination_date,
      };
      if (confirming) {
        data.salary = {
          fixed_salary: String(values.fixed_salary),
          performance_base: String(values.performance_base),
          effective_from: values.probation_date,
        };
      }
      update.mutate({ id: editing.id, data });
      return;
    }
    create.mutate({
      company_id: company.data!.id,
      id_number: values.id_number,
      employee_no: values.employee_no,
      name: values.name,
      employee_type: values.employee_type,
      level_code: values.level_code,
      level_number: values.level_number,
      formal_status: values.formal_status ?? false,
      probation_status: values.probation_status ?? "not_applicable",
      probation_date: values.probation_date,
      hire_date: values.hire_date,
      active: true,
      assignment: {
        subject_id: values.subject_id,
        subject_department_id: values.subject_department_id,
        position_title: values.position_title,
        level_code: values.level_code,
        level_number: values.level_number,
        effective_from: values.hire_date,
      },
      salary: {
        fixed_salary: String(values.fixed_salary),
        performance_base: String(values.performance_base),
        effective_from: values.hire_date,
      },
      base: { city_id: values.city_id, effective_from: values.hire_date },
      bank_account: {
        account_number: values.account_number,
        account_name: values.name,
        bank_name: values.bank_name,
        branch_name: values.branch_name,
        effective_from: values.hire_date,
      },
    });
  };
  const resetFilters = () => {
    setKeyword("");
    setActiveFilter(undefined);
    setProbationFilter(undefined);
    setSubjectFilter(undefined);
  };

  return (
    <div className={styles.page}>
      <section className={styles.pageLead}>
        <div>
          <Typography.Title level={2}>员工管理</Typography.Title>
          <Typography.Paragraph type="secondary">
            维护参与算薪的员工当前资料；身份证号创建后不可修改，历史工资由计算快照追溯。
          </Typography.Paragraph>
        </div>
      </section>

      {!company.data && !company.isLoading ? (
        <Alert
          type="warning"
          showIcon
          title="请先初始化目标公司"
          description="在“组织管理”中保存公司后，才能新增员工。"
        />
      ) : null}
      {employees.isError ? (
        <Alert type="error" showIcon title={employees.error.message} />
      ) : null}

      <section className={styles.filters} aria-label="员工筛选">
        <div className={styles.keywordFilter}>
          <label htmlFor="employee-keyword">姓名、编号或身份证号</label>
          <Input
            id="employee-keyword"
            prefix={<SearchOutlined />}
            placeholder="输入关键词"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </div>
        <div className={styles.filter}>
          <label htmlFor="employee-subject">主体</label>
          <Select
            id="employee-subject"
            aria-label="主体"
            allowClear
            placeholder="全部主体"
            value={subjectFilter}
            onChange={setSubjectFilter}
            options={(subjects.data ?? []).map((row) => ({
              label: row.name,
              value: row.id,
            }))}
          />
        </div>
        <div className={styles.filter}>
          <label htmlFor="employee-active">在职状态</label>
          <Select
            id="employee-active"
            aria-label="在职状态"
            allowClear
            placeholder="全部"
            value={activeFilter}
            onChange={setActiveFilter}
            options={[
              { label: "在职", value: true },
              { label: "停用", value: false },
            ]}
          />
        </div>
        <div className={styles.filter}>
          <label htmlFor="employee-probation">试用/转正</label>
          <Select
            id="employee-probation"
            aria-label="试用/转正"
            allowClear
            placeholder="全部"
            value={probationFilter}
            onChange={setProbationFilter}
            options={Object.entries(probationLabels).map(([value, label]) => ({
              label,
              value,
            }))}
          />
        </div>
        <Button className={styles.resetButton} onClick={resetFilters}>
          重置
        </Button>
      </section>

      <Card
        className={styles.tableCard}
        title="员工名单"
        extra={
          <Space>
            <Typography.Text type="secondary">
              共 {visibleEmployees.length} 人
            </Typography.Text>
            <Button
              type="primary"
              size="small"
              icon={<PlusOutlined />}
              onClick={openCreate}
              disabled={!company.data}
            >
              新增员工
            </Button>
          </Space>
        }
      >
        <Table
          rowKey="id"
          size="small"
          loading={employees.isLoading}
          dataSource={visibleEmployees}
          scroll={{ x: 1260 }}
          pagination={{ pageSize: 12, showSizeChanger: false }}
          locale={{ emptyText: "没有符合条件的员工，请调整筛选条件。" }}
          columns={[
            {
              title: "姓名",
              fixed: "left",
              width: 138,
              render: (_: unknown, row: Employee) => (
                <div>
                  <strong>{row.name}</strong>
                  <span className={styles.cellSub}>{row.employee_no}</span>
                </div>
              ),
            },
            {
              title: "身份证号",
              width: 178,
              render: (_: unknown, row: Employee) => (
                <span className={styles.mono} title={row.id_number}>
                  {maskIdNumber(row.id_number)}
                </span>
              ),
            },
            {
              title: "主体",
              width: 150,
              render: (_: unknown, row: Employee) =>
                subjectNames.get(row.assignment?.subject_id ?? 0) ?? "—",
            },
            {
              title: "部门",
              width: 140,
              render: (_: unknown, row: Employee) =>
                relationNames.get(row.assignment?.subject_department_id ?? 0) ??
                "—",
            },
            {
              title: "职位",
              width: 140,
              render: (_: unknown, row: Employee) =>
                row.assignment?.position_title ?? "—",
            },
            {
              title: "入职日期",
              dataIndex: "hire_date",
              width: 112,
              className: styles.mono,
            },
            {
              title: "转正日期",
              dataIndex: "probation_date",
              width: 112,
              className: styles.mono,
              render: (value: string | null) => value ?? "—",
            },
            {
              title: "固定薪资",
              align: "right",
              width: 110,
              render: (_: unknown, row: Employee) => (
                <span className={styles.mono}>
                  {row.salary?.fixed_salary ?? "—"}
                </span>
              ),
            },
            {
              title: "绩效基数",
              align: "right",
              width: 110,
              render: (_: unknown, row: Employee) => (
                <span className={styles.mono}>
                  {row.salary?.performance_base ?? "—"}
                </span>
              ),
            },
            {
              title: "base 城市",
              width: 100,
              render: (_: unknown, row: Employee) =>
                cityNames.get(row.base?.city_id ?? 0) ?? "—",
            },
            {
              title: "状态",
              width: 150,
              render: (_: unknown, row: Employee) => (
                <Space size={4} wrap>
                  <Tag color={row.active ? "success" : "default"}>
                    {row.active ? "在职" : "停用"}
                  </Tag>
                  {row.probation_status === "in_probation" ? (
                    <Tag color="warning">试用期</Tag>
                  ) : null}
                </Space>
              ),
            },
            {
              title: "操作",
              fixed: "right",
              width: 72,
              render: (_: unknown, row: Employee) => (
                <Button type="link" size="small" onClick={() => openEdit(row)}>
                  编辑
                </Button>
              ),
            },
          ]}
        />
      </Card>

      <Drawer
        title={editing ? "编辑员工" : "新增员工"}
        open={open}
        onClose={close}
        size="large"
        footer={
          <Space className={styles.drawerActions}>
            <Button onClick={close}>取消</Button>
            <Button
              type="primary"
              onClick={() => form.submit()}
              loading={create.isPending || update.isPending}
            >
              保存
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical" onFinish={submit}>
          <div className={styles.formSection}>基本资料</div>
          <div className={styles.formGrid}>
            <Form.Item
              name="employee_no"
              label="员工编号"
              rules={[{ required: true }]}
            >
              <Input disabled={!!editing} />
            </Form.Item>
            <Form.Item
              name="id_number"
              label="身份证号"
              rules={[{ required: true }]}
            >
              <Input disabled={!!editing} />
            </Form.Item>
            <Form.Item name="name" label="姓名" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Form.Item
              name="employee_type"
              label="员工类型"
              rules={[{ required: true }]}
            >
              <Input />
            </Form.Item>
            <Form.Item
              name="hire_date"
              label="入职日期"
              rules={[{ required: !editing }]}
            >
              <Input placeholder="YYYY-MM-DD" disabled={!!editing} />
            </Form.Item>
            <Form.Item name="termination_date" label="离职日期">
              <Input placeholder="YYYY-MM-DD" />
            </Form.Item>
          </div>

          <div className={styles.formSection}>任职与转正</div>
          <div className={styles.formGrid}>
            <Form.Item name="formal_status" label="是否正式">
              <Select
                options={[
                  { label: "正式", value: true },
                  { label: "试用", value: false },
                ]}
              />
            </Form.Item>
            <Form.Item name="probation_status" label="转正状态">
              <Select
                options={Object.entries(probationLabels).map(
                  ([value, label]) => ({ label, value }),
                )}
              />
            </Form.Item>
            <Form.Item
              name="probation_date"
              label="转正日期"
              rules={[{ required: confirming }]}
            >
              <Input placeholder="YYYY-MM-DD" />
            </Form.Item>
            <Form.Item
              name="position_title"
              label="职位"
              rules={[{ required: !editing }]}
            >
              <Input disabled={!!editing} />
            </Form.Item>
            <Form.Item
              name="subject_id"
              label="任职主体"
              rules={[{ required: !editing }]}
            >
              <Select
                disabled={!!editing}
                options={(subjects.data ?? []).map((row) => ({
                  label: `${row.code} ${row.name}`,
                  value: row.id,
                }))}
              />
            </Form.Item>
            <Form.Item
              name="subject_department_id"
              label="主体部门"
              rules={[{ required: !editing }]}
            >
              <Select
                disabled={!!editing}
                options={availableRelations.map((row) => ({
                  label: `${row.code} ${row.name}`,
                  value: row.id,
                }))}
              />
            </Form.Item>
            <Form.Item name="level_code" label="职级">
              <Input placeholder="如 P6" />
            </Form.Item>
            <Form.Item name="level_number" label="职级数字">
              <InputNumber min={0} className={styles.fullWidth} />
            </Form.Item>
          </div>

          <div className={styles.formSection}>薪酬与发薪资料</div>
          <div className={styles.formGrid}>
            <Form.Item
              name="fixed_salary"
              label="固定薪资（80%）"
              rules={[{ required: !editing || confirming }]}
            >
              <InputNumber
                min={0}
                disabled={!!editing}
                className={styles.fullWidth}
              />
            </Form.Item>
            <Form.Item
              name="performance_base"
              label="绩效基数（20%）"
              rules={[{ required: !editing || confirming }]}
            >
              <InputNumber
                min={0}
                disabled={!!editing && !confirming}
                className={styles.fullWidth}
              />
            </Form.Item>
            <Form.Item
              name="city_id"
              label="base 地城市"
              rules={[{ required: !editing }]}
            >
              <Select
                disabled={!!editing}
                options={(cities.data ?? []).map((row) => ({
                  label: `${row.code} ${row.name}`,
                  value: row.id,
                }))}
              />
            </Form.Item>
            <Form.Item
              name="account_number"
              label="银行卡号"
              rules={[{ required: !editing }]}
            >
              <Input disabled={!!editing} />
            </Form.Item>
            {!editing ? (
              <>
                <Form.Item name="bank_name" label="银行名称">
                  <Input />
                </Form.Item>
                <Form.Item name="branch_name" label="支行名称">
                  <Input />
                </Form.Item>
              </>
            ) : null}
            {editing ? (
              <Form.Item name="active" label="状态">
                <Select
                  options={[
                    { label: "在职", value: true },
                    { label: "停用", value: false },
                  ]}
                />
              </Form.Item>
            ) : null}
          </div>
        </Form>
      </Drawer>
    </div>
  );
}
