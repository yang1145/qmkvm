/**
 * 任务域 → 队列组映射与启动参数解析。
 * --group 必须是 QUEUE_GROUPS 之一；缺省为 tx（兼容既有部署）。
 */
import { QUEUE_GROUPS } from "@qmkvm/core";
import type { QueueGroup } from "@qmkvm/core";

export type { QueueGroup };

export function parseWorkerGroup(argv: string[]): QueueGroup {
  const idx = argv.indexOf("--group");
  const raw = idx >= 0 ? argv[idx + 1]?.trim() : undefined;
  if (!raw) return "tx";
  if (!(QUEUE_GROUPS as readonly string[]).includes(raw)) {
    throw new Error(`未知 worker 分组：${raw}（可选：${QUEUE_GROUPS.join("/")}）`);
  }
  return raw as QueueGroup;
}