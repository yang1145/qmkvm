/**
 * supply 组 handler：供应任务执行与退避重试。
 *
 * 职责：provision.task / provision.retry —— 调 provisioning 包执行开通动作。
 * 订阅队列：kvm-supply（分组模式）/ kvm（单队列模式兜底）。
 * 凭据边界：本组是唯一触达 provisioning 包凭据调用点（上游面板/节点凭据）的
 * 组——凭据均由 provisioning 包按 db 配置在运行时读取，本文件不直接持有。
 */
import { getDb } from "@qmkvm/db";
import { registerJobHandler } from "@qmkvm/core";
import { runProvisionTask } from "@qmkvm/provisioning";

type Db = ReturnType<typeof getDb>;

/** supply 组注册：供应任务执行（provision.task）与退避重试（provision.retry） */
export function registerSupplyHandlers(db: Db): void {
  registerJobHandler("provision.task", async (data: { taskId?: number | string }) => {
    await runProvisionTask(db, Number(data?.taskId));
  });

  registerJobHandler("provision.retry", async (data: { taskId?: number | string }) => {
    await runProvisionTask(db, Number(data?.taskId));
  });
}