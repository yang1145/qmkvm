import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

/** 统一导出的国际化导航工具，组件内请使用这些封装而非 next/link */
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
