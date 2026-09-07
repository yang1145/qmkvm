# @qmkvm/admin

启明智联业务管理系统管理后台，基于 Ant Design Pro（umi max）。

## 开发

```bash
# 仓库根目录
pnpm install
pnpm --filter @qmkvm/admin dev
```

- 开发代理：`/api` → `http://localhost:4000`（见 config/proxy.ts）
- 测试账号：admin / admin12345
- 后端管理端 API 前缀：`/api/v1/admin`

## 构建 / 类型检查

```bash
pnpm --filter @qmkvm/admin build
pnpm --filter @qmkvm/admin typecheck
```