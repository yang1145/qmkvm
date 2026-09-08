/**
 * 魔方财务供应商管理（zjmf 供应模块的上游代理账号配置）：
 * - GET    /zjmf/suppliers        供应商列表（密码掩码，不回显）
 * - PUT    /zjmf/suppliers/:code  新增/更新（密码明文 → AES-256-GCM 加密落库；掩码/缺省 → 保留既有密文）
 * - DELETE /zjmf/suppliers/:code  删除
 * - POST   /zjmf/suppliers/test   连通测试（按 code 取落库配置，或 supplier 内联临时测试）
 *
 * 配置存 settings 键 provisioning.zjmf.suppliers（JSON 数组，密文格式与支付网关一致）。
 * 商品 moduleConfig 只存 supplierCode 引用 + 上游商品映射（upProductId/upCycles），
 * 密钥不散落在商品表；所有写操作写审计。
 */
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@qmkvm/db";
import type { Json } from "@qmkvm/db/schema";
import { appError, createProvisionTask } from "@qmkvm/core";
import {
  getModule,
  ZJMF_SUPPLIERS_SETTING_KEY,
  findSupplierSetting,
  supplierSettingToConfig,
  parseInlineSupplier,
  encryptSettingValue,
  isEncryptedSettingValue,
  syncSupplierProducts,
  fetchUpstreamHosts,
  fetchUpstreamBalance,
  fetchServiceUpstreamStatus,
  findBoundUpHostIds,
} from "@qmkvm/provisioning";
import { toLocalCycle } from "@qmkvm/provisioning";
import type { ZjmfSupplierSetting } from "@qmkvm/provisioning";
import { requireAdmin } from "../../middleware/auth.js";
import { writeAdminAudit } from "./helpers.js";

export const adminZjmfSupplierRoutes = new Hono();

const MASK = "******";

const supplierUpsertSchema = z.object({
  name: z.string().min(1).max(50),
  baseUrl: z.string().min(1).max(255),
  username: z.string().min(1).max(64),
  /** 明文新密码；缺省或掩码表示保留既有 */
  password: z.string().max(255).optional(),
  apiTimeoutSec: z.number().int().min(1).max(120).optional(),
  allowSelfSigned: z.boolean().optional(),
  allowInsecureUrl: z.boolean().optional(),
  apiTier: z.enum(["member", "admin"]).optional(),
});

const supplierTestSchema = z.object({
  code: z.string().min(1).max(50).optional(),
  supplier: z.record(z.string(), z.unknown()).optional(),
});

async function loadSuppliers(): Promise<ZjmfSupplierSetting[]> {
  const rows = await getDb()
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, ZJMF_SUPPLIERS_SETTING_KEY))
    .limit(1);
  const value = rows[0]?.value;
  return Array.isArray(value) ? (value as ZjmfSupplierSetting[]) : [];
}

async function saveSuppliers(list: ZjmfSupplierSetting[]): Promise<void> {
  // settings.value 列为 Json（对象索引签名）；接口数组需显式转换
  const value = list as unknown as Json;
  await getDb()
    .insert(schema.settings)
    .values({ key: ZJMF_SUPPLIERS_SETTING_KEY, value })
    .onDuplicateKeyUpdate({ set: { value, updatedAt: new Date() } });
}

/** 列表视图：密码不回显，只给 hasPassword */
function toMaskedView(s: ZjmfSupplierSetting) {
  return {
    code: s.code,
    name: s.name,
    baseUrl: s.baseUrl,
    username: s.username,
    hasPassword: isEncryptedSettingValue(s.password) || (typeof s.password === "string" && s.password !== ""),
    apiTimeoutSec: s.apiTimeoutSec ?? 30,
    allowSelfSigned: s.allowSelfSigned === true,
    allowInsecureUrl: s.allowInsecureUrl === true,
    apiTier: s.apiTier ?? "member",
  };
}

adminZjmfSupplierRoutes.get("/zjmf/suppliers", requireAdmin("products.manage"), async (c) => {
  const list = await loadSuppliers();
  return c.json({ items: list.map(toMaskedView) });
});

adminZjmfSupplierRoutes.put("/zjmf/suppliers/:code", requireAdmin("products.manage"), async (c) => {
  const code = c.req.param("code").trim();
  if (!/^[a-zA-Z0-9_-]{1,50}$/.test(code)) {
    throw appError("VALIDATION_FAILED", "供应商 code 仅允许字母/数字/下划线/中划线（≤50 位）");
  }
  const body = supplierUpsertSchema.parse(await c.req.json());
  const admin = c.get("admin");

  const list = await loadSuppliers();
  const idx = list.findIndex((s) => s.code === code);
  const prev = idx >= 0 ? list[idx] : undefined;

  // 密码合并：明文 → 加密；掩码/缺省 → 保留既有密文；新供应商必须提供
  let password = prev?.password;
  if (body.password !== undefined && body.password !== MASK) {
    password = encryptSettingValue(body.password);
  }
  if (password == null || password === "") {
    throw appError("VALIDATION_FAILED", "新供应商必须提供 password（已有供应商留空表示保留原密码）");
  }

  // 默认拒绝明文 http（API 凭据明文传输会泄露）；内网联调可显式 allowInsecureUrl
  const baseUrl = body.baseUrl.trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(baseUrl) && body.allowInsecureUrl !== true) {
    throw appError("VALIDATION_FAILED", "baseUrl 必须为 https；如确需内网 http 请显式传 allowInsecureUrl=true");
  }

  const entry: ZjmfSupplierSetting = {
    code,
    name: body.name.trim(),
    baseUrl,
    username: body.username.trim(),
    password,
    ...(body.apiTimeoutSec !== undefined ? { apiTimeoutSec: body.apiTimeoutSec } : {}),
    ...(body.allowSelfSigned !== undefined ? { allowSelfSigned: body.allowSelfSigned } : {}),
    ...(body.allowInsecureUrl !== undefined ? { allowInsecureUrl: body.allowInsecureUrl } : {}),
    ...(body.apiTier !== undefined ? { apiTier: body.apiTier } : {}),
  };
  if (idx >= 0) list[idx] = entry;
  else list.push(entry);
  await saveSuppliers(list);

  await writeAdminAudit(c, admin, {
    action: idx >= 0 ? "zjmf_supplier.update" : "zjmf_supplier.create",
    targetType: "settings",
    targetId: ZJMF_SUPPLIERS_SETTING_KEY,
    after: { code, baseUrl, username: entry.username } as Record<string, unknown>,
  });
  return c.json({ ok: true, item: toMaskedView(entry) });
});

adminZjmfSupplierRoutes.delete("/zjmf/suppliers/:code", requireAdmin("products.manage"), async (c) => {
  const code = c.req.param("code");
  const admin = c.get("admin");
  const list = await loadSuppliers();
  const next = list.filter((s) => s.code !== code);
  if (next.length === list.length) {
    throw appError("NOT_FOUND", `供应商「${code}」不存在`);
  }
  await saveSuppliers(next);
  await writeAdminAudit(c, admin, {
    action: "zjmf_supplier.delete",
    targetType: "settings",
    targetId: ZJMF_SUPPLIERS_SETTING_KEY,
    before: { code } as Record<string, unknown>,
  });
  return c.json({ ok: true });
});

// ============ 上游商品同步与查询（落库表 zjmf_upstream_products） ============

/** 同步上游商品（拉列表 + 代理价详情，upsert 同步表；商品多时耗时较长） */
adminZjmfSupplierRoutes.post(
  "/zjmf/suppliers/:code/sync-products",
  requireAdmin("products.manage"),
  async (c) => {
    const code = c.req.param("code");
    const admin = c.get("admin");
    await findSupplierSetting(getDb(), code); // 不存在直接 404
    const result = await syncSupplierProducts(getDb(), code);
    await writeAdminAudit(c, admin, {
      action: "zjmf_supplier.sync_products",
      targetType: "settings",
      targetId: ZJMF_SUPPLIERS_SETTING_KEY,
      after: { code, ...result } as Record<string, unknown>,
    });
    return c.json({ ok: true, ...result });
  },
);

/** 已同步的上游商品列表（含本地映射状态：商品表 moduleConfig.supplierCode+upProductId 匹配） */
adminZjmfSupplierRoutes.get("/zjmf/suppliers/:code/products", requireAdmin("products.read"), async (c) => {
  const code = c.req.param("code");
  const rows = await getDb()
    .select()
    .from(schema.zjmfUpstreamProducts)
    .where(eq(schema.zjmfUpstreamProducts.supplierCode, code))
    .orderBy(schema.zjmfUpstreamProducts.upProductId);

  const zjmfProducts = await getDb()
    .select({ id: schema.products.id, name: schema.products.name, moduleConfig: schema.products.moduleConfig })
    .from(schema.products)
    .where(eq(schema.products.moduleCode, "zjmf"));
  const mapped = new Map<string, { id: number; name: string }>();
  for (const p of zjmfProducts) {
    const cfg = (p.moduleConfig ?? {}) as Record<string, unknown>;
    if (cfg.supplierCode !== code) continue;
    const upProductId = Number(cfg.upProductId ?? 0);
    if (upProductId > 0) mapped.set(String(upProductId), { id: p.id, name: p.name });
  }

  return c.json({
    items: rows.map((r) => ({
      upProductId: r.upProductId,
      name: r.name,
      currency: r.currency,
      agentPriceCents: r.agentPriceCents,
      cycles: r.cycles ?? [],
      module: r.module,
      syncedAt: r.syncedAt,
      mappedProduct: mapped.get(String(r.upProductId)) ?? null,
    })),
  });
});

// ============ 上游主机（指派）与余额、服务上游状态 ============

/** 上游账户已开通主机列表（含本地绑定标记，指派页数据源） */
adminZjmfSupplierRoutes.get("/zjmf/suppliers/:code/hosts", requireAdmin("products.manage"), async (c) => {
  const code = c.req.param("code");
  await findSupplierSetting(getDb(), code);
  const hosts = await fetchUpstreamHosts(getDb(), code);
  const bound = await findBoundUpHostIds(
    getDb(),
    hosts.map((h) => h.upHostId),
  );
  return c.json({
    items: hosts.map((h) => ({ ...h, assigned: bound.has(h.upHostId) })),
  });
});

/** 上游账户余额 */
adminZjmfSupplierRoutes.get("/zjmf/suppliers/:code/balance", requireAdmin("products.manage"), async (c) => {
  const code = c.req.param("code");
  await findSupplierSetting(getDb(), code);
  return c.json(await fetchUpstreamBalance(getDb(), code));
});

/** 服务的上游状态（状态查看弹窗） */
adminZjmfSupplierRoutes.get("/zjmf/services/:serviceId/upstream-status", requireAdmin("services.manage"), async (c) => {
  const serviceId = z.coerce.number().int().positive().parse(c.req.param("serviceId"));
  const rows = await getDb()
    .select()
    .from(schema.services)
    .where(eq(schema.services.id, serviceId))
    .limit(1);
  const service = rows[0];
  if (!service) throw appError("NOT_FOUND", `服务不存在（#${serviceId}）`);
  if (service.moduleCode !== "zjmf") {
    throw appError("VALIDATION_FAILED", `服务 #${serviceId} 不是魔方财务模块服务`);
  }
  const status = await fetchServiceUpstreamStatus(getDb(), service);
  return c.json({ upHostId: Number((service.deliverInfo as Record<string, unknown> | null)?.upHostId ?? 0), ...status });
});

const assignSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("bind"),
    /** 供应商 code */
    code: z.string().min(1).max(50),
    /** 上游主机 ID（host/list 中的已开通机器） */
    upHostId: z.number().int().positive(),
    /** 目标客户 */
    userId: z.number().int().positive(),
    /** 挂靠的本地商品（zjmf 模块且映射同一供应商） */
    productId: z.number().int().positive(),
    name: z.string().min(1).max(150).optional(),
  }),
  z.object({
    mode: z.literal("open"),
    code: z.string().min(1).max(50),
    /** 上游商品 ID（需已有本地商品映射到该上游商品） */
    upProductId: z.number().int().positive(),
    userId: z.number().int().positive(),
    name: z.string().min(1).max(150).optional(),
  }),
]);

/**
 * 主机指派：
 * - bind：把上游已开通机器本地绑定给客户（不调上游，纯绑定；状态 active、到期日取上游）。
 * - open：管理员代开——按上游商品找本地映射商品，0 元建服务并走正常开通任务（上游余额支付）。
 */
adminZjmfSupplierRoutes.post("/zjmf/assign", requireAdmin("services.manage"), async (c) => {
  const body = assignSchema.parse(await c.req.json());
  const admin = c.get("admin");
  const db = getDb();

  const userRows = await db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, body.userId))
    .limit(1);
  if (!userRows[0]) throw appError("NOT_FOUND", `目标用户不存在（#${body.userId}）`);

  const supplier = await findSupplierSetting(db, body.code);

  // 本地 zjmf 商品（bind 需显式指定；open 按上游商品自动匹配）
  const zjmfProducts = await db
    .select({ id: schema.products.id, name: schema.products.name, moduleConfig: schema.products.moduleConfig })
    .from(schema.products)
    .where(eq(schema.products.moduleCode, "zjmf"));
  const cfgOf = (p: { moduleConfig: unknown }) => (p.moduleConfig ?? {}) as Record<string, unknown>;

  let product: { id: number; name: string; moduleConfig: unknown };
  if (body.mode === "bind") {
    const found = zjmfProducts.find((p) => p.id === body.productId);
    if (!found) throw appError("NOT_FOUND", `本地商品不存在（#${body.productId}）`);
    if (cfgOf(found).supplierCode !== body.code) {
      throw appError("VALIDATION_FAILED", `商品「${found.name}」未映射到供应商「${body.code}」`);
    }
    product = found;
  } else {
    const found = zjmfProducts.find((p) => Number(cfgOf(p).upProductId ?? 0) === body.upProductId);
    if (!found) {
      throw appError("NOT_FOUND", `上游商品 #${body.upProductId} 尚无本地映射商品，请先创建映射商品`);
    }
    product = found;
  }

  // 商品定价：bind 按上游主机周期匹配，open 取商品第一个周期；续费金额取对应定价
  const pricingRows = await db
    .select()
    .from(schema.productPricing)
    .where(eq(schema.productPricing.productId, product.id));
  const pickCyclePricing = (cycle: string | undefined) => {
    if (cycle) {
      const hit = pricingRows.find((p) => p.cycle === cycle);
      if (hit) return { cycle: hit.cycle, renewalAmount: hit.renewalPrice };
    }
    const first = pricingRows[0];
    return first ? { cycle: first.cycle, renewalAmount: first.renewalPrice } : { cycle: "monthly" as const, renewalAmount: 0 };
  };

  const serviceName = body.name?.trim() || product.name;

  if (body.mode === "bind") {
    // 校验上游主机存在且未被绑定
    const hosts = await fetchUpstreamHosts(db, body.code);
    const host = hosts.find((h) => h.upHostId === body.upHostId);
    if (!host) throw appError("NOT_FOUND", `上游主机 #${body.upHostId} 不存在（请刷新主机列表）`);
    if (host.status === "terminated") {
      throw appError("VALIDATION_FAILED", `上游主机 #${body.upHostId} 已被终止，不可指派`);
    }
    const bound = await findBoundUpHostIds(db, [body.upHostId]);
    if (bound.has(body.upHostId)) {
      throw appError("CONFLICT", `上游主机 #${body.upHostId} 已绑定其他服务`);
    }
    const { cycle, renewalAmount } = pickCyclePricing(toLocalCycle(host.cycle) ?? undefined);

    const inserted = await db
      .insert(schema.services)
      .values({
        userId: body.userId,
        productId: product.id,
        name: serviceName,
        status: "active",
        cycle,
        firstAmount: 0,
        renewalAmount,
        nextDueDate: host.expireAt ?? null,
        moduleCode: "zjmf",
        moduleConfig: (product.moduleConfig ?? {}) as Json,
        deliverInfo: {
          upHostId: host.upHostId,
          upProductId: Number(cfgOf(product).upProductId ?? 0),
          ...(host.username ? { upUsername: host.username } : {}),
          ...(host.productName ? { upProductName: host.productName } : {}),
          ...(host.expireAt ? { upExpireAt: host.expireAt } : {}),
        } as Json,
      });
    const serviceId = inserted[0].insertId;
    await writeAdminAudit(c, admin, {
      action: "zjmf.assign_bind",
      targetType: "service",
      targetId: serviceId,
      after: { code: body.code, upHostId: body.upHostId, userId: body.userId, productId: product.id, cycle, renewalAmount } as Record<string, unknown>,
    });
    return c.json({
      ok: true,
      serviceId,
      message:
        `已绑定上游主机 #${body.upHostId} 为服务 #${serviceId}` +
        (host.expireAt ? `（上游到期日 ${host.expireAt}，本地将按此生成续费账单并同步上游）` : "（上游未返回到期日，请人工核对）"),
    });
  }

  // open：0 元建服务 + 正常开通任务（开通由供应任务执行，上游余额支付）
  const { cycle, renewalAmount } = pickCyclePricing(undefined);
  const inserted = await db
    .insert(schema.services)
    .values({
      userId: body.userId,
      productId: product.id,
      name: serviceName,
      status: "pending",
      cycle,
      firstAmount: 0,
      renewalAmount,
      nextDueDate: null,
      moduleCode: "zjmf",
      moduleConfig: (product.moduleConfig ?? {}) as Json,
      deliverInfo: null,
    });
  const serviceId = inserted[0].insertId;
  const task = await createProvisionTask(db, { serviceId, action: "provision", payload: { reason: "admin_assign_open" } });
  await writeAdminAudit(c, admin, {
    action: "zjmf.assign_open",
    targetType: "service",
    targetId: serviceId,
    after: { code: body.code, upProductId: body.upProductId, userId: body.userId, productId: product.id, taskId: task.id } as Record<string, unknown>,
  });
  return c.json({
    ok: true,
    serviceId,
    taskId: task.id,
    message: `已创建服务 #${serviceId}（0 元代开），开通任务 #${task.id} 执行后自动在上游开通`,
  });
});


adminZjmfSupplierRoutes.post("/zjmf/suppliers/test", requireAdmin("products.manage"), async (c) => {
  const body = supplierTestSchema.parse(await c.req.json());
  const admin = c.get("admin");
  if (!body.code && !body.supplier) {
    throw appError("VALIDATION_FAILED", "请提供 code（测试已保存的供应商）或 supplier（内联临时配置）");
  }

  // 组装测试用连接配置：落库配置解密，或内联明文直用
  const config = body.supplier
    ? parseInlineSupplier(body.supplier)
    : supplierSettingToConfig(await findSupplierSetting(getDb(), body.code!));

  const module = getModule("zjmf");
  if (!module) throw appError("NOT_FOUND", "供应模块 zjmf 未注册");

  // 30s 超时包装：模块实现卡死时也能快速返回（与 provision-modules/test 一致）
  let timer: ReturnType<typeof setTimeout> | undefined;
  let result: { ok: boolean; message?: string };
  try {
    result = await Promise.race([
      module.testConnection({ supplier: config }),
      new Promise<{ ok: boolean; message: string }>((resolve) => {
        timer = setTimeout(() => resolve({ ok: false, message: "连接测试超时（30s），请检查上游地址可达性" }), 30_000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }

  await writeAdminAudit(c, admin, {
    action: "zjmf_supplier.test",
    targetType: "provision_module",
    targetId: "zjmf",
    after: { code: body.code ?? "(inline)", ok: result.ok } as Record<string, unknown>,
  });
  return c.json(result);
});
