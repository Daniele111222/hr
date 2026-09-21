import {
  ApartmentOutlined,
  CalculatorOutlined,
  DashboardOutlined,
  DownloadOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Layout, Menu, Tag, Typography } from "antd";
import type { MenuProps } from "antd";
import { Suspense } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { resources } from "../shared/api/resources.ts";
import styles from "./AppLayout.module.less";

const navigation: MenuProps["items"] = [
  {
    type: "group",
    label: "概览",
    children: [{ key: "/", icon: <DashboardOutlined />, label: "月度工作台" }],
  },
  {
    type: "group",
    label: "基础资料",
    children: [
      {
        key: "/organization",
        icon: <ApartmentOutlined />,
        label: "组织管理",
      },
      { key: "/employees", icon: <TeamOutlined />, label: "员工管理" },
    ],
  },
  {
    type: "group",
    label: "工资处理",
    children: [
      { key: "/imports", icon: <UploadOutlined />, label: "数据导入" },
      { key: "/payroll", icon: <CalculatorOutlined />, label: "工资核算" },
    ],
  },
  {
    type: "group",
    label: "规则与结果",
    children: [
      {
        key: "/rules",
        icon: <SafetyCertificateOutlined />,
        label: "规则维护",
      },
      { key: "/exports", icon: <DownloadOutlined />, label: "结果导出" },
    ],
  },
];

const routeMeta: Record<string, { group: string; title: string }> = {
  "/": { group: "概览", title: "月度工作台" },
  "/organization": { group: "基础资料", title: "组织管理" },
  "/employees": { group: "基础资料", title: "员工管理" },
  "/imports": { group: "工资处理", title: "数据导入" },
  "/payroll": { group: "工资处理", title: "工资核算" },
  "/rules": { group: "规则与结果", title: "规则维护" },
  "/exports": { group: "规则与结果", title: "结果导出" },
};

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const company = useQuery({
    queryKey: ["org", "company"],
    queryFn: resources.company,
  });
  const current = routeMeta[location.pathname] ?? routeMeta["/"];

  return (
    <Layout className={styles.shell}>
      <Layout.Sider
        className={styles.sidebar}
        breakpoint="lg"
        collapsedWidth={0}
        width={236}
      >
        <div className={styles.brand}>
          <div className={styles.brandLine}>
            <span className={styles.brandMark} aria-hidden="true">
              薪
            </span>
            <Typography.Text className={styles.brandTitle}>
              轻算薪
            </Typography.Text>
          </div>
          <div className={styles.organizationName}>
            <ApartmentOutlined />
            <span>{company.data?.name ?? "目标公司未初始化"}</span>
          </div>
          <Typography.Text className={styles.brandSubtitle}>
            工资计算与核对 · 本地运行
          </Typography.Text>
        </div>
        <Menu
          className={styles.menu}
          mode="inline"
          items={navigation}
          selectedKeys={[location.pathname]}
          onClick={({ key }) => navigate(key)}
        />
        <div className={styles.localNote}>
          <span className={styles.localDot} />
          数据仅保存在本机
        </div>
      </Layout.Sider>
      <Layout className={styles.main}>
        <Layout.Header className={styles.header}>
          <div className={styles.crumb}>
            <span>{current.group}</span>
            <span className={styles.separator}>/</span>
            <strong>{current.title}</strong>
          </div>
          <div className={styles.headerActions}>
            <span className={styles.periodLabel}>工资期间</span>
            <span className={styles.periodValue}>尚未选择</span>
            <Tag color="blue" bordered={false}>
              本地运行
            </Tag>
          </div>
        </Layout.Header>
        <Layout.Content className={styles.content}>
          <Suspense
            fallback={<div className={styles.routeLoading}>正在加载…</div>}
          >
            <Outlet />
          </Suspense>
        </Layout.Content>
        <Layout.Footer className={styles.footer}>
          <span>轻算薪 · 本地部署</span>
          <span>系统金额均为“未扣个税金额”</span>
        </Layout.Footer>
      </Layout>
    </Layout>
  );
}
