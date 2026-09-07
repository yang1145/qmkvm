/**
 * 日期工具：仅处理 "YYYY-MM-DD" 字符串，全部按 UTC 计算，避免时区漂移。
 * 纯函数、无 IO，便于单测（见 tests/date-utils.test.ts）。
 */
import { CYCLE_MONTHS, type BillingCycle } from "@qmkvm/contracts";
import { appError } from "./errors.js";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/** 解析 "YYYY-MM-DD" 为 UTC 零点 Date；非法格式/不存在日期抛 VALIDATION_FAILED */
export function parseDate(dateStr: string): Date {
  const m = DATE_RE.exec(dateStr);
  if (!m) {
    throw appError("VALIDATION_FAILED", `非法日期格式（应为 YYYY-MM-DD）：${dateStr}`);
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  // 过滤 2026-02-30 之类不存在的日期（Date.UTC 会静默进位）
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    throw appError("VALIDATION_FAILED", `非法日期：${dateStr}`);
  }
  return d;
}

/** Date → "YYYY-MM-DD"（按 UTC 取年月日） */
export function formatDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return `${y.toString().padStart(4, "0")}-${m.toString().padStart(2, "0")}-${day
    .toString()
    .padStart(2, "0")}`;
}

/** 当前 UTC 日期字符串（可注入 now 便于测试/定时任务传参） */
export function todayStr(now: Date = new Date()): string {
  return formatDate(now);
}

/** 指定月（0 起）的天数 */
export function lastDayOfMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/**
 * 加 N 个自然月（CYCLE_MONTHS），基准为 from（默认 dateStr 本身）。
 * 月末 clamp：1/31 + 1 月 = 2/28；2/29（闰年）+ 12 月 = 次年 2/28。
 * onetime 无周期概念，原值返回。
 */
export function addCycle(dateStr: string, cycle: BillingCycle, from?: string): string {
  if (cycle === "onetime") return dateStr;
  const months = CYCLE_MONTHS[cycle];
  const base = parseDate(from ?? dateStr);
  const totalMonths = base.getUTCFullYear() * 12 + base.getUTCMonth() + months;
  const year = Math.floor(totalMonths / 12);
  const month0 = totalMonths % 12;
  const day = Math.min(base.getUTCDate(), lastDayOfMonth(year, month0));
  return formatDate(new Date(Date.UTC(year, month0, day)));
}

/** b - a 的天数（按 UTC 自然日） */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / MS_PER_DAY);
}

/** 加减自然日（days 可为负） */
export function addDays(dateStr: string, days: number): string {
  const d = parseDate(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDate(d);
}

/** 取较晚日期（"YYYY-MM-DD" 字典序即时间序） */
export function maxDate(a: string, b: string): string {
  return a >= b ? a : b;
}
