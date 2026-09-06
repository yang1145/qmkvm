/**
 * 人工开通模块（manual）：所有动作直接返回 { ok: true, manual: true }。
 * 任务标记 succeeded，服务状态由后台人工操作推进（「标记已开通」等）。
 */
import type {
  ChangePackageTarget,
  ModuleCtx,
  ModuleResult,
  ModuleConfig,
  ProvisionModule,
  TestConnectionResult,
} from "../types.js";

const okManual = (action: string): ModuleResult => ({
  ok: true,
  manual: true,
  message: `人工模块：${action} 动作由后台人工处理`,
});

export const manualModule: ProvisionModule = {
  code: "manual",
  name: "人工开通",

  async testConnection(_config: ModuleConfig | null): Promise<TestConnectionResult> {
    return { ok: true, message: "人工开通模块无外部依赖，无需连接测试" };
  },

  async provision(_ctx: ModuleCtx, service): Promise<ModuleResult> {
    return okManual(`开通服务 #${service.id}`);
  },

  async suspend(_ctx: ModuleCtx, service): Promise<ModuleResult> {
    return okManual(`暂停服务 #${service.id}`);
  },

  async unsuspend(_ctx: ModuleCtx, service): Promise<ModuleResult> {
    return okManual(`恢复服务 #${service.id}`);
  },

  async terminate(_ctx: ModuleCtx, service): Promise<ModuleResult> {
    return okManual(`终止服务 #${service.id}`);
  },

  async changePackage(
    _ctx: ModuleCtx,
    service,
    target: ChangePackageTarget,
  ): Promise<ModuleResult> {
    return okManual(`服务 #${service.id} 变更套餐 → 商品 #${target.productId}`);
  },
};
