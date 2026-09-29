import { ArrowLeftOutlined, PlusOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Empty, Form, Input, Modal, Select, Space, Table, Tag, Typography } from "antd";
import { useState } from "react";
import { Link } from "react-router-dom";
import { resources, type PayrollBatch, type PayrollSupplementInput, type PayrollTrial } from "../../shared/api/resources";
import styles from "./batch-detail.module.less";

export function SupplementBatchDetail({ batch, trial }: { batch: PayrollBatch; trial: PayrollTrial | null }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<PayrollSupplementInput>();
  const editable = batch.status === "draft" || batch.status === "trial";
  const inputs = useQuery({
    queryKey: ["payroll", "supplement-inputs", batch.id],
    queryFn: () => resources.payrollSupplementInputs(batch.id),
  });
  const employees = useQuery({ queryKey: ["employees"], queryFn: resources.employees, enabled: editable });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["payroll", "batch", batch.id] });
    queryClient.invalidateQueries({ queryKey: ["payroll", "workbench"] });
    queryClient.invalidateQueries({ queryKey: ["payroll", "ledger"] });
  };
  const save = useMutation({
    mutationFn: (rows: PayrollSupplementInput[]) => resources.savePayrollSupplementInputs(batch.id, rows),
    onSuccess: (rows) => {
      queryClient.setQueryData(["payroll", "supplement-inputs", batch.id], rows);
      queryClient.invalidateQueries({ queryKey: ["payroll", "trial", batch.id] });
      refresh();
      setOpen(false);
      form.resetFields();
      message.success("补发金额已保存，请重新试算");
    },
    onError: (error) => message.error(error.message),
  });
  const run = useMutation({
    mutationFn: () => resources.runPayrollTrial(batch.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll", "trial", batch.id] });
      refresh();
      message.success("独立补发试算完成，请核对结果");
    },
    onError: (error) => message.error(error.message),
  });
  const confirm = useMutation({
    mutationFn: () => resources.confirmPayrollBatch(batch.id),
    onSuccess: () => { refresh(); message.success("独立补发已确认"); },
    onError: (error) => message.error(error.message),
  });
  const lock = useMutation({
    mutationFn: () => resources.lockPayrollBatch(batch.id),
    onSuccess: () => { refresh(); message.success("独立补发已锁定并计入期间台账"); },
    onError: (error) => message.error(error.message),
  });
  const rows = inputs.data ?? [];
  const names = new Map((employees.data ?? []).map((employee) => [employee.id, `${employee.name} · ${employee.employee_no}`]));
  if (!editable) {
    for (const row of trial?.results ?? [])
      names.set(row.employee_id, `${row.employee_name} · ${row.snapshot.employee_no}`);
  }
  const saveRow = (value: PayrollSupplementInput) => {
    const amount = value.amount.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
      message.error("补发金额须为大于零且最多两位小数的数字");
      return;
    }
    save.mutate([...rows.filter((row) => row.employee_id !== value.employee_id), { ...value, amount }]);
  };

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <Typography.Title level={2}>独立补发 · {batch.subject.code}-S{batch.batch_no}</Typography.Title>
          <p>{batch.subject.name} · 补发原因：{batch.name} · 发放日期：{batch.payment_date ?? "未填写"}</p>
        </div>
        <Link className={styles.back} to="/payroll"><ArrowLeftOutlined /> 返回工资期间与批次</Link>
      </header>
      <Alert type="info" showIcon title="补发金额为未扣个税金额" description="独立补发不重算社保、公积金及考勤激励；确认后金额不可直接修改。" />
      <Card title="员工补发输入" extra={editable ? <Button icon={<PlusOutlined />} onClick={() => setOpen(true)}>录入员工金额</Button> : null}>
        {inputs.error ? <Alert type="error" showIcon title="补发输入加载失败" description={inputs.error.message} /> : null}
        {employees.error ? <Alert type="error" showIcon title="员工列表加载失败" description={employees.error.message} /> : null}
        <Table
          rowKey="employee_id" size="small" loading={inputs.isLoading} scroll={{ x: 540 }}
          dataSource={rows} pagination={false}
          locale={{ emptyText: <Empty description="尚未录入员工补发金额" /> }}
          columns={[
            { title: "员工", render: (_: unknown, row: PayrollSupplementInput) => names.get(row.employee_id) ?? `员工 #${row.employee_id}` },
            { title: "补发金额（未扣个税）", dataIndex: "amount", align: "right", render: (value: string) => `¥${value}` },
            { title: "操作", render: (_: unknown, row: PayrollSupplementInput) => editable ? <Space><Button type="link" onClick={() => { form.setFieldsValue(row); setOpen(true); }}>修改</Button><Button type="link" danger onClick={() => save.mutate(rows.filter((item) => item.employee_id !== row.employee_id))}>移除</Button></Space> : <Tag>只读</Tag> },
          ]}
        />
      </Card>
      <Card title="独立试算与核对" extra={<Space wrap>
        {editable ? <Button onClick={() => run.mutate()} disabled={!rows.length || run.isPending} loading={run.isPending}>重新试算</Button> : null}
        {editable ? <Button type="primary" onClick={() => confirm.mutate()} disabled={!trial?.ready_for_confirmation || confirm.isPending} loading={confirm.isPending}>确认补发</Button> : null}
        {batch.status === "confirmed" ? <Button type="primary" onClick={() => lock.mutate()} loading={lock.isPending}>锁定补发</Button> : null}
        {batch.status === "locked" ? <Tag color="success">已锁定</Tag> : null}
      </Space>}>
        {trial?.stale ? <Alert type="warning" showIcon title="补发输入已变化，请重新试算" /> : null}
        {trial?.confirmation_blockers.map((blocker) => <Alert key={blocker} type="warning" showIcon title={blocker} />)}
        {trial ? <>
          <Typography.Paragraph>试算合计：<strong>¥{trial.totals.untaxed_amount}</strong>（未扣个税）</Typography.Paragraph>
          <Table rowKey="employee_id" size="small" scroll={{ x: 540 }} pagination={false} dataSource={trial.results} columns={[
            { title: "员工", dataIndex: "employee_name" },
            { title: "补发金额（未扣个税）", align: "right", render: (_: unknown, row) => `¥${row.amounts?.untaxed_amount ?? "—"}` },
          ]} />
        </> : <Empty description="请录入员工金额并试算" />}
      </Card>
      <Modal title="录入员工补发金额" open={open} onCancel={() => { setOpen(false); form.resetFields(); }} onOk={() => form.submit()} confirmLoading={save.isPending}>
        <Form form={form} layout="vertical" onFinish={saveRow}>
          <Form.Item name="employee_id" label="员工" rules={[{ required: true, message: "请选择员工" }]}>
            <Select showSearch optionFilterProp="label" options={(employees.data ?? []).map((employee) => ({ value: employee.id, label: `${employee.name} · ${employee.employee_no}` }))} placeholder="选择员工" />
          </Form.Item>
          <Form.Item name="amount" label="补发金额（未扣个税）" rules={[{ required: true, message: "请输入补发金额" }, { pattern: /^\d+(\.\d{1,2})?$/, message: "请输入大于零且最多两位小数的金额" }]}>
            <Input inputMode="decimal" placeholder="例如 500.00" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
