import { notFound } from "next/navigation";

// 未知路由兜底：显式调用 notFound()，使 [locale]/not-found.tsx 生效（next-intl 约定）
export default function CatchAllPage() {
  notFound();
}
