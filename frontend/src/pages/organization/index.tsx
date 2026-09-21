import { PlusOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Drawer,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Typography,
} from "antd";
import { useState } from "react";
import {
  resources,
  type City,
  type Department,
  type Subject,
  type SubjectDepartment,
} from "../../shared/api/resources";
import styles from "./index.module.less";

type Kind = "city" | "subject" | "department" | "relation";
type Row = City | Subject | Department | SubjectDepartment;

const titles: Record<Kind, string> = {
  city: "城市",
  subject: "工资归属主体",
  department: "共用部门",
  relation: "主体与部门关联",
};

export function OrganizationPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [kind, setKind] = useState<Kind | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
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
  const departments = useQuery({
    queryKey: ["org", "departments"],
    queryFn: resources.departments,
  });
  const relations = useQuery({
    queryKey: ["org", "relations"],
    queryFn: resources.subjectDepartments,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["org"] });
  const mutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => {
      if (kind === "city") {
        return editing
          ? resources.updateCity(editing.id, values)
          : resources.createCity(values);
      }
      if (kind === "subject") {
        return editing
          ? resources.updateSubject(editing.id, values)
          : resources.createSubject({
              ...values,
              company_id: company.data!.id,
            });
      }
      if (kind === "department") {
        return editing
          ? resources.updateDepartment(editing.id, values)
          : resources.createDepartment({
              ...values,
              company_id: company.data!.id,
            });
      }
      return editing
        ? resources.updateSubjectDepartment(editing.id, values)
        : resources.createSubjectDepartment({
            ...values,
            company_id: company.data!.id,
          });
    },
    onSuccess: () => {
      message.success("已保存");
      closeDrawer();
      refresh();
    },
    onError: (error) => message.error(error.message),
  });
  const remove = useMutation({
    mutationFn: ({ target, id }: { target: Kind; id: number }) =>
      target === "city"
        ? resources.deleteCity(id)
        : target === "subject"
          ? resources.deleteSubject(id)
          : target === "department"
            ? resources.deleteDepartment(id)
            : resources.deleteSubjectDepartment(id),
    onSuccess: refresh,
    onError: (error) => message.error(error.message),
  });

  const closeDrawer = () => {
    setKind(null);
    setEditing(null);
    form.resetFields();
  };
  const openDrawer = (target: Kind, row?: Row) => {
    setKind(target);
    setEditing(row ?? null);
    form.resetFields();
    if (row) form.setFieldsValue(row);
  };
  const relationName = (row: Row, target: "subject_id" | "department_id") => {
    if (!(target in row)) return "—";
    const relation = row as SubjectDepartment;
    const source = target === "subject_id" ? subjects.data : departments.data;
    return source?.find((item) => item.id === relation[target])?.name ?? "—";
  };
  const renderTable = (target: Kind, data: Row[], loading: boolean) => (
    <Card
      className={styles.dataCard}
      title={titles[target]}
      extra={
        <Button
          size="small"
          icon={<PlusOutlined />}
          onClick={() => openDrawer(target)}
        >
          新增
        </Button>
      }
      loading={loading}
    >
      <Table
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={data}
        scroll={{ x: "max-content" }}
        locale={{ emptyText: `暂无${titles[target]}资料` }}
        columns={[
          { title: "编码", dataIndex: "code" },
          { title: "名称", dataIndex: "name" },
          ...(target === "relation"
            ? [
                {
                  title: "主体",
                  render: (_: unknown, row: Row) =>
                    relationName(row, "subject_id"),
                },
                {
                  title: "部门",
                  render: (_: unknown, row: Row) =>
                    relationName(row, "department_id"),
                },
              ]
            : []),
          {
            title: "操作",
            fixed: "right",
            render: (_: unknown, row: Row) => (
              <Space size={2}>
                <Button
                  type="link"
                  size="small"
                  onClick={() => openDrawer(target, row)}
                >
                  编辑
                </Button>
                <Popconfirm
                  title="确认删除？"
                  description="被其他资料引用时系统会拒绝删除。"
                  onConfirm={() => remove.mutate({ target, id: row.id })}
                >
                  <Button type="link" size="small" danger>
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
    </Card>
  );

  return (
    <div className={styles.page}>
      <section className={styles.pageLead}>
        <Typography.Title level={2}>组织管理</Typography.Title>
        <Typography.Paragraph type="secondary">
          系统只服务一个目标公司；部门体系全公司共用，并通过主体部门实例关联员工。
        </Typography.Paragraph>
      </section>

      {company.isError ? (
        <Alert type="error" showIcon title={company.error.message} />
      ) : null}
      {!company.data && !company.isLoading ? (
        <CompanyForm onSaved={refresh} />
      ) : null}
      {company.data ? (
        <Card
          className={styles.companyCard}
          title="公司基本信息"
          extra={<Typography.Text type="secondary">单公司模式</Typography.Text>}
        >
          <Descriptions column={{ xs: 1, sm: 2 }} size="small">
            <Descriptions.Item label="公司名称">
              {company.data.name}
            </Descriptions.Item>
            <Descriptions.Item label="公司编码">
              <span className={styles.mono}>{company.data.code}</span>
            </Descriptions.Item>
            <Descriptions.Item label="工资归属主体">
              <span className={styles.mono}>{subjects.data?.length ?? 0}</span>{" "}
              个
            </Descriptions.Item>
            <Descriptions.Item label="共用部门">
              <span className={styles.mono}>
                {departments.data?.length ?? 0}
              </span>{" "}
              个
            </Descriptions.Item>
          </Descriptions>
        </Card>
      ) : null}

      <section className={styles.grid}>
        {renderTable("subject", subjects.data ?? [], subjects.isLoading)}
        {renderTable(
          "department",
          departments.data ?? [],
          departments.isLoading,
        )}
        {renderTable("relation", relations.data ?? [], relations.isLoading)}
        {renderTable("city", cities.data ?? [], cities.isLoading)}
      </section>

      <Drawer
        title={`${editing ? "编辑" : "新增"}${kind ? titles[kind] : "资料"}`}
        open={!!kind}
        onClose={closeDrawer}
        footer={
          <Space className={styles.drawerActions}>
            <Button onClick={closeDrawer}>取消</Button>
            <Button
              type="primary"
              onClick={() => form.submit()}
              loading={mutation.isPending}
            >
              保存
            </Button>
          </Space>
        }
      >
        <Form
          name="organization-record"
          form={form}
          layout="vertical"
          onFinish={(values) => mutation.mutate(values)}
        >
          <Form.Item name="code" label="编码" rules={[{ required: true }]}>
            <Input disabled={!!editing} />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          {kind === "department" ? (
            <Form.Item name="parent_id" label="上级部门">
              <Select
                allowClear
                options={(departments.data ?? [])
                  .filter((item) => item.id !== editing?.id)
                  .map((item) => ({ label: item.name, value: item.id }))}
              />
            </Form.Item>
          ) : null}
          {kind === "relation" && !editing ? (
            <>
              <Form.Item
                name="subject_id"
                label="主体"
                rules={[{ required: true }]}
              >
                <Select
                  options={(subjects.data ?? []).map((item) => ({
                    label: item.name,
                    value: item.id,
                  }))}
                />
              </Form.Item>
              <Form.Item
                name="department_id"
                label="部门"
                rules={[{ required: true }]}
              >
                <Select
                  options={(departments.data ?? []).map((item) => ({
                    label: item.name,
                    value: item.id,
                  }))}
                />
              </Form.Item>
            </>
          ) : null}
        </Form>
      </Drawer>
    </div>
  );
}

function CompanyForm({ onSaved }: { onSaved: () => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const mutation = useMutation({
    mutationFn: resources.createCompany,
    onSuccess: onSaved,
    onError: (error) => message.error(error.message),
  });

  return (
    <Card
      className={styles.companyCard}
      title="初始化目标公司"
      extra={
        <Button
          type="primary"
          onClick={() => form.submit()}
          loading={mutation.isPending}
        >
          保存
        </Button>
      }
    >
      <Alert
        className={styles.companyHint}
        type="info"
        showIcon
        title="单公司模式"
        description="公司初始化后，再维护工资归属主体、城市和共用部门。"
      />
      <Form
        name="company"
        form={form}
        layout="inline"
        onFinish={(values) => mutation.mutate(values)}
      >
        <Form.Item name="code" label="编码" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="name" label="名称" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
      </Form>
    </Card>
  );
}
