import { sql } from "drizzle-orm";
import { bigint, datetime } from "drizzle-orm/mysql-core";

/**
 * 全局共享列与类型。
 * 金额一律为最小货币单位（分），类型为 BIGINT / number，禁止 float。
 */

export const BILLING_CYCLES = [
  "onetime",
  "monthly",
  "quarterly",
  "semiannually",
  "annually",
  "biennially",
  "triennially",
] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const id = () => bigint("id", { mode: "number" }).autoincrement().primaryKey();

export const money = (name: string) => bigint(name, { mode: "number" });

export const createdAt = () =>
  datetime("created_at", { mode: "date" })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`);

export const updatedAt = () =>
  datetime("updated_at", { mode: "date" })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`)
    .$onUpdate(() => new Date());

export type Json = Record<string, unknown>;
