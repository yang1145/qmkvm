import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

// Next.js 16：proxy（原 middleware）用于国际化语言检测与重写
export default createMiddleware(routing);

export const config = {
  // 匹配所有路径，排除 api、_next 与静态资源
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
