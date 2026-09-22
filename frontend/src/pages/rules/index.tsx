import { PlusOutlined } from "@ant-design/icons";
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
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import { useState } from "react";
import { resources, type CityRule } from "../../shared/api/resources";
import styles from "./index.module.less";

export function RulesPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [cityForm] = Form.useForm();
  const [attendanceForm] = Form.useForm();
  const [drawer, setDrawer] = useState<"city" | "attendance" | null>(null);
  const cities = useQuery({
    queryKey: ["org", "cities"],
    queryFn: resources.cities,
  });
  const cityRules = useQuery({
    queryKey: ["rules", "city"],
    queryFn: resources.cityRules,
  });
  const attendanceRules = useQuery({
    queryKey: ["rules", "attendance"],
    queryFn: resources.attendanceRules,
  });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["rules"] });
    setDrawer(null);
    cityForm.resetFields();
    attendanceForm.resetFields();
  };
  const cityMutation = useMutation({
    mutationFn: resources.createCityRule,
    onSuccess: () => {
      message.success("城市规则版本已保存");
      refresh();
    },
    onError: (error) => message.error(error.message),
  });
  const attendanceMutation = useMutation({
    mutationFn: resources.createAttendanceRule,
    onSuccess: () => {
      message.success("考勤规则版本已保存");
      refresh();
    },
    onError: (error) => message.error(error.message),
  });
  const error = cityRules.error ?? attendanceRules.error ?? cities.error;
  const today = new Date().toISOString().slice(0, 10);
  const ruleStatus = (row: CityRule) => {
    if (row.fixed_base == null) return <Tag color="warning">缺固定基数</Tag>;
    if (row.effective_from > today) return <Tag>待生效</Tag>;
    if (row.effective_to != null && row.effective_to < today)
      return <Tag color="error">已过期</Tag>;
    return <Tag color="success">当前有效</Tag>;
  };

  return (
    <div className={styles.page}>
      <section>
        <Typography.Title level={2}>城市及考勤规则维护</Typography.Title>
        <Typography.Paragraph type="secondary" className={styles.lead}>
          社保按员工实际 base
          城市的固定基数计算，公积金按固定薪资计缴；规则按生效期间保留历史版本，新增版本不会覆盖已锁定期间。
        </Typography.Paragraph>
      </section>
      {error ? <Alert type="error" showIcon title={error.message} /> : null}
      <section className={styles.metrics}>
        <div className={styles.metric}>
          <div className={styles.metricLabel}>城市规则版本</div>
          <div className={styles.metricValue}>
            {cityRules.data?.length ?? 0}
          </div>
          <div className={styles.metricHint}>含历史版本</div>
        </div>
        <div className={styles.metric}>
          <div className={styles.metricLabel}>考勤规则版本</div>
          <div className={styles.metricValue}>
            {attendanceRules.data?.length ?? 0}
          </div>
          <div className={styles.metricHint}>按期间命中</div>
        </div>
        <div className={styles.metric}>
          <div className={styles.metricLabel}>公积金个人比例</div>
          <div className={styles.metricValue}>5%</div>
          <div className={styles.metricHint}>基数为固定薪资</div>
        </div>
        <div className={styles.metric}>
          <div className={styles.metricLabel}>考勤固定口径</div>
          <div className={styles.metricValue}>8h / 30元</div>
          <div className={styles.metricHint}>补卡免扣，P7+免罚</div>
        </div>
      </section>
      <Card
        className={styles.card}
        title="城市社保与公积金规则版本"
        extra={
          <Button
            type="primary"
            size="small"
            icon={<PlusOutlined />}
            onClick={() => {
              cityForm.setFieldsValue({ social_items: [{}] });
              setDrawer("city");
            }}
          >
            新增城市规则
          </Button>
        }
      >
        <Table<CityRule>
          rowKey="id"
          size="small"
          loading={cityRules.isLoading}
          dataSource={cityRules.data ?? []}
          pagination={false}
          scroll={{ x: 900 }}
          locale={{ emptyText: "暂无城市规则，请先新增可用版本" }}
          columns={[
            { title: "城市", dataIndex: "city_name" },
            {
              title: "版本",
              dataIndex: "version",
              render: (value) => <span className={styles.mono}>{value}</span>,
            },
            {
              title: "社保固定基数",
              dataIndex: "fixed_base",
              align: "right",
              render: (value) => (
                <span className={styles.mono}>{value ?? "未配置"}</span>
              ),
            },
            {
              title: "有效期",
              render: (_, row) => (
                <span className={styles.mono}>
                  {row.effective_from} 至 {row.effective_to ?? "长期"}
                </span>
              ),
            },
            { title: "状态", render: (_, row) => ruleStatus(row) },
            {
              title: "公积金",
              render: (_, row) =>
                row.housing_base_source === "fixed_salary" ? (
                  <Tag color="success">固定薪资 · 5%/5%</Tag>
                ) : (
                  <Tag color="warning">待确认</Tag>
                ),
            },
            {
              title: "来源",
              dataIndex: "source",
              render: (value) => value ?? "—",
            },
          ]}
        />
      </Card>
      <Card
        className={styles.card}
        title="考勤规则版本"
        extra={
          <Button
            size="small"
            icon={<PlusOutlined />}
            onClick={() => setDrawer("attendance")}
          >
            新增考勤规则
          </Button>
        }
      >
        <Table
          size="small"
          rowKey="id"
          loading={attendanceRules.isLoading}
          dataSource={attendanceRules.data ?? []}
          pagination={false}
          scroll={{ x: 800 }}
          locale={{ emptyText: "暂无考勤规则" }}
          columns={[
            { title: "版本", dataIndex: "version" },
            {
              title: "有效期",
              render: (_, row) => (
                <span className={styles.mono}>
                  {row.effective_from} 至 {row.effective_to ?? "长期"}
                </span>
              ),
            },
            {
              title: "标准工时",
              dataIndex: "standard_hours",
              render: (value) => `${value} 小时`,
            },
            {
              title: "忘打卡",
              dataIndex: "missed_punch_amount",
              render: (value) => `${value} 元/次`,
            },
            {
              title: "免罚",
              render: (_, row) =>
                row.makeup_punch_exempt ? (
                  <Tag color="success">补卡免扣 · P7+</Tag>
                ) : (
                  <Tag>—</Tag>
                ),
            },
            {
              title: "来源",
              dataIndex: "source",
              render: (value) => value ?? "—",
            },
          ]}
        />
      </Card>
      <Drawer
        title={drawer === "city" ? "新增城市规则版本" : "新增考勤规则版本"}
        open={!!drawer}
        onClose={() => setDrawer(null)}
        size="large"
        footer={
          <div className={styles.actions}>
            <Button onClick={() => setDrawer(null)}>取消</Button>
            <Button
              type="primary"
              loading={cityMutation.isPending || attendanceMutation.isPending}
              onClick={() =>
                drawer === "city" ? cityForm.submit() : attendanceForm.submit()
              }
            >
              保存
            </Button>
          </div>
        }
      >
        {drawer === "city" ? (
          <Form
            form={cityForm}
            layout="vertical"
            onFinish={(values) =>
              cityMutation.mutate({
                ...values,
                social_items: values.social_items?.map(
                  (item: Record<string, unknown>) => ({
                    ...item,
                    company_rate: String(item.company_rate),
                    employee_rate: String(item.employee_rate),
                  }),
                ),
              })
            }
            initialValues={{
              housing_company_rate: "0.05",
              housing_employee_rate: "0.05",
            }}
          >
            <div className={styles.fieldGrid}>
              <Form.Item
                name="city_id"
                label="城市"
                rules={[{ required: true }]}
              >
                <select aria-label="城市" style={{ width: "100%", height: 32 }}>
                  <option value="">请选择</option>
                  {(cities.data ?? []).map((city) => (
                    <option key={city.id} value={city.id}>
                      {city.code} {city.name}
                    </option>
                  ))}
                </select>
              </Form.Item>
              <Form.Item
                name="version"
                label="版本号"
                rules={[{ required: true }]}
              >
                <Input placeholder="如 v2026.1" />
              </Form.Item>
              <Form.Item
                name="fixed_base"
                label="社保固定缴费基数"
                rules={[{ required: true }]}
              >
                <InputNumber min={0} className={styles.full} />
              </Form.Item>
              <Form.Item
                name="effective_from"
                label="生效日期"
                rules={[{ required: true }]}
              >
                <Input type="date" />
              </Form.Item>
              <Form.Item name="effective_to" label="结束日期">
                <Input type="date" />
              </Form.Item>
              <Form.Item name="source" label="来源" className={styles.full}>
                <Input placeholder="政策文件或内部说明" />
              </Form.Item>
            </div>
            <Form.List name="social_items">
              {(fields, { add, remove }) => (
                <>
                  <Typography.Text strong>险种比例</Typography.Text>
                  {fields.map((field) => (
                    <Space key={field.key} align="baseline" wrap>
                      <Form.Item
                        key={`${field.key}-code`}
                        name={[field.name, "item_code"]}
                        rules={[{ required: true }]}
                      >
                        <Input placeholder="代码" />
                      </Form.Item>
                      <Form.Item
                        key={`${field.key}-name`}
                        name={[field.name, "item_name"]}
                        rules={[{ required: true }]}
                      >
                        <Input placeholder="险种名称" />
                      </Form.Item>
                      <Form.Item
                        key={`${field.key}-employee`}
                        name={[field.name, "employee_rate"]}
                        rules={[{ required: true }]}
                      >
                        <Input placeholder="个人比例" />
                      </Form.Item>
                      <Form.Item
                        key={`${field.key}-company`}
                        name={[field.name, "company_rate"]}
                        rules={[{ required: true }]}
                      >
                        <Input placeholder="公司比例" />
                      </Form.Item>
                      <Button onClick={() => remove(field.name)}>删除</Button>
                    </Space>
                  ))}
                  <Button type="dashed" onClick={() => add()}>
                    添加险种
                  </Button>
                </>
              )}
            </Form.List>
          </Form>
        ) : (
          <Form
            form={attendanceForm}
            layout="vertical"
            onFinish={(values) => attendanceMutation.mutate(values)}
            initialValues={{
              standard_hours: "8",
              missed_punch_amount: "30",
              exempt_level_number: 7,
              makeup_punch_exempt: true,
            }}
          >
            <div className={styles.fieldGrid}>
              <Form.Item
                name="version"
                label="版本号"
                rules={[{ required: true }]}
              >
                <Input />
              </Form.Item>
              <Form.Item name="source" label="来源">
                <Input />
              </Form.Item>
              <Form.Item
                name="effective_from"
                label="生效日期"
                rules={[{ required: true }]}
              >
                <Input type="date" />
              </Form.Item>
              <Form.Item name="effective_to" label="结束日期">
                <Input type="date" />
              </Form.Item>
              <Form.Item name="standard_hours" label="每日标准工时">
                <Input disabled />
              </Form.Item>
              <Form.Item name="missed_punch_amount" label="忘打卡罚款">
                <Input disabled />
              </Form.Item>
              <Form.Item name="exempt_level_number" label="免考勤罚款职级">
                <Input disabled />
              </Form.Item>
              <Form.Item name="makeup_punch_exempt" label="补卡免扣">
                <Input disabled value="是" />
              </Form.Item>
            </div>
          </Form>
        )}
      </Drawer>
    </div>
  );
}
