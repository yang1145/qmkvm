/**
 * 供应模块管理（PRD-billing F8 运维配套）：
 * - 模块清单（含使用商品数，含下架商品）；
 * - 按模块查使用中的商品（分页）；
 * - 按模块查最近失败/死信供应任务（join services 取服务名）；
 * - 连接测试（调模块 testConnection，30s 超时包装，写审计）。
 * 读端点 products.read，连接测试 products.manage。
 */
import { Hono } from "hono";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@qmkvm/db";
import { getModule, listModules, STANDARD_MODULE_ACTIONS } from "@qmkvm/provisioning";
import type { ModuleConfig, TestConnectionResult } from "@qmkvm/provisioning";
import { appError } from "@qmkvm/core";
import { pageQuerySchema } from "@qmkvm/contracts";
import { requireAdmin } from "../../middleware/auth.js";
import { iso, writeAdminAudit } from "./helpers.js";

export const adminProvisionModuleRoutes = new Hono();

const { products, provisionTasks, services } = schema;

/** 模块未声明 supportedActions 时的缺省动作集 */
const DEFAULT_ACTIONS: string[] = [...STANDARD_MODULE_ACTIONS];

/** moduleConfig 摘要：http-api 展示 baseUrl，其余展示顶层键（避免泄露 apiKey 等值） */
function summarizeConfig(config: unknown): string | null {
  if (config == null || typeof config !== "object" || Array.isArray(config)) return null;
  const cfg = config as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof cfg.baseUrl === "string" && cfg.baseUrl) parts.push(`baseUrl=${cfg.baseUrl}`);
  const keys = Object.keys(cfg).filter((k) => k !== "baseUrl");
  if (keys.length > 0) parts.push(`keys=${keys.join(",")}`);
  return parts.length > 0 ? parts.join("；") : null;
}

// —— 模块清单 ——

adminProvisionModuleRoutes.get("/provision-modules", requireAdmin("products.read"), async (c) => {
  const db = getDb();
  const counts = await db
    .select({ moduleCode: products.moduleCode, n: sql<number>`count(*)` })
    .from(products)
    .groupBy(products.moduleCode);
  const countMap = new Map(counts.map((r) => [r.moduleCode, Number(r.n)]));
  return c.json({
    items: listModules().map((m) => ({
      code: m.code,
      name: m.name,
      description: m.description ?? null,
      actions: m.supportedActions ?? DEFAULT_ACTIONS,
      productCount: countMap.get(m.code) ?? 0,
    })),
  });
});

// —— 按模块查商品（分页） ——

adminProvisionModuleRoutes.get(
  "/provision-modules/:code/products",
  requireAdmin("products.read"),
  async (c) => {
    const code = c.req.param("code");
    if (!getModule(code)) throw appError("NOT_FOUND", `供应模块不存在：${code}`);
    const db = getDb();
    const q = pageQuerySchema.parse(c.req.query());
    const where = eq(products.moduleCode, code);
    const rows = await db
      .select({
        id: products.id,
        name: products.name,
        slug: products.slug,
        status: products.status,
        moduleConfig: products.moduleConfig,
      })
      .from(products)
      .where(where)
      .orderBy(desc(products.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    const totalRows = await db.select({ n: sql<number>`count(*)` }).from(products).where(where);
    return c.json({
      items: rows.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        status: p.status,
        moduleConfigSummary: summarizeConfig(p.moduleConfig),
      })),
      total: Number(totalRows[0]?.n ?? 0),
      page: q.page,
      pageSize: q.pageSize,
    });
  },
);

// —— 按模块查最近失败/死信供应任务（最近 10 条） ——

adminProvisionModuleRoutes.get(
  "/provision-modules/:code/failures",
  requireAdmin("products.read"),
  async (c) => {
    const code = c.req.param("code");
    if (!getModule(code)) throw appError("NOT_FOUND", `供应模块不存在：${code}`);
    const db = getDb();
    const rows = await db
      .select({
        taskId: provisionTasks.id,
        serviceName: services.name,
        action: provisionTasks.action,
        status: provisionTasks.status,
        error: provisionTasks.lastError,
        createdAt: provisionTasks.createdAt,
      })
      .from(provisionTasks)
      .innerJoin(services, eq(provisionTasks.serviceId, services.id))
      .where(and(eq(services.moduleCode, code), inArray(provisionTasks.status, ["failed", "dead"])))
      .orderBy(desc(provisionTasks.createdAt))
      .limit(10);
    return c.json({
      items: rows.map((r) => ({
        taskId: r.taskId,
        serviceName: r.serviceName,
        action: r.action,
        status: r.status,
        error: r.error,
        createdAt: iso(r.createdAt),
      })),
    });
  },
);

// —— 连接测试 ——

const testBodySchema = z.object({
  code: z.string().min(1).max(50),
  config: z.unknown().optional(),
});

adminProvisionModuleRoutes.post("/provision-modules/test", requireAdmin("products.manage"), async (c) => {
  const body = testBodySchema.parse(await c.req.json());
  const admin = c.get("admin");
  const module = getModule(body.code);
  if (!module) throw appError("NOT_FOUND", `供应模块不存在：${body.code}`);

  let config: ModuleConfig | null = null;
  if (body.config != null) {
    if (typeof body.config !== "object" || Array.isArray(body.config)) {
      throw appError("VALIDATION_FAILED", "config 必须为 JSON 对象");
    }
    config = body.config as ModuleConfig;
  }

  // 30s 超时包装：模块实现卡死时也能快速返回
  let timer: ReturnType<typeof setTimeout> | undefined;
  let result: TestConnectionResult;
  try {
    result = await Promise.race([
      module.testConnection(config),
      new Promise<TestConnectionResult>((resolve) => {
        timer = setTimeout(
          () => resolve({ ok: false, message: "连接测试超时（30s），请检查目标地址可达性" }),
          30_000,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }

  await writeAdminAudit(c, admin, {
    action: "provision_module.test",
    targetType: "provision_module",
    targetId: body.code,
    after: { code: body.code, ok: result.ok, message: result.message ?? null },
  });

  return c.json({ ok: result.ok, message: result.message ?? null });
});
