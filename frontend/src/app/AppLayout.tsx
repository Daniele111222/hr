import { Layout, Menu, Typography } from "antd";
import type { MenuProps } from "antd";
import { Suspense } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import styles from "./AppLayout.module.less";

const navigation: MenuProps["items"] = [
  { key: "/", label: "工作台" },
  { key: "/organization", label: "公司与组织" },
  { key: "/employees", label: "员工管理" },
  { key: "/imports", label: "数据导入" },
  { key: "/payroll", label: "工资核算" },
  { key: "/rules", label: "规则维护" },
  { key: "/exports", label: "结果导出" },
];

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <Layout className={styles.shell}>
      <Layout.Sider
        className={styles.sidebar}
        breakpoint="lg"
        collapsedWidth={0}
        width={232}
      >
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">
            轻
          </span>
          <div>
            <Typography.Title level={4} className={styles.brandTitle}>
              轻算薪
            </Typography.Title>
            <Typography.Text className={styles.brandSubtitle}>
              PayLite
            </Typography.Text>
          </div>
        </div>
        <Menu
          className={styles.menu}
          mode="inline"
          items={navigation}
          selectedKeys={[location.pathname]}
          onClick={({ key }) => navigate(key)}
        />
        <div className={styles.localNote}>数据仅保存在本机</div>
      </Layout.Sider>
      <Layout>
        <Layout.Header className={styles.header}>
          <div>
            <Typography.Text type="secondary">当前工资期间</Typography.Text>
            <Typography.Title level={5} className={styles.period}>
              尚未选择
            </Typography.Title>
          </div>
        </Layout.Header>
        <Layout.Content className={styles.content}>
          <Suspense
            fallback={<div className={styles.routeLoading}>正在加载…</div>}
          >
            <Outlet />
          </Suspense>
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
