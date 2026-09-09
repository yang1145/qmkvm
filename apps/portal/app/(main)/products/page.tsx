"use client";

import * as React from "react";
import Link from "next/link";
import { productGroupDto } from "@qmkvm/contracts";
import { z } from "zod";

import { api } from "@/lib/api";
import { useApiData } from "@/hooks/use-api";
import { formatCny } from "@/lib/format";
import type { Product } from "@/lib/schemas";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

/** 从商品定价中取出最低首价（用于列表展示） */
function lowestFirstPrice(product: Product): number | null {
  if (product.pricing.length === 0) return null;
  return Math.min(...product.pricing.map((p) => p.firstPrice));
}

export default function ProductsPage() {
  const catalogState = useApiData(
    () => api.get("/catalog", { parse: z.array(productGroupDto) }),
    [],
  );

  if (catalogState.loading) {
    return (
      <div className="space-y-8">
        <PageHeader title="商品中心" description="选择适合您的云产品" />
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  if (catalogState.error) {
    return (
      <div className="space-y-6">
        <PageHeader title="商品中心" description="选择适合您的云产品" />
        <ErrorState message={catalogState.error} onRetry={catalogState.reload} />
      </div>
    );
  }

  const groups = catalogState.data ?? [];

  return (
    <div className="space-y-10">
      <PageHeader title="商品中心" description="选择适合您的云产品，配置后加入购物车" />

      {groups.length === 0 ? (
        <EmptyState title="暂无在售商品" description="商品上架后将在这里展示" />
      ) : (
        groups.map((group) => (
          <section key={group.id}>
            <div className="mb-4">
              <h2 className="text-lg font-semibold">{group.name}</h2>
              {group.description ? (
                <p className="mt-0.5 text-sm text-muted-foreground">{group.description}</p>
              ) : null}
            </div>
            {group.products.length === 0 ? (
              <EmptyState title="该分组暂无商品" />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {group.products.map((product) => {
                  const price = lowestFirstPrice(product);
                  return (
                    <Link
                      key={product.id}
                      href={`/products/detail?slug=${product.slug}`}
                      className="flex flex-col rounded-lg border bg-card p-5 shadow-sm transition-colors hover:border-primary/50 hover:bg-accent/30"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-semibold">{product.name}</h3>
                        {!product.inStock ? (
                          <Badge variant="muted">缺货</Badge>
                        ) : product.stockTotal !== null &&
                          product.stockTotal - product.stockUsed <= 5 ? (
                          <Badge variant="warning">库存紧张</Badge>
                        ) : null}
                      </div>
                      {product.tagline ? (
                        <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">
                          {product.tagline}
                        </p>
                      ) : null}
                      <div className="mt-auto flex items-baseline gap-1 pt-4">
                        {price !== null ? (
                          <>
                            <span className="text-lg font-semibold text-primary tabular-nums">
                              {formatCny(price)}
                            </span>
                            <span className="text-xs text-muted-foreground">起</span>
                          </>
                        ) : (
                          <span className="text-sm text-muted-foreground">价格详询客服</span>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>
        ))
      )}
    </div>
  );
}
