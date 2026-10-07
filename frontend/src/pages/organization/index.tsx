import { PlusOutlined } from "@ant-design/icons";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
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
import { useSearchParams } from "react-router-dom";
import {
  resources,
  type City,
  type DepartmentList,
  type PageParams,
  type Subject,
  type SubjectDepartmentList,
} from "../../shared/api/resources";
import styles from "./index.module.less";

type Kind = "city" | "subject" | "department" | "relation";
type Row = City | Subject | DepartmentList | SubjectDepartmentList;

const titles: Record<Kind, string> = {
  city: "城市",
  subject: "工资归属主体",
  department: "共用部门",
  relation: "主体与部门关联",
};

export function OrganizationPage() {
  const [params, setParams] = useSearchParams();
  const pageParam = (name: string, fallback: number, maximum: number) => {
    const value = Number(params.get(name));
    return Number.isInteger(value) && value > 0 && value <= maximum
      ? value
      : fallback;
  };
  const pagination = (target: Kind): PageParams => ({
    page_no: pageParam(`${target}_page`, 1, 2_147_483_647),
    page_size: pageParam(`${target}_page_size`, 10, 100),
  });
  const setPagination = (target: Kind, pageNo: number, pageSize: number) => {
    const changedSize = pageSize !== pagination(target).page_size;
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set(`${target}_page`, String(changedSize ? 1 : pageNo));
      next.set(`${target}_page_size`, String(pageSize));
      return next;
    });
  };
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
    queryKey: ["org", "cities", "page", pagination("city")],
    queryFn: () => resources.cityPage(pagination("city")),
    placeholderData: keepPreviousData,
  });
  const subjects = useQuery({
    queryKey: ["org", "subjects", "page", pagination("subject")],
    queryFn: () => resources.subjectPage(pagination("subject")),
    placeholderData: keepPreviousData,
  });
  const departments = useQuery({
    queryKey: ["org", "departments", "page", pagination("department")],
    queryFn: () => resources.departmentPage(pagination("department")),
    placeholderData: keepPreviousData,
  });
  const relations = useQuery({
    queryKey: ["org", "relations", "page", pagination("relation")],
    queryFn: () => resources.subjectDepartmentPage(pagination("relation")),
    placeholderData: keepPreviousData,
  });
  const pages = {
    city: cities,
    subject: subjects,
    department: departments,
    relation: relations,
  };
  const subjectOptions = useQuery({
    queryKey: ["org", "subjects"],
    queryFn: resources.subjects,
    enabled: kind === "relation" && !editing,
  });
  const departmentOptions = useQuery({
    queryKey: ["org", "departments"],
    queryFn: resources.departments,
    enabled: kind === "department" || (kind === "relation" && !editing),
  });
  const optionError =
    kind === "department"
      ? departmentOptions.error
      : kind === "relation" && !editing
        ? (subjectOptions.error ?? departmentOptions.error)
        : null;
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
    onSuccess: (_data, { target }) => {
      const page = pagination(target);
      if (pages[target].data?.items.length === 1 && page.page_no > 1) {
        setPagination(target, page.page_no - 1, page.page_size);
      }
      void refresh();
    },
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
  const renderTable = (target: Kind) => {
    const query = pages[target];
    const page = pagination(target);
    return (
      <Card
        role="region"
        aria-label={titles[target]}
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
        loading={query.isLoading}
      >
        {target === "department" || target === "relation" ? (
          <p className={styles.tableHint}>
            {target === "department"
              ? "全公司共用的部门及上下级结构，每个部门只维护一次。"
              : "记录哪些主体使用共用部门；同名关联引用原部门，不会复制部门。"}
          </p>
        ) : null}
        {query.isError ? (
          <Alert
            className={styles.queryError}
            type="error"
            showIcon
            title={query.error.message}
            action={
              <Button size="small" onClick={() => void query.refetch()}>
                重试
              </Button>
            }
          />
        ) : null}
        <Table<Row>
          rowKey="id"
          size="small"
          loading={query.isFetching}
          pagination={{
            current: page.page_no,
            pageSize: page.page_size,
            total: query.data?.total ?? 0,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (total) =>
              query.isError && !query.data ? "总数未加载" : `共 ${total} 条`,
            onChange: (pageNo, pageSize) =>
              setPagination(target, pageNo, pageSize),
            disabled: query.isFetching || remove.isPending,
            responsive: true,
          }}
          dataSource={query.data?.items ?? []}
          scroll={{ x: "max-content" }}
          locale={{
            emptyText: query.isError
              ? "数据加载失败，请重试"
              : `暂无${titles[target]}资料`,
          }}
          columns={[
            {
              title: target === "relation" ? "关联编码" : "编码",
              dataIndex: "code",
            },
            {
              title: target === "relation" ? "关联名称" : "名称",
              dataIndex: "name",
            },
            ...(target === "department"
              ? [
                  {
                    title: "上级部门",
                    render: (_: unknown, row: Row) =>
                      (row as DepartmentList).parent_name ?? "顶级部门",
                  },
                ]
              : []),
            ...(target === "relation"
              ? [
                  {
                    title: "主体",
                    dataIndex: "subject_name",
                  },
                  {
                    title: "共用部门",
                    dataIndex: "department_name",
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
  };

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
              <span className={styles.mono}>{subjects.data?.total ?? "—"}</span>{" "}
              个
            </Descriptions.Item>
            <Descriptions.Item label="共用部门">
              <span className={styles.mono}>
                {departments.data?.total ?? "—"}
              </span>{" "}
              个
            </Descriptions.Item>
          </Descriptions>
        </Card>
      ) : null}

      <section className={styles.grid}>
        {renderTable("subject")}
        {renderTable("department")}
        {renderTable("relation")}
        {renderTable("city")}
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
              disabled={
                !!optionError ||
                subjectOptions.isFetching ||
                departmentOptions.isFetching
              }
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
          {optionError ? (
            <Alert
              type="error"
              showIcon
              title="组织选项加载失败"
              description={optionError.message}
            />
          ) : null}
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
                loading={departmentOptions.isFetching}
                disabled={!!departmentOptions.error}
                options={(departmentOptions.data ?? [])
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
                  loading={subjectOptions.isFetching}
                  disabled={!!subjectOptions.error}
                  options={(subjectOptions.data ?? []).map((item) => ({
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
                  loading={departmentOptions.isFetching}
                  disabled={!!departmentOptions.error}
                  options={(departmentOptions.data ?? []).map((item) => ({
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
