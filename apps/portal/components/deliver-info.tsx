"use client";

import * as React from "react";
import { Copy, Check } from "lucide-react";

import { useToast } from "@/components/ui/toast";

/** 交付信息展示：key-value 列表 + 一键复制 */
export function DeliverInfo({ data }: { data: Record<string, unknown> }) {
  const { toast } = useToast();
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null);

  const entries = Object.entries(data);
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">暂无交付信息</p>;
  }

  const copy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      toast({ title: "已复制", variant: "success" });
      window.setTimeout(() => setCopiedKey(null), 1500);
    } catch {
      toast({ title: "复制失败，请手动选择复制", variant: "error" });
    }
  };

  const formatValue = (value: unknown): string => {
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  };

  return (
    <dl className="space-y-2.5">
      {entries.map(([key, value]) => {
        const text = formatValue(value);
        return (
          <div
            key={key}
            className="flex flex-col gap-1 rounded-md bg-muted/50 px-3 py-2 sm:flex-row sm:items-center sm:gap-3"
          >
            <dt className="w-32 shrink-0 text-xs text-muted-foreground sm:text-sm">{key}</dt>
            <dd className="min-w-0 flex-1 break-all font-mono text-sm">{text}</dd>
            <button
              type="button"
              onClick={() => void copy(key, text)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
              aria-label={`复制 ${key}`}
            >
              {copiedKey === key ? (
                <Check className="h-3.5 w-3.5 text-emerald-600" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        );
      })}
    </dl>
  );
}
