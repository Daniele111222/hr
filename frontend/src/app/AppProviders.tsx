import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntdApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import type { PropsWithChildren } from "react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: "#315fd1",
          colorInfo: "#315fd1",
          colorSuccess: "#2d9461",
          colorWarning: "#a66b16",
          colorError: "#c74343",
          colorText: "#273142",
          colorTextSecondary: "#687386",
          colorBorderSecondary: "#e4e8ef",
          colorBgLayout: "#f6f7f9",
          borderRadius: 6,
          controlHeight: 32,
          fontSize: 13,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
        },
        components: {
          Card: { headerHeight: 44, bodyPadding: 16 },
          Table: { cellPaddingBlock: 9, cellPaddingInline: 12 },
          Drawer: { padding: 18 },
        },
      }}
    >
      <AntdApp>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </AntdApp>
    </ConfigProvider>
  );
}
