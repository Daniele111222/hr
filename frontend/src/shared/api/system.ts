import { queryOptions } from "@tanstack/react-query";
import { apiClient } from "./client.ts";

export const systemHealthQueryOptions = queryOptions({
  queryKey: ["system", "health"],
  queryFn: async () => {
    const { data, error } = await apiClient.GET("/health");

    if (error || !data) {
      throw new Error("无法连接本机服务");
    }

    return data;
  },
});
