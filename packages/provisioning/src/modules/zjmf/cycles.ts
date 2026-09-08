/**
 * 魔方财务周期键处理：上游 billingcycle 键存在版本差异（"monthly"/"Monthly"/"月付"…），
 * 与本地 BillingCycle 枚举（monthly/quarterly/…）之间需要归一化与别名匹配。
 * 移植自 MNBT zjmfmanager_reserve lib/upstream.php（matchUpCycle / cycleAliases / normKey）。
 */
import type { BillingCycle } from "@qmkvm/contracts";

/** 本地支持的魔方可续周期（onetime 无到期概念，不参与上游周期映射） */
export const ZJMF_CYCLES: Record<Exclude<BillingCycle, "onetime">, { name: string }> = {
  monthly: { name: "月付" },
  quarterly: { name: "季付" },
  semiannually: { name: "半年付" },
  annually: { name: "年付" },
  biennially: { name: "两年付" },
  triennially: { name: "三年付" },
};

export type RenewableCycle = Exclude<BillingCycle, "onetime">;

/** 键归一化：小写 + 去非字母数字（保留中文） */
export function normCycleKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, "");
}

/** 本地周期键的别名集合（归一化后，含中文名） */
export function cycleAliases(cycle: string): string[] {
  const norm = normCycleKey(cycle);
  const map: Record<string, string[]> = {
    monthly: ["monthly", "month", "m", "月", "月付"],
    quarterly: ["quarterly", "quarter", "q", "季", "季付"],
    semiannually: ["semiannually", "semiannual", "halfyear", "half", "semi", "半年", "半年付"],
    annually: ["annually", "annual", "yearly", "year", "y", "年", "年付"],
    biennially: ["biennially", "biennial", "biennium", "twoyear", "两年", "两年付"],
    triennially: ["triennially", "triennial", "triennium", "threeyear", "三年", "三年付"],
  };
  for (const [canonical, list] of Object.entries(map)) {
    if (norm === canonical || list.includes(norm)) return [canonical, ...list];
  }
  return [norm];
}

/** 上游周期键 → 本地周期（无法识别返回 null） */
export function toLocalCycle(upKey: string): RenewableCycle | null {
  const norm = normCycleKey(upKey);
  for (const canonical of Object.keys(ZJMF_CYCLES) as RenewableCycle[]) {
    if (norm === canonical || cycleAliases(canonical).includes(norm)) return canonical;
  }
  return null;
}

/**
 * 本地周期 → 上游 billingcycle 键。
 * 优先级：moduleConfig.upCycles 显式映射 > 上游可用键别名匹配 > 本地键小写（官方周期如 monthly、day、hour）。
 *
 * @param upCycles    moduleConfig.upCycles（本地周期 → 上游键映射，可为空）
 * @param cycle       本地周期
 * @param available   上游实际可选周期键（探测所得，可为空；键可为任意大小写）
 */
export function resolveUpCycle(
  upCycles: Record<string, string> | undefined,
  cycle: RenewableCycle,
  available?: Iterable<string>,
): string {
  const explicit = upCycles?.[cycle] ?? upCycles?.[cycle.toLowerCase()];
  if (typeof explicit === "string" && explicit !== "") return explicit;

  if (available) {
    const aliases = cycleAliases(cycle);
    for (const key of available) {
      if (aliases.includes(normCycleKey(key))) return key;
    }
  }
  return cycle.toLowerCase();
}

/** 上游周期键列表 → 本地周期映射（用于探测结果回写 upCycles） */
export function mapUpCycles(upKeys: Iterable<string>): Partial<Record<RenewableCycle, string>> {
  const out: Partial<Record<RenewableCycle, string>> = {};
  for (const key of upKeys) {
    const local = toLocalCycle(key);
    if (local && !out[local]) out[local] = key;
  }
  return out;
}
