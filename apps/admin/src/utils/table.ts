/**
 * ProTable request 适配器：契约 { items, total, page, pageSize } → ProTable { data, total, success }
 * 同时把 current/pageSize 转为 page/pageSize 查询参数
 */
export function tableRequestAdapter<T>(
  res: { items: T[]; total: number; page: number; pageSize: number },
): { data: T[]; total: number; success: boolean } {
  return { data: res?.items ?? [], total: res?.total ?? 0, success: true };
}

/** ProTable params → 查询参数（page/pageSize + 其余筛选） */
export function toQuery(params: Record<string, any>, extra?: Record<string, unknown>) {
  const { current, pageSize, ...rest } = params;
  return {
    page: current ?? 1,
    pageSize: pageSize ?? 20,
    ...rest,
    ...extra,
  };
}