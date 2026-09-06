/**
 * 供应模块注册表：code → ProvisionModule。
 * 内置 manual / demo / http-api / pve；自定义模块经 registerModule 扩展，无需改既有代码。
 */
import type { ProvisionModule } from "./types.js";
import { manualModule } from "./modules/manual.js";
import { demoModule } from "./modules/demo.js";
import { httpApiModule } from "./modules/http-api.js";
import { pveModule } from "./modules/pve.js";

const modules = new Map<string, ProvisionModule>();

/** 注册模块（同 code 重复注册覆盖并告警） */
export function registerModule(module: ProvisionModule): void {
  if (modules.has(module.code)) {
    console.warn(`[provisioning] 模块 ${module.code} 重复注册，已覆盖`);
  }
  modules.set(module.code, module);
}

/** 按模块 code 取模块（未知 code 返回 undefined） */
export function getModule(code: string): ProvisionModule | undefined {
  return modules.get(code);
}

/** 已注册模块列表（后台商品表单下拉用） */
export function listModules(): ProvisionModule[] {
  return [...modules.values()];
}

// 注册内置模块
registerModule(manualModule);
registerModule(demoModule);
registerModule(httpApiModule);
registerModule(pveModule);
