import type { BillingCycle } from "@pinhaoji/contracts";

/**
 * 金额展示：整数分 → "¥39.00"。
 * 纯字符串运算，避免浮点误差（金额计算全链路在服务端，前端仅展示）。
 */
export function formatCny(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const yuan = Math.floor(abs / 100);
  const fen = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}¥${yuan.toLocaleString("en-US")}.${fen}`;
}

/** ISO 8601 → "2026-09-06 14:30"（本地时区） */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ISO 8601 / "YYYY-MM-DD" → "2026-09-06" */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const CYCLE_LABELS: Record<BillingCycle, string> = {
  onetime: "一次性",
  monthly: "月付",
  quarterly: "季付",
  semiannually: "半年付",
  annually: "年付",
  biennially: "两年付",
  triennially: "三年付",
};

export function cycleLabel(cycle: BillingCycle): string {
  return CYCLE_LABELS[cycle] ?? cycle;
}

export const BILLING_CYCLES = Object.keys(CYCLE_LABELS) as BillingCycle[];
