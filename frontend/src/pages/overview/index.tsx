import {
  ApartmentOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Alert, Card, Flex, Steps, Tag, Typography } from "antd";
import { resources } from "../../shared/api/resources.ts";
import { systemHealthQueryOptions } from "../../shared/api/system.ts";
import styles from "./index.module.less";

const payrollSteps = [
  { title: "资料准备" },
  { title: "考勤导入" },
  { title: "绩效导入" },
  { title: "工资试算" },
  { title: "考勤激励" },
  { title: "确认锁定" },
  { title: "结果导出" },
];

export function OverviewPage() {
  const health = useQuery(systemHealthQueryOptions);
  const company = useQuery({
    queryKey: ["org", "company"],
    queryFn: resources.company,
  });
  const employees = useQuery({
    queryKey: ["employees"],
    queryFn: resources.employees,
  });
  const connected = health.data?.status === "ok";
  const activeEmployees = (employees.data ?? []).filter(
    (employee) => employee.active,
  ).length;

  return (
    <div className={styles.page}>
      <section className={styles.pageLead}>
        <div>
          <Typography.Title>工资核对工作台</Typography.Title>
          <Typography.Paragraph type="secondary">
            按“资料准备 → 月度导入 → 工资试算 →
            确认导出”推进；系统金额均为未扣个税金额。
          </Typography.Paragraph>
        </div>
        <Tag
          color={
            connected ? "success" : health.isPending ? "processing" : "warning"
          }
        >
          {connected
            ? "本机服务已连接"
            : health.isPending
              ? "正在连接本机服务"
              : "本机服务未连接"}
        </Tag>
      </section>

      <section className={styles.metrics} aria-label="当前准备状态">
        <Card className={styles.metric}>
          <div className={styles.metricLabel}>
            <ApartmentOutlined /> 目标公司
          </div>
          <div className={styles.metricValue}>
            {company.isPending ? "读取中" : (company.data?.name ?? "未初始化")}
          </div>
          <div className={styles.metricFoot}>单公司模式</div>
        </Card>
        <Card className={styles.metric}>
          <div className={styles.metricLabel}>
            <TeamOutlined /> 在职员工
          </div>
          <div className={styles.metricNumber}>
            {employees.isPending ? "—" : activeEmployees}
            {!employees.isPending ? <small> 人</small> : null}
          </div>
          <div className={styles.metricFoot}>来自员工当前资料</div>
        </Card>
        <Card className={styles.metric}>
          <div className={styles.metricLabel}>
            <ClockCircleOutlined /> 当前工资期间
          </div>
          <div className={styles.metricValue}>尚未选择</div>
          <div className={styles.metricFoot}>期间功能尚未实现</div>
        </Card>
        <Card className={styles.metric}>
          <div className={styles.metricLabel}>
            <CheckCircleOutlined /> 月度流程
          </div>
          <div className={styles.metricValue}>等待开始</div>
          <div className={styles.metricFoot}>先完成基础资料</div>
        </Card>
      </section>

      <Card
        className={styles.workflow}
        title="月度处理流程"
        extra={
          <Typography.Text type="secondary">整体进度 0 / 7</Typography.Text>
        }
      >
        <Steps current={0} items={payrollSteps} responsive />
      </Card>

      <div className={styles.noticeGrid}>
        {!connected && !health.isPending ? (
          <Alert
            type="warning"
            showIcon
            title="无法连接本机服务"
            description="请确认 FastAPI 已在 127.0.0.1:31000 启动，然后刷新页面。"
          />
        ) : (
          <Alert
            type="info"
            showIcon
            title="输出口径"
            description="导出后在 Excel 中计算并扣除个税；系统结果不代表最终实际到账金额。"
          />
        )}
        <Card className={styles.nextStep} title="下一步">
          <Flex vertical gap={6}>
            <Typography.Text strong>完善公司、主体与员工资料</Typography.Text>
            <Typography.Text type="secondary">
              月度导入和工资核算将在对应业务竖切中开放。
            </Typography.Text>
          </Flex>
        </Card>
      </div>
    </div>
  );
}
