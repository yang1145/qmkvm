import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getDb, schema, carts, type CartLine } from "@qmkvm/db";

type User = typeof schema.users.$inferSelect;
import { checkoutSchema } from "@qmkvm/contracts";
import {
  createOrderFromCart,
  appError,
  type CheckoutCartItem,
  type OptionSelection,
  type CheckoutResult,
} from "@qmkvm/core";
import { requireAuth } from "../../middleware/auth.js";

export const portalCheckoutRoutes = new Hono();
portalCheckoutRoutes.use("*", requireAuth());

async function loadCart(userId: number): Promise<CartLine[]> {
  const db = getDb();
  const rows = await db.select().from(carts).where(eq(carts.userId, userId)).limit(1);
  return (rows[0]?.items as CartLine[] | undefined) ?? [];
}

/** 结算：服务端重算金额 → 订单 + 账单（payable>0 时由 /invoices/:id/pay 完成支付） */
portalCheckoutRoutes.post("/checkout", async (c) => {
  const body = checkoutSchema.parse(await c.req.json());
  const user = c.get("user") as User;
  const db = getDb();
  const lines = await loadCart(user.id);
  if (lines.length === 0) throw appError("VALIDATION_FAILED", "购物车为空");

  // 实名前置校验：要求实名的商品须先通过实名（status=verified）
  const productIds = [...new Set(lines.map((l) => l.productId))];
  for (const pid of productIds) {
    const rows = await db.select().from(schema.products).where(eq(schema.products.id, pid)).limit(1);
    const p = rows[0];
    if (p?.requiresIdentity) {
      const prof = await db
        .select({ status: schema.userProfiles.status })
        .from(schema.userProfiles)
        .where(eq(schema.userProfiles.userId, user.id))
        .limit(1);
      if (prof[0]?.status !== "verified") {
        throw appError("CATALOG_IDENTITY_REQUIRED", "该商品需要完成实名认证后购买");
      }
    }
  }

  const items: CheckoutCartItem[] = lines.map((l) => ({
    itemId: l.itemId,
    productId: l.productId,
    cycle: l.cycle,
    qty: l.qty,
    options: l.options as OptionSelection[],
  }));

  const result: CheckoutResult = await createOrderFromCart(db, user, {
    quote: { items, promoCode: body.promoCode ?? null },
    promoCode: body.promoCode ?? undefined,
    useBalance: body.useBalance,
    note: body.note,
  });

  // 成功后清空购物车
  await db.delete(carts).where(eq(carts.userId, user.id));

  return c.json({ ...result, payUrl: null });
});
