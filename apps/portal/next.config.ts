import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

const appRoot = import.meta.dirname;
const repoRoot = path.resolve(appRoot, "../..");
const contractsSrc = path.resolve(repoRoot, "packages/contracts/src");

/**
 * contracts 包按仓库约定以 TS 源码 + ".js" 后缀相对导入编写（供 tsc/tsx 消费）。
 * Turbopack 不做 ".js"→".ts" 的解析映射，因此这里在构建/启动时生成一份
 * 去掉 ".js" 后缀的兼容副本（apps/portal/contracts-compat，已在 tsconfig 与
 * git 中排除），并把包名别名到该副本。schemas 内容与源包保持一致。
 */
const compatDir = path.resolve(appRoot, "contracts-compat");

function generateContractsCompat(): string {
  fs.rmSync(compatDir, { recursive: true, force: true });
  fs.mkdirSync(compatDir, { recursive: true });
  for (const file of fs.readdirSync(contractsSrc)) {
    if (!file.endsWith(".ts")) continue;
    const source = fs.readFileSync(path.join(contractsSrc, file), "utf8");
    const rewritten = source.replace(/from "\.\/([A-Za-z0-9_-]+)\.js"/g, 'from "./$1"');
    fs.writeFileSync(path.join(compatDir, file), rewritten, "utf8");
  }
  return path.join(compatDir, "index.ts");
}

const contractsCompatEntry = generateContractsCompat();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@qmkvm/contracts"],
  turbopack: {
    resolveAlias: {
      // 相对请求（相对本应用根目录）
      "@qmkvm/contracts": "./contracts-compat/index.ts",
    },
  },
};

export default nextConfig;
