/**
 * 供应模块 SDK 类型定义（SPEC-P0 §2.5）。
 *
 * 供应模块 = 对某一类外部资源的开通/暂停/恢复/终止/变更套餐的适配器。
 * runner（任务执行器）按 service.moduleCode 从 registry 取模块并执行对应动作，
 * 再根据 ModuleResult 推进服务状态（manual 结果除外）。
 */
import type { BillingCycle } from "@pinhaoji/contracts";
import type { Db } from "@pinhaoji/db/client";
import type { Logger } from "@pinhaoji/logger";
import type { ServiceRow } from "@pinhaoji/core";

/** 模块配置（service.moduleConfig 与商品 moduleConfig 合并后的结果，service 优先） */
export type ModuleConfig = Record<string, unknown>;

/** 模块执行上下文：db 连接与日志器 */
export interface ModuleCtx {
  db: Db;
  logger: Logger;
}

/** 模块动作结果 */
export interface ModuleResult {
  ok: boolean;
  /** true 表示任务标记 succeeded 但服务状态由后台人工操作推进（runner 不改服务） */
  manual?: boolean;
  /** 交付信息（IP/密码等），provision 成功时由 runner 合并写入 service.deliverInfo */
  deliverInfo?: Record<string, unknown>;
  message?: string;
  /** 原始响应（写入 task.result 便于排查） */
  raw?: Record<string, unknown>;
}

/** change_package 动作的目标套餐 */
export interface ChangePackageTarget {
  productId: number;
  cycle: BillingCycle;
  config: Record<string, unknown>;
}

/** 连接测试结果 */
export interface TestConnectionResult {
  ok: boolean;
  message?: string;
}

/** 标准供应动作（ProvisionModule.supportedActions 缺省即为全部） */
export const STANDARD_MODULE_ACTIONS = [
  "provision",
  "suspend",
  "unsuspend",
  "terminate",
  "change_package",
] as const;

/**
 * 供应模块接口：新增模块 = 实现本接口 + registerModule 注册，不改既有代码。
 */
export interface ProvisionModule {
  code: string;
  name: string;
  /** 模块描述（后台「供应模块」管理页展示用，可选） */
  description?: string;
  /** 模块支持的动作（缺省视为支持全部标准动作；http-api 以商品 moduleConfig.actions 实际配置为准） */
  supportedActions?: string[];
  testConnection(config: ModuleConfig | null): Promise<TestConnectionResult>;
  provision(ctx: ModuleCtx, service: ServiceRow): Promise<ModuleResult>;
  suspend(ctx: ModuleCtx, service: ServiceRow): Promise<ModuleResult>;
  unsuspend(ctx: ModuleCtx, service: ServiceRow): Promise<ModuleResult>;
  terminate(ctx: ModuleCtx, service: ServiceRow): Promise<ModuleResult>;
  changePackage(
    ctx: ModuleCtx,
    service: ServiceRow,
    target: ChangePackageTarget,
  ): Promise<ModuleResult>;
}
