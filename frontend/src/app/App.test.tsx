import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("展示工资核对工作台和核心流程", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>(() => undefined)),
  );
  const { default: App } = await import("./App.tsx");

  render(<App />);

  expect(
    await screen.findByRole("heading", { name: "工资核对工作台" }),
  ).toBeInTheDocument();
  expect(screen.getByText("工资试算")).toBeInTheDocument();
  expect(screen.getByText("正在连接本机服务")).toBeInTheDocument();
});
