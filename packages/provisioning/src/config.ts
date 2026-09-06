/**
 * 模块配置解析：service.moduleConfig 与商品 moduleConfig 合并（service 优先）。
 * service.moduleConfig 是创建服务时的商品配置快照，商品侧后续更新经此处生效。
 */
import { eq } from "drizzle-orm";
import { schema, type Db } from "@pinhaoji/db/client";
import type { ServiceRow } from "@pinhaoji/core";
import type { ModuleConfig } from "./types.js";

/**
 * 合并模块配置：商品 moduleConfig 为底、service.moduleConfig 覆盖（service 优先）。
 * 两者均可能为空，返回普通对象（无配置时为空对象）。
 */
export function mergeModuleConfig(
  serviceConfig: unknown,
  productConfig: unknown,
): ModuleConfig {
  return {
    ...((productConfig ?? {}) as ModuleConfig),
    ...((serviceConfig ?? {}) as ModuleConfig),
  };
}

/**
 * 读取服务最终生效的模块配置（含商品侧配置合并）。
 * 商品不存在（已删除）时退化为 service.moduleConfig 快照。
 */
export async function resolveModuleConfig(ctxDb: Db, service: ServiceRow): Promise<ModuleConfig> {
  const rows = await ctxDb
    .select({ moduleConfig: schema.products.moduleConfig })
    .from(schema.products)
    .where(eq(schema.products.id, service.productId))
    .limit(1);
  return mergeModuleConfig(service.moduleConfig, rows[0]?.moduleConfig);
}
