import { useQuery } from "@tanstack/react-query";
import { Alert, Flex, Steps, Tag, Typography } from "antd";
import { systemHealthQueryOptions } from "../shared/api/system.ts";
import styles from "./OverviewPage.module.css";

const payrollSteps = [
  { title: "准备基础数据", content: "员工、城市规则" },
  { title: "导入月度数据", content: "考勤、绩效" },
  { title: "工资试算", content: "检查错误和明细" },
  { title: "确认并导出", content: "整批通过后执行" },
];

export function OverviewPage() {
  const health = useQuery(systemHealthQueryOptions);
  const connected = health.data?.status === "ok";

  return (
    <div className={styles.page}>
      <Flex
        className={styles.heading}
        justify="space-between"
        align="start"
        gap={20}
      >
        <div>
          <Typography.Title>工资核对工作台</Typography.Title>
          <Typography.Paragraph type="secondary" className={styles.intro}>
            从数据准备到工资导出，每一步都保留校验结果和来源。
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
      </Flex>

      <section className={styles.workflow} aria-labelledby="workflow-title">
        <Flex justify="space-between" align="center" gap={16} wrap>
          <div>
            <Typography.Title id="workflow-title" level={3}>
              开始一个工资期间
            </Typography.Title>
            <Typography.Text type="secondary">
              选择期间后，系统将按批次状态引导后续操作。
            </Typography.Text>
          </div>
          <Tag variant="filled">尚未开始</Tag>
        </Flex>
        <Steps
          className={styles.steps}
          current={0}
          items={payrollSteps}
          responsive
        />
      </section>

      {!connected && !health.isPending ? (
        <Alert
          className={styles.alert}
          type="warning"
          showIcon
          title="无法连接本机服务"
          description="请确认 FastAPI 已在 127.0.0.1:8000 启动，然后刷新页面。"
        />
      ) : null}
    </div>
  );
}
