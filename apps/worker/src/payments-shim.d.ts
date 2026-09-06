/**
 * @pinhaoji/payments 类型垫片：payments 包实现落地前，保证 worker 可通过 typecheck。
 * 规则：仅当 TS 无法从包内解析出真实类型时本声明才生效；payments 交付后真实类型
 * 自动接管，本文件无需删除（按 SPEC §2.4 的签名声明）。
 */
declare module "@pinhaoji/payments" {
  import type { Db } from "@pinhaoji/db";

  export interface SettleStaleResult {
    settled: number;
  }

  export function queryAndSettleStaleIntents(
    db: Db,
    now: Date,
    minutes?: number,
  ): Promise<SettleStaleResult>;

  export function processPaymentEvent(db: Db, eventId: number | string): Promise<void>;
}
