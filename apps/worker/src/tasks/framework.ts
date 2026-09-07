/**
 * 定时任务框架：TaskDef 定义 + runTask 统一包装。
 *
 * runTask：开始即写 job_runs（status 暂记 failed、startedAt 落库，进程崩溃可见），
 * 结束回写 status/result/error/finishedAt；任何异常只记日志不外抛（不中断进程）。
 */
import { eq } from "drizzle-orm";
import { schema, type Db } from "@qmkvm/db";
import type { Json } from "@qmkvm/db/schema";
import { logger } from "@qmkvm/logger";

const log = logger.child({ module: "worker:tasks" });

export type TaskStatus = "success" | "partial" | "failed";

export interface TaskDef {
  /** 任务名（BullMQ repeatable job 名 / run-task 入参 / job_runs.task_name） */
  name: string;
  /** cron 表达式（BullMQ pattern，UTC 时区） */
  cron: string;
  description: string;
  /** 任务体：返回值序列化进 job_runs.result */
  run: (db: Db, now: Date) => Promise<unknown>;
  /** 从返回值判定最终状态（缺省 success） */
  evaluate?: (result: unknown) => "success" | "partial";
}

export interface TaskRunOutcome {
  status: TaskStatus;
  result?: unknown;
  error?: string;
  runId: number | null;
}

/** 执行一个定时任务并记录 job_runs；失败不抛出 */
export async function runTask(db: Db, task: TaskDef, now: Date = new Date()): Promise<TaskRunOutcome> {
  const inserted = await db
    .insert(schema.jobRuns)
    .values({ taskName: task.name, status: "failed", startedAt: now });
  const runId = inserted[0]?.insertId ?? null;

  try {
    const result = await task.run(db, new Date());
    const status: TaskStatus = task.evaluate ? task.evaluate(result) : "success";
    if (runId !== null) {
      await db
        .update(schema.jobRuns)
        .set({ status, result: (result ?? null) as Json, finishedAt: new Date() })
        .where(eq(schema.jobRuns.id, runId));
    }
    log.info({ task: task.name, status, result }, "定时任务完成");
    return { status, result, runId };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (runId !== null) {
      await db
        .update(schema.jobRuns)
        .set({ status: "failed", error, finishedAt: new Date() })
        .where(eq(schema.jobRuns.id, runId))
        .catch(() => undefined);
    }
    log.error({ task: task.name, err }, "定时任务失败（不中断进程）");
    return { status: "failed", error, runId };
  }
}
