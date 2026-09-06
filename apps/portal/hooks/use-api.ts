"use client";

import * as React from "react";

import { ApiError } from "@/lib/api";

export interface UseApiDataResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  setData: React.Dispatch<React.SetStateAction<T | null>>;
}

/**
 * 轻量数据获取 hook：自动挂载加载、错误、重试。
 * deps 变化时重新请求；fetcher 需自行用 useCallback 或保证引用稳定的数据源。
 */
export function useApiData<T>(
  fetcher: () => Promise<T>,
  deps: React.DependencyList,
): UseApiDataResult<T> {
  const [data, setData] = React.useState<T | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetcher()
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        if (err instanceof ApiError) setError(err.message);
        else setError("加载失败，请稍后重试");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = React.useCallback(() => setTick((t) => t + 1), []);

  return { data, loading, error, reload, setData };
}

/** 读取初始 URL 查询参数（CSR 一次性，避免 useSearchParams 的 Suspense 约束） */
export function useInitialQueryParam(key: string): string {
  const [value] = React.useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get(key) ?? "";
  });
  return value;
}

/** 简易分页信息 */
export function usePagination(total: number, pageSize: number) {
  const [page, setPage] = React.useState(1);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  React.useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);
  return { page: safePage, setPage, totalPages };
}
