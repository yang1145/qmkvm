import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb, schema, carts, type CartLine } from "@pinhaoji/db";

type User = typeof schema.users.$inferSelect;
import { addToCartSchema, updateCartItemSchema, cartOptionSelection } from "@pinhaoji/contracts";
import { quoteProduct, validatePromo, appError, type OptionSelection } from "@pinhaoji/core";
import { requireAuth } from "../../middleware/auth.js";

export const portalCartRoutes = new Hono();
portalCartRoutes.use("*", requireAuth());

async function loadCart(userId: number): Promise<CartLine[]> {
  const db = getDb();
  const rows = await db.select().from(carts).where(eq(carts.userId, userId)).limit(1);
  return (rows[0]?.items as CartLine[] | undefined) ?? [];
}

async function saveCart(userId: number, items: CartLine[]): Promise<void> {
  const db = getDb();
  const existing = await db.select({ userId: carts.userId }).from(carts).where(eq(carts.userId, userId)).limit(1);
  if (existing[0]) {
    await db.update(carts).set({ items, updatedAt: new Date() }).where(eq(carts.userId, userId));
  } else {
    await db.insert(carts).values({ userId, items });
  }
}

portalCartRoutes.get("/cart", async (c) => {
  return c.json({ items: await loadCart((c.get("user") as User).id) });
});

portalCartRoutes.post("/cart/items", async (c) => {
  const body = addToCartSchema.parse(await c.req.json());
  const db = getDb();
  const productRows = await db
    .select()
    .from(schema.products)
    .where(eq(schema.products.id, body.productId))
    .limit(1);
  const product = productRows[0];
  if (!product || product.status !== "active" || product.hidden) {
    throw appError("CATALOG_NOT_FOUND", "商品不存在或已下架");
  }
  const line: CartLine = {
    itemId: randomUUID().replace(/-/g, "").slice(0, 20),
    productId: body.productId,
    cycle: body.cycle,
    options: body.options.map((o) => ({ groupId: o.groupId, optionIds: o.optionIds, quantity: o.quantity })),
    qty: body.qty,
    addedAt: new Date().toISOString(),
  };
  const items = await loadCart((c.get("user") as User).id);
  items.push(line);
  await saveCart((c.get("user") as User).id, items);
  return c.json({ ok: true, itemId: line.itemId, count: items.length });
});

portalCartRoutes.patch("/cart/items/:itemId", async (c) => {
  const body = updateCartItemSchema.parse(await c.req.json());
  const userId = (c.get("user") as User).id;
  const items = await loadCart(userId);
  const line = items.find((l) => l.itemId === c.req.param("itemId"));
  if (!line) throw appError("NOT_FOUND", "购物车项不存在");
  if (body.cycle) line.cycle = body.cycle;
  if (body.qty) line.qty = body.qty;
  if (body.options) {
    line.options = body.options.map((o) => ({ groupId: o.groupId, optionIds: o.optionIds, quantity: o.quantity }));
  }
  await saveCart(userId, items);
  return c.json({ ok: true });
});

portalCartRoutes.delete("/cart/items/:itemId", async (c) => {
  const userId = (c.get("user") as User).id;
  const items = (await loadCart(userId)).filter((l) => l.itemId !== c.req.param("itemId"));
  await saveCart(userId, items);
  return c.json({ ok: true, count: items.length });
});

/** 服务端实时报价（优惠码错误以 promoError 软提示返回） */
portalCartRoutes.get("/cart/quote", async (c) => {
  const userId = (c.get("user") as User).id;
  const user = c.get("user") as User;
  const db = getDb();
  const lines = await loadCart(userId);
  if (lines.length === 0) {
    return c.json({
      subtotal: 0, discount: 0, total: 0, currency: "CNY",
      promoCode: null, promoError: null, items: [],
      balanceAvailable: Number(user.creditBalance ?? 0), balanceSuggested: 0,
    });
  }

  const productIds = [...new Set(lines.map((l) => l.productId))];
  const products = await db.select().from(schema.products).where(inArray(schema.products.id, productIds));
  const productMap = new Map(products.map((p) => [p.id, p]));

  const quoteItems: Array<{
    itemId: string; productId: number; productName: string; cycle: typeof lines[number]["cycle"];
    qty: number; unitFirst: number; unitRenewal: number; setupFee: number; amount: number;
    optionsSummary: string[]; requiresIdentity: boolean;
  }> = [];
  for (const line of lines) {
    const product = productMap.get(line.productId);
    if (!product) throw appError("CATALOG_NOT_FOUND", "购物车中的商品已下架，请移除后重试");
    const q = await quoteProduct(db, {
      productId: line.productId,
      cycle: line.cycle,
      selections: line.options as OptionSelection[],
      qty: line.qty,
    });
    quoteItems.push({
      itemId: line.itemId,
      productId: line.productId,
      productName: product.name,
      cycle: line.cycle,
      qty: line.qty,
      unitFirst: q.unitFirst,
      unitRenewal: q.unitRenewal,
      setupFee: q.setupFee,
      amount: q.amount,
      optionsSummary: q.optionsSummary,
      requiresIdentity: product.requiresIdentity,
    });
  }

  const subtotal = quoteItems.reduce((s, i) => s + i.amount, 0);
  const promoCode = c.req.query("promoCode") || null;
  let discount = 0;
  let promoError: string | null = null;
  let promoApplied: string | null = null;
  if (promoCode) {
    try {
      const { promo } = await validatePromo(db, promoCode, {
        userId,
        subtotal,
        productIds,
        groupIds: products.map((p) => p.groupId),
        isFirstOrder: false,
      });
      // 折扣金额计算与 core 保持一致：percent 为 1..100
      discount =
        promo.type === "percent"
          ? Math.round((subtotal * promo.value) / 100)
          : Math.min(promo.value, subtotal);
      promoApplied = promo.code;
    } catch (err) {
      promoError = err instanceof Error ? err.message : "优惠码不可用";
    }
  }
  const total = Math.max(0, subtotal - discount);
  const balanceAvailable = Number(user.creditBalance ?? 0);

  return c.json({
    subtotal, discount, total, currency: "CNY",
    promoCode: promoApplied, promoError, items: quoteItems,
    balanceAvailable,
    balanceSuggested: Math.min(balanceAvailable, total),
  });
});
