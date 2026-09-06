/**
 * 演示模块（demo）：不调用任何外部系统，直接模拟开通成功。
 * provision 返回随机内网 IP + 12 位随机 root 密码作为交付信息，
 * 用于全链路联调（下单 → 支付 → 供应 → 门户展示交付信息）。
 */
import { randomInt } from "node:crypto";
import { STANDARD_MODULE_ACTIONS } from "../types.js";
import type {
  ChangePackageTarget,
  ModuleCtx,
  ModuleResult,
  ModuleConfig,
  ProvisionModule,
  TestConnectionResult,
} from "../types.js";

const PASSWORD_ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** 生成 length 位随机密码（crypto 随机，避免 0/O/1/l 易混字符） */
export function generateRandomPassword(length = 12): string {
  let password = "";
  for (let i = 0; i < length; i += 1) {
    password += PASSWORD_ALPHABET[randomInt(0, PASSWORD_ALPHABET.length)];
  }
  return password;
}

/** 模拟分配内网 IP：10.0.0.2 ~ 10.0.0.254 */
export function generateRandomIp(): string {
  return `10.0.0.${randomInt(2, 255)}`;
}

export const demoModule: ProvisionModule = {
  code: "demo",
  name: "演示模块（无外部调用）",
  description: "模拟开通并回填随机 IP/密码交付信息，用于全链路联调，不调用外部系统",
  supportedActions: [...STANDARD_MODULE_ACTIONS],

  async testConnection(_config: ModuleConfig | null): Promise<TestConnectionResult> {
    return { ok: true, message: "演示模块无外部依赖，连接测试恒通过" };
  },

  async provision(_ctx: ModuleCtx, service): Promise<ModuleResult> {
    return {
      ok: true,
      message: "演示实例开通成功",
      deliverInfo: {
        ip: generateRandomIp(),
        rootPassword: generateRandomPassword(12),
      },
      raw: { module: "demo", serviceId: service.id, simulated: true },
    };
  },

  async suspend(_ctx: ModuleCtx, service): Promise<ModuleResult> {
    return { ok: true, message: `演示实例 #${service.id} 已暂停（模拟）` };
  },

  async unsuspend(_ctx: ModuleCtx, service): Promise<ModuleResult> {
    return { ok: true, message: `演示实例 #${service.id} 已恢复（模拟）` };
  },

  async terminate(_ctx: ModuleCtx, service): Promise<ModuleResult> {
    return { ok: true, message: `演示实例 #${service.id} 已终止销毁（模拟）` };
  },

  async changePackage(
    _ctx: ModuleCtx,
    service,
    target: ChangePackageTarget,
  ): Promise<ModuleResult> {
    return {
      ok: true,
      message: `演示实例 #${service.id} 已变更为商品 #${target.productId}（模拟）`,
    };
  },
};
