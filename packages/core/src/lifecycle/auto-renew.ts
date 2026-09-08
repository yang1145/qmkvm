/**
 * 服务生命周期 · 余额自动续费：扫描开启 auto_renew 且已到期的服务，
 * 余额充足则扣款并顺延到期日（suspended_overdue 恢复 active），不足则通知失败。
 *
 * 幂等：顺延后 next_due_date > today，同一服务不会被重复处理；
 * 事务内行锁 + 条件守卫（next_due_date 仍 <= today）兜底并发重复调度。
 */
import { and, eq, isNotNull, lte, ne } from "drizzle-orm";
import { schema, type Db } from "@qmkvm/db/client";
import { addCycle, maxDate, todayStr } from "../date-utils.js";
import { formatCny } from "../money.js";
import { debitUser } from "../billing/credit.js";
import { emitEvent } from "../events.js";
import { createProvisionTask, updateServiceStatus } from "./service-actions.js";

const { services, users } = schema;

export interface AutoRenewResult {
  /** 进入处理（余额预检通过或不足分支）的服务数 */
  processed: number;
  /** 扣款续费成功数 */
  succeeded: number;
  /** 余额不足数（不扣款不顺延，留给逾期流程） */
  insufficient: number;
}

/**
 * 余额自动续费扫描：active + auto_renew + 未申请到期取消 + next_due_date <= today。
 * 成功：debitUser(payment, refType=service) → next_due_date = addCycle(max(today, due), cycle)；
 * 恢复语义与 applyRenewalPayment 一致（suspended_overdue → active + unsuspend 任务）。
 */
export async function autoRenewDueServices(db: Db, now: Date): Promise<AutoRenewResult> {
  const today = todayStr(now);
  const candidates = await db
    .select()
    .from(services)
    .where(
      and(
        eq(services.status, "active"),
        eq(services.autoRenew, true),
        eq(services.cancelAtPeriodEnd, false),
        isNotNull(services.nextDueDate),
        lte(services.nextDueDate, today),
        ne(services.cycle, "onetime"),
      ),
    );

  let processed = 0;
  let succeeded = 0;
  let insufficient = 0;

  for (const service of candidates) {
    if (!service.nextDueDate || service.renewalAmount <= 0) continue; // 一次性/零价服务不走自动续费
    processed += 1;
    const dueDate: string = service.nextDueDate;
    const amount = service.renewalAmount;

    // 余额预检（快速路径）：不足直接失败通知，不占事务
    const balRows = await db
      .select({ balance: users.creditBalance })
      .from(users)
      .where(eq(users.id, service.userId))
      .limit(1);
    const balance = balRows[0]?.balance;
    if (balance === undefined) continue; // 用户不存在（异常数据），跳过
    if (balance < amount) {
      insufficient += 1;
      await emitEvent(db, "renewal.auto_failed", {
        userId: service.userId,
        serviceId: service.id,
        service: { name: service.name, nextDueDate: dueDate },
      });
      continue;
    }

    // 事务返回处理结果：null = 被并发处理/状态不允许，跳过
    const done = await db.transaction(
      async (tx): Promise<{ wasSuspendedOverdue: boolean; nextDue: string } | null> => {
        // 行锁重读 + 条件守卫：并发（如逾期暂停任务翻转状态/重复调度）下不重复扣款
        const rows = await tx
          .select()
          .from(services)
          .where(eq(services.id, service.id))
          .limit(1)
          .for("update");
        const cur = rows[0];
        if (!cur || !cur.nextDueDate || cur.nextDueDate > today) return null;
        if (cur.status !== "active" && cur.status !== "suspended_overdue") return null;

        await debitUser(tx, service.userId, {
          type: "payment",
          amount,
          refType: "service",
          refId: service.id,
          remark: "自动续费",
        });

        const nextDue = addCycle(maxDate(today, cur.nextDueDate), cur.cycle);
        if (cur.status === "suspended_overdue") {
          // 与 applyRenewalPayment 相同的恢复语义：恢复 active（含审计）
          await updateServiceStatus(tx, service.id, "active", { nextDueDate: nextDue });
          return { wasSuspendedOverdue: true, nextDue };
        }
        await tx.update(services).set({ nextDueDate: nextDue }).where(eq(services.id, service.id));
        return { wasSuspendedOverdue: false, nextDue };
      },
    );
    if (!done) continue; // 被并发处理/状态不允许，跳过

    succeeded += 1;
    if (done.wasSuspendedOverdue) {
      // 欠费停机恢复后补排 renew/unsuspend 供应任务（事务提交后执行，避免 inline 早于提交）
      await createProvisionTask(db, {
        serviceId: service.id,
        action: "renew",
        payload: { reason: "auto_renew", nextDueDate: done.nextDue },
      });
      await createProvisionTask(db, {
        serviceId: service.id,
        action: "unsuspend",
        payload: { reason: "auto_renew", nextDueDate: done.nextDue },
      });
    } else {
      // 正常到期自动续费：本地到期日已顺延，同步创建 renew 任务（需要远端续费的模块消费）
      await createProvisionTask(db, {
        serviceId: service.id,
        action: "renew",
        payload: { reason: "auto_renew", nextDueDate: done.nextDue },
      });
    }
    await emitEvent(db, "renewal.auto_success", {
      userId: service.userId,
      serviceId: service.id,
      service: {
        name: service.name,
        amount,
        amountCny: formatCny(amount),
        nextDueDate: done.nextDue,
      },
    });
  }

  return { processed, succeeded, insufficient };
}
