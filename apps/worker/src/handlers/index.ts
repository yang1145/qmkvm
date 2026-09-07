/**
 * 处理器组注册总入口：按 --group 参数只注册本组 handler（物理拆分见同目录
 * tx.ts / notify.ts / supply.ts / ocr.ts，每组文件顶部注释说明职责与凭据边界）。
 *
 * 半差异化设计：handler 按任务域分文件，凭据敏感调用只出现在对应组文件里
 * （supply → provisioning 包凭据；tx → 支付网关凭据经 payments 包）；
 * 入口按 --group 决定订阅队列，job 分流由 core 的 queueForJob 路由。
 */
import { getDb } from "@qmkvm/db";
import { getRegisteredJobHandlers } from "@qmkvm/core";
import { registerTxHandlers } from "./tx.js";
import { registerNotifyHandlers } from "./notify.js";
import { registerSupplyHandlers } from "./supply.js";
import { registerOcrHandlers } from "./ocr.js";
import type { QueueGroup } from "../groups.js";

type Db = ReturnType<typeof getDb>;

/** 各组注册函数表（key 与 --group 取值一致） */
const GROUP_REGISTRARS: Record<QueueGroup, (db: Db) => void> = {
  tx: registerTxHandlers,
  notify: registerNotifyHandlers,
  supply: registerSupplyHandlers,
  ocr: registerOcrHandlers,
};

/** 各组自有 job 名（启动日志按组汇总 handler 数量用） */
export const GROUP_JOB_NAMES: Record<QueueGroup, string[]> = {
  tx: ["domain.event", "cron.run", "payment.process_event"],
  notify: ["notify.user"],
  supply: ["provision.task", "provision.retry"],
  ocr: ["ocr.verify"],
};

export function registerJobHandlers(db: Db, group: QueueGroup): void {
  // 兼容单队列模式（QUEUE_ROUTING≠split）：所有 job（含 ocr.verify/cron.run）
  // 都可能落进主队列 kvm，因此每个组都必须注册全量 handler 才能正确分发；
  // 分组模式下入队已按 QUEUE_ROUTING 分流，非本组 handler 注册后也不会收到 job。
  // handler 本身无副作用（不注册就不会被调），注册全量是安全的。
  registerTxHandlers(db);
  registerNotifyHandlers(db);
  registerSupplyHandlers(db);
  registerOcrHandlers(db);
  void group;
}

/** 按组汇总已注册 handler 数量（worker 启动日志/部署核对用） */
export function registeredHandlerCountByGroup(): Record<QueueGroup, number> {
  const registered = getRegisteredJobHandlers();
  const result = {} as Record<QueueGroup, number>;
  for (const group of Object.keys(GROUP_JOB_NAMES) as QueueGroup[]) {
    result[group] = GROUP_JOB_NAMES[group].filter((job) => registered.has(job)).length;
  }
  return result;
}