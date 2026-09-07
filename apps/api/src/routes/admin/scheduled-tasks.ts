/**
 * 计划任务管理：任务清单（含最近一次执行）、执行记录分页、立即执行（经队列）。
 *
 * 任务清单为静态注册表——name/cron/description 必须与 apps/worker/src/tasks
 * （TASKS 注册表）保持同步；新增/调整 worker 任务时同步维护此列表。
 */
import { Hono } from "hono";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@qmkvm/db";
import { appError, enqueueJob } from "@qmkvm/core";
import { pageQuerySchema } from "@qmkvm/contracts";import { requireAdmin } from "../../middleware/auth.js";
import { iso, writeAdminAudit } from "./helpers.js";

/** 静态注册表（与 worker/src/tasks 保持同步：name/cron/description 一致） */
const SCHEDULED_TASKS: readonly { name: string; cron: string; description: string }[] = [
  { name: "renewal.invoices", cron: "0 3 * * *", description: "扫描即将到期服务并生成续费账单" },
  { name: "renewal.auto", cron: "30 0 * * *", description: "扫描到期服务并用余额自动续费（不足则通知失败）" },
  { name: "service.reminders", cron: "0 9 * * *", description: "对即将到期服务按 T-14/7/3/1 发送到期提醒" },
  { name: "service.suspend_overdue", cron: "0 4 * * *", description: "宽限期已过的 active 服务调度 suspend 供应任务" },
  { name: "service.terminate_overdue", cron: "30 4 * * *", description: "超终止阈值的 suspended_overdue 服务调度 terminate 供应任务" },
  { name: "payment.close_stale", cron: "* * * * *", description: "关闭过期支付单并取消关联 pending 订单（释放库存）" },
  { name: "payment.reconcile", cron: "15 * * * *", description: "主动查询支付网关补偿掉单（paying 未过期 intent）" },
  { name: "provision.retry_scan", cron: "*/10 * * * *", description: "供应任务兜底：failed 指数退避重试 + queued 滞留补偿" },
  { name: "system.cleanup", cron: "30 2 * * 0", description: "清理过期会话/短信验证码/找回密码 token（日志保留不动）" },
  { name: "system.job_health", cron: "0 7 * * *", description: "汇总昨日 job_runs 失败并推送钉钉/飞书告警" },
];

const taskNameParam = z.object({ name: z.string().min(1).max(50) });

export const adminScheduledTaskRoutes = new Hono();

/** 任务清单（含每个任务最近一次执行记录） */
adminScheduledTaskRoutes.get("/scheduled-tasks", requireAdmin("tasks.manage"), async (c) => {
  const db = getDb();

  // 每个任务最近一条执行记录：max(id) per task_name 回表
  const latestRows = await db
    .select()
    .from(schema.jobRuns)
    .where(
      sql`${schema.jobRuns.id} in (select max(id) from ${schema.jobRuns} group by ${schema.jobRuns.taskName})`,
    );
  const lastRunByName = new Map(latestRows.map((r) => [r.taskName, r]));

  return c.json({
    items: SCHEDULED_TASKS.map((t) => {
      const last = lastRunByName.get(t.name);
      return {
        ...t,
        lastRun: last
          ? {
              status: last.status,
              startedAt: iso(last.startedAt),
              finishedAt: iso(last.finishedAt),
              error: last.error,
            }
          : null,
      };
    }),
  });
});

/** 单任务执行记录（job_runs 分页） */
adminScheduledTaskRoutes.get(
  "/scheduled-tasks/:name/runs",
  requireAdmin("tasks.manage"),
  async (c) => {
    const { name } = taskNameParam.parse(c.req.param());
    const q = pageQuerySchema.parse(c.req.query());
    const db = getDb();

    const where = eq(schema.jobRuns.taskName, name);
    const rows = await db
      .select()
      .from(schema.jobRuns)
      .where(where)
      .orderBy(desc(schema.jobRuns.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    const totalRows = await db
      .select({ n: sql<number>`count(*)` })
      .from(schema.jobRuns)
      .where(where);

    return c.json({
      items: rows.map((r) => ({
        id: r.id,
        status: r.status,
        result: r.result,
        error: r.error,
        startedAt: iso(r.startedAt),
        finishedAt: iso(r.finishedAt),
      })),
      total: Number(totalRows[0]?.n ?? 0),
      page: q.page,
      pageSize: q.pageSize,
    });
  },
);

/** 立即执行：经队列投递 cron.run，由 worker 按任务注册表执行（写 job_runs） */
adminScheduledTaskRoutes.post(
  "/scheduled-tasks/:name/run",
  requireAdmin("tasks.manage"),
  async (c) => {
    const { name } = taskNameParam.parse(c.req.param());
    if (!SCHEDULED_TASKS.some((t) => t.name === name)) {
      throw appError("NOT_FOUND", `未知的计划任务：${name}`);
    }
    const admin = c.get("admin");
    await enqueueJob("cron.run", { name });
    await writeAdminAudit(c, admin, {
      action: "scheduled_task.run",
      targetType: "scheduled_task",
      targetId: name,
    });
    return c.json({ ok: true });
  },
);
