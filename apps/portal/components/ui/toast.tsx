"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { setApiErrorHandler } from "@/lib/api";

const toastVariants = cva(
  "pointer-events-auto relative flex w-full max-w-sm items-start gap-2 rounded-lg border p-4 pr-10 shadow-lg transition-all",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        success: "border-emerald-200 bg-card text-card-foreground",
        error: "border-red-200 bg-card text-card-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface ToastItem {
  id: number;
  title: string;
  description?: string;
  variant?: "default" | "success" | "error";
}

interface ToastContextValue {
  toast: (t: Omit<ToastItem, "id">) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast 必须在 ToastProvider 内使用");
  return ctx;
}

let globalToastFn: ((title: string, description?: string) => void) | null = null;

export function setGlobalErrorHandler(fn: (title: string, description?: string) => void) {
  globalToastFn = fn;
}

export function globalErrorToast(title: string, description?: string) {
  globalToastFn?.(title, description);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const seq = React.useRef(0);

  const dismiss = React.useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback(
    (t: Omit<ToastItem, "id">) => {
      const id = ++seq.current;
      setToasts((prev) => [...prev.slice(-4), { ...t, id }]);
      window.setTimeout(() => dismiss(id), 4500);
    },
    [dismiss],
  );

  const value = React.useMemo<ToastContextValue>(
    () => ({
      toast,
      success: (title, description) => toast({ title, description, variant: "success" }),
      error: (title, description) => toast({ title, description, variant: "error" }),
    }),
    [toast],
  );

  React.useEffect(() => {
    setGlobalErrorHandler((title, description) => toast({ title, description, variant: "error" }));
    // api 层非 silent 请求的错误统一弹全局 Toast
    setApiErrorHandler((message) => toast({ title: message, variant: "error" }));
  }, [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed left-1/2 top-4 z-[100] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4 sm:left-auto sm:right-4 sm:translate-x-0 sm:px-0">
        {toasts.map((t) => (
          <div key={t.id} className={cn(toastVariants({ variant: t.variant }))}>
            <div className="min-w-0 flex-1">
              <div
                className={cn(
                  "text-sm font-medium",
                  t.variant === "error" && "text-red-700",
                  t.variant === "success" && "text-emerald-700",
                )}
              >
                {t.title}
              </div>
              {t.description ? (
                <div className="mt-0.5 text-sm text-muted-foreground">{t.description}</div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
              aria-label="关闭提示"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
