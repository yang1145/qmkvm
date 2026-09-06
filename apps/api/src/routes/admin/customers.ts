/** 客户管理：列表（q 搜索手机/邮箱/ID，脱敏）、详情（关联数据概要）、状态、余额调整。 */
import { Hono } from "hono";
import { and, desc, eq, like, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@pinhaoji/db";
import { creditAdjustSchema, idParamSchema, pageQuerySchema } from "@pinhaoji/contracts";
import { appError, adjustCredit } from "@pinhaoji/core";
import { requireAdmin } from "../../middleware/auth.js";
import { iso, maskedContact, writeAdminAudit } from "./helpers.js";

export const adminCustomerRoutes = new Hono();

const { users, userProfiles, services, products, orders, invoices, creditLedger } = schema;

adminCustomerRoutes.get("/customers", requireAdmin("customers.read"), async (c) => {
  const db = getDb();
  const q = pageQuerySchema.parse(c.req.query());
  const search = c.req.query("q")?.trim();
  const status = c.req.query("status");

  let searchWhere: SQL | undefined;
  if (search) {
    const orParts = [like(users.phone, `%${search}%`), like(users.email, `%${search}%`)];
    if (/^\d+$/.test(search)) orParts.push(eq(users.id, Number(search)));
    searchWhere = or(...orParts);
  }
  const statusWhere = status === "active" || status === "disabled" ? eq(users.status, status) : undefined;
  const where = and(searchWhere, statusWhere);

  const rows = await db
    .select()
    .from(users)
    .where(where)
    .orderBy(desc(users.id))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  const totalRows = await db.select({ n: sql<number>`count(*)` }).from(users).where(where);

  return c.json({
    items: rows.map((u) => ({
      id: u.id,
      name: u.name,
      ...maskedContact(u),
      creditBalance: Number(u.creditBalance ?? 0),
      status: u.status,
      createdAt: iso(u.createdAt),
      lastLoginAt: iso(u.lastLoginAt),
    })),
    total: Number(totalRows[0]?.n ?? 0),
    page: q.page,
    pageSize: q.pageSize,
  });
});

/** 客户详情：账户全量（详情按需展示完整联系方式）+ 服务/订单/账单/流水概要 */
adminCustomerRoutes.get("/customers/:id", requireAdmin("customers.read"), async (c) => {
  const db = getDb();
  const id = idParamSchema.parse(c.req.param()).id;
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  const user = rows[0];
  if (!user) throw appError("NOT_FOUND", `客户不存在（#${id}）`);

  const profileRows = await db.select().from(userProfiles).where(eq(userProfiles.userId, id)).limit(1);
  const profile = profileRows[0];
  const svcRows = await db
    .select({ svc: services, productName: products.name })
    .from(services)
    .leftJoin(products, eq(products.id, services.productId))
    .where(eq(services.userId, id))
    .orderBy(desc(services.id))
    .limit(10);
  const orderRows = await db.select().from(orders).where(eq(orders.userId, id)).orderBy(desc(orders.id)).limit(10);
  const invoiceRows = await db
    .select()
    .from(invoices)
    .where(eq(invoices.userId, id))
    .orderBy(desc(invoices.id))
    .limit(10);
  const ledgerRows = await db
    .select()
    .from(creditLedger)
    .where(eq(creditLedger.userId, id))
    .orderBy(desc(creditLedger.id))
    .limit(10);

  return c.json({
    id: user.id,
    phone: user.phone,
    email: user.email,
    name: user.name,
    creditBalance: Number(user.creditBalance ?? 0),
    status: user.status,
    createdIp: user.createdIp,
    lastLoginAt: iso(user.lastLoginAt),
    createdAt: iso(user.createdAt),
    profile: profile
      ? {
          type: profile.type,
          realName: profile.realName,
          companyName: profile.companyName,
          creditCode: profile.creditCode,
          status: profile.status,
          verifiedAt: iso(profile.verifiedAt),
        }
      : null,
    services: svcRows.map((r) => ({
      id: r.svc.id,
      name: r.svc.name,
      productName: r.productName,
      status: r.svc.status,
      cycle: r.svc.cycle,
      renewalAmount: r.svc.renewalAmount,
      nextDueDate: r.svc.nextDueDate,
    })),
    orders: orderRows.map((o) => ({
      id: o.id,
      type: o.type,
      status: o.status,
      total: o.total,
      paidAt: iso(o.paidAt),
      createdAt: iso(o.createdAt),
    })),
    invoices: invoiceRows.map((i) => ({
      id: i.id,
      invoiceNo: i.invoiceNo,
      type: i.type,
      status: i.status,
      total: i.total,
      paidAt: iso(i.paidAt),
      createdAt: iso(i.createdAt),
    })),
    ledger: ledgerRows.map((l) => ({
      id: l.id,
      type: l.type,
      amount: l.amount,
      balanceAfter: l.balanceAfter,
      remark: l.remark,
      createdAt: iso(l.createdAt),
    })),
  });
});

/** 启用/禁用客户账户 */
adminCustomerRoutes.post("/customers/:id/status", requireAdmin("customers.manage"), async (c) => {
  const id = idParamSchema.parse(c.req.param()).id;
  const body = z.object({ status: z.enum(["active", "disabled"]) }).parse(await c.req.json());
  const db = getDb();
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  const user = rows[0];
  if (!user) throw appError("NOT_FOUND", `客户不存在（#${id}）`);
  if (user.status !== body.status) {
    await db.update(users).set({ status: body.status }).where(eq(users.id, id));
  }
  const admin = c.get("admin");
  await writeAdminAudit(c, admin, {
    action: "customer.status",
    targetType: "user",
    targetId: id,
    before: { status: user.status },
    after: { status: body.status },
  });
  return c.json({ ok: true, status: body.status });
});

/** 余额调整（正入负出；core adjustCredit 自带 credit.adjust 审计与双式流水） */
adminCustomerRoutes.post("/customers/:id/credit", requireAdmin("customers.credit"), async (c) => {
  const id = idParamSchema.parse(c.req.param()).id;
  const body = creditAdjustSchema.parse(await c.req.json());
  if (body.userId !== id) {
    throw appError("VALIDATION_FAILED", "路径 id 与 body.userId 不一致");
  }
  const admin = c.get("admin");
  const result = await adjustCredit(getDb(), admin.adminId, {
    userId: id,
    amount: body.amount,
    remark: body.remark,
  });
  return c.json({ ok: true, balanceAfter: result.balanceAfter });
});
