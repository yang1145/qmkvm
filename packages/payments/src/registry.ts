/**
 * 网关注册表：外部网关经 registerGateway 注册实例；内置网关（mock/alipay/wechat）
 * 按 settings 表 `payment.gateways` 的 key 装配。
 *
 * 可扩展性约定（硬性要求）：新增网关 = 新文件实现 PaymentGateway 接口 +
 * registerGateway(gateway) 注册，不修改任何既有网关代码。
 */

import { eq } from "drizzle-orm";
import { schema } from "@pinhaoji/db/client";
import { logger } from "@pinhaoji/logger";
import type { DbLike } from "@pinhaoji/core";
import type {
  AlipayGatewayConfig,
  MockGatewayConfig,
  PaymentGateway,
  PaymentGatewayCode,
  WechatGatewayConfig,
} from "./types.js";
import { decodeGatewaySetting } from "./settings-crypto.js";
import { createMockGateway } from "./mock.js";
import { createAlipayGateway } from "./alipay.js";
import { createWechatGateway } from "./wechat.js";

const log = logger.child({ module: "payments:registry" });

/** settings 表中网关配置的 key */
export const PAYMENT_GATEWAYS_SETTING_KEY = "payment.gateways";

/** 外部注册的网关实例（code → 实例；同名注册覆盖） */
const registered = new Map<string, PaymentGateway>();

/** 注册外部网关实例（显式注册优先于内置装配，可覆盖同 code 内置网关） */
export function registerGateway(gateway: PaymentGateway): void {
  registered.set(gateway.code, gateway);
  log.info({ code: gateway.code }, "已注册外部支付网关");
}

/** 读取已注册的外部网关实例 */
export function getRegisteredGateway(code: string): PaymentGateway | undefined {
  return registered.get(code);
}

async function readGatewaysSetting(db: DbLike): Promise<Record<string, unknown>> {
  const rows = await db
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, PAYMENT_GATEWAYS_SETTING_KEY))
    .limit(1);
  const raw = rows[0]?.value;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

/** 按 code 构造内置网关；配置缺失/不完整或显式 enabled=false 时返回 undefined */
function buildBuiltIn(code: string, raw: unknown): PaymentGateway | undefined {
  if (raw !== null && typeof raw === "object" && (raw as Record<string, unknown>).enabled === false) {
    log.info({ code }, "网关在 settings 中标记 enabled=false，跳过装配");
    return undefined;
  }
  const config = raw === undefined ? {} : decodeGatewaySetting(raw);
  if (code === "mock") {
    return createMockGateway(config as Partial<MockGatewayConfig>);
  }
  if (code === "alipay") {
    const gateway = createAlipayGateway(config as Partial<AlipayGatewayConfig>);
    if (!gateway.isConfigured()) {
      log.warn("alipay 网关配置不完整（需 appId/privateKey/alipayPublicKey），未装配");
      return undefined;
    }
    return gateway;
  }
  if (code === "wechat") {
    const gateway = createWechatGateway(config as Partial<WechatGatewayConfig>);
    if (!gateway.isConfigured()) {
      log.warn(
        "wechat 网关配置不完整（需 mchid/appid/serial/privateKey/apiv3Key 及平台证书或公钥），未装配",
      );
      return undefined;
    }
    return gateway;
  }
  // 未知 code：仅由 registerGateway 注册的实例提供
  return undefined;
}

/** 按网关 code 取单个网关（settings 配置 + 外部注册） */
export async function getGateway(db: DbLike, code: string): Promise<PaymentGateway | undefined> {
  const external = registered.get(code);
  if (external) return external;
  const setting = await readGatewaysSetting(db);
  return buildBuiltIn(code, setting[code]);
}

/**
 * 按 settings `payment.gateways` 的 key 装配全部可用网关：
 * - 内置网关按 settings key 装配（配置缺失/不完整 → undefined）；
 * - mock 恒可用（无配置也注册）；
 * - 外部注册实例最后覆盖（显式注册优先）。
 */
export async function createGateways(
  db: DbLike,
): Promise<Record<PaymentGatewayCode, PaymentGateway | undefined>> {
  const setting = await readGatewaysSetting(db);
  const out: Record<string, PaymentGateway | undefined> = {};
  for (const [code, raw] of Object.entries(setting)) {
    const gateway = buildBuiltIn(code, raw);
    if (gateway) out[code] = gateway;
  }
  out.mock ??= createMockGateway({});
  for (const [code, gateway] of registered) {
    out[code] = gateway;
  }
  return out;
}
