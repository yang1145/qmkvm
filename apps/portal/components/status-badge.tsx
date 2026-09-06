import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Tone = "success" | "warning" | "danger" | "info" | "muted" | "secondary";

const TONE_CLASS: Record<Tone, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  danger: "border-red-200 bg-red-50 text-red-700",
  info: "border-blue-200 bg-blue-50 text-blue-700",
  muted: "border-border bg-muted text-muted-foreground",
  secondary: "border-transparent bg-secondary text-secondary-foreground",
};

function Dot({ tone }: { tone: Tone }) {
  const color: Record<Tone, string> = {
    success: "bg-emerald-500",
    warning: "bg-amber-500",
    danger: "bg-red-500",
    info: "bg-blue-500",
    muted: "bg-muted-foreground/50",
    secondary: "bg-secondary-foreground/50",
  };
  return <span className={cn("h-1.5 w-1.5 rounded-full", color[tone])} />;
}

function StatusBadge({
  label,
  tone,
  dot,
}: {
  label: string;
  tone: Tone;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONE_CLASS[tone],
      )}
    >
      {dot ? <Dot tone={tone} /> : null}
      {label}
    </span>
  );
}

/** 账单状态徽章 */
export function InvoiceStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; tone: Tone }> = {
    unpaid: { label: "待支付", tone: "warning" },
    paid: { label: "已支付", tone: "success" },
    void: { label: "已作废", tone: "muted" },
    refunded: { label: "已退款", tone: "info" },
    partially_refunded: { label: "部分退款", tone: "info" },
  };
  const item = map[status] ?? { label: status, tone: "muted" as Tone };
  return <StatusBadge {...item} />;
}

/** 订单状态徽章 */
export function OrderStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; tone: Tone }> = {
    pending: { label: "待支付", tone: "warning" },
    paid: { label: "已支付", tone: "info" },
    processing: { label: "开通中", tone: "info" },
    completed: { label: "已完成", tone: "success" },
    cancelled: { label: "已取消", tone: "muted" },
    failed: { label: "失败", tone: "danger" },
  };
  const item = map[status] ?? { label: status, tone: "muted" as Tone };
  return <StatusBadge {...item} />;
}

/** 服务状态徽章 */
export function ServiceStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; tone: Tone }> = {
    pending: { label: "开通中", tone: "info" },
    active: { label: "运行中", tone: "success" },
    suspended_overdue: { label: "欠费暂停", tone: "danger" },
    suspended_manual: { label: "已暂停", tone: "warning" },
    terminated: { label: "已终止", tone: "muted" },
    cancelled: { label: "已取消", tone: "muted" },
  };
  const item = map[status] ?? { label: status, tone: "muted" as Tone };
  return <StatusBadge {...item} />;
}

/** 工单状态徽章 */
export function TicketStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; tone: Tone }> = {
    open: { label: "待处理", tone: "info" },
    answered: { label: "已回复", tone: "success" },
    customer_reply: { label: "待客服回复", tone: "warning" },
    in_progress: { label: "处理中", tone: "info" },
    resolved: { label: "已解决", tone: "success" },
    closed: { label: "已关闭", tone: "muted" },
  };
  const item = map[status] ?? { label: status, tone: "muted" as Tone };
  return <StatusBadge {...item} />;
}

/** 工单优先级徽章 */
export function TicketPriorityBadge({ priority }: { priority: string }) {
  const map: Record<string, { label: string; tone: Tone }> = {
    low: { label: "低", tone: "muted" },
    medium: { label: "中", tone: "info" },
    high: { label: "高", tone: "warning" },
    urgent: { label: "紧急", tone: "danger" },
  };
  const item = map[priority] ?? { label: priority, tone: "muted" as Tone };
  return <StatusBadge {...item} />;
}

/** 订单类型 / 账单类型文案 */
export function orderTypeLabel(type: string): string {
  const map: Record<string, string> = {
    new: "新购",
    renewal: "续费",
    upgrade: "升级",
    recharge: "充值",
    manual: "人工",
  };
  return map[type] ?? type;
}

export { Badge };
