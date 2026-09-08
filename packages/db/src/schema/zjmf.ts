/**
 * 魔方财务（zjmf 供应模块）上游同步数据。
 * 上游商品快照：供应商同步落库后供商品映射选择与代理价参考，
 * 本地向用户收取的价格仍由商品定价（product_pricing）独立决定。
 */
import { bigint, date, index, json, mysqlTable, text, unique, varchar } from "drizzle-orm/mysql-core";
import { createdAt, id, updatedAt } from "./_shared.js";

/** 同步的单个周期价格条目（cycles JSON 数组元素） */
export interface ZjmfUpstreamCycle {
  /** 本地周期键（monthly/quarterly/...，无法归一化时为上游原始键） */
  cycle: string;
  /** 上游原始 billingcycle 键 */
  upCycle: string;
  /** 周期显示名（月付/季付/...） */
  name: string;
  /** 上游代理价（分） */
  agentPriceCents: number;
}

export const zjmfUpstreamProducts = mysqlTable(
  "zjmf_upstream_products",
  {
    id: id(),
    /** 供应商 code（zjmf 供应商设置表注册的 code） */
    supplierCode: varchar("supplier_code", { length: 50 }).notNull(),
    /** 上游商品 ID */
    upProductId: bigint("up_product_id", { mode: "number" }).notNull(),
    name: varchar("name", { length: 200 }).notNull().default(""),
    description: text(),
    currency: varchar("currency", { length: 10 }).notNull().default(""),
    /** 上游代理价（分，列表/详情取到的代表价） */
    agentPriceCents: bigint("agent_price_cents", { mode: "number" }).notNull().default(0),
    /** 各周期价格：ZjmfUpstreamCycle[] */
    cycles: json("cycles").$type<ZjmfUpstreamCycle[] | null>(),
    /** 上游模块类型（信息展示） */
    module: varchar("module", { length: 100 }).notNull().default(""),
    /** 服务器组名（信息展示，可空） */
    serverGroup: varchar("server_group", { length: 100 }).notNull().default(""),
    syncedAt: date("synced_at", { mode: "string" }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("zjmf_up_product_uq").on(t.supplierCode, t.upProductId),
    index("zjmf_up_supplier_idx").on(t.supplierCode),
  ],
);
