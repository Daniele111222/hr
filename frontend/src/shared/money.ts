/** 展示后端金额文本，保留精度，不参与工资计算。 */
export function money(value: unknown): string {
  if (typeof value !== "string" || !/^-?\d+(\.\d{1,2})?$/.test(value))
    return "—";
  const [whole, fraction = ""] = value.split(".");
  return `¥${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction.padEnd(2, "0")}`;
}
