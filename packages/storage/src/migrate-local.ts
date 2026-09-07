/**
 * 历史本地文件 → S3 迁移脚本（第一步：只上传 + 产出报告，不改 DB）。
 *
 * ⚠️ 边界说明（人工确认边界，写在脚本注释里）：
 * 本脚本只遍历 uploadDir 把文件上传到 S3 并打印 key 映射表（旧绝对路径 → 新 key），
 * 不直接改任何数据库记录。DB 侧（user_profiles.id_front_path 等、attachments.stored_path）
 * 的更新属于第二步，必须在人工核对本脚本产出的报告并确认映射无误后另行执行。
 *
 * 用法（在仓库根目录）：
 *   # .env 中配置 STORAGE_PROVIDER=s3 及 STORAGE_S3_* 各项
 *   pnpm --filter @qmkvm/storage exec tsx src/migrate-local.ts           # 演练（默认，不写 S3）
 *   pnpm --filter @qmkvm/storage exec tsx src/migrate-local.ts --apply   # 实际上传到 S3
 *   pnpm --filter @qmkvm/storage exec tsx src/migrate-local.ts --apply --json > report.json
 *
 * 输出：每行一条映射 `{ from(旧绝对路径), key(新 key), size, uploaded }`，
 * 结尾打印汇总；--json 时输出 JSON 数组（供第二步脚本消费）。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { readStorageEnv, S3StorageProvider, mimeFromExt, type StorageEnv } from "./index.js";

interface MigrationRow {
  /** DB 中的旧值（绝对路径） */
  from: string;
  /** 迁移后的存储 key（第二步人工确认后写回 DB 的值） */
  key: string;
  bytes: number;
  contentType: string | undefined;
  /** 是否实际上传（演练模式恒为 false） */
  uploaded: boolean;
  error?: string;
}

async function* walk(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return; // uploadDir 不存在等
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.isFile()) yield full;
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const jsonOut = process.argv.includes("--json");
  const env: StorageEnv = readStorageEnv();
  const root = path.resolve(env.uploadDir);

  if (env.provider !== "s3") {
    console.error("[migrate] 当前 STORAGE_PROVIDER 不是 s3。请在 .env 配置 STORAGE_PROVIDER=s3 与 STORAGE_S3_* 后重试。");
    process.exit(1);
  }
  if (!env.s3Bucket || !env.s3Endpoint) {
    console.error("[migrate] 缺少 STORAGE_S3_ENDPOINT / STORAGE_S3_BUCKET 配置。");
    process.exit(1);
  }

  const s3 = new S3StorageProvider(env);
  const rows: MigrationRow[] = [];
  let failed = 0;

  for await (const abs of walk(root)) {
    const rel = path.relative(root, abs).split(path.sep).join("/");
    try {
      const data = await fs.readFile(abs);
      const ext = path.extname(abs).toLowerCase();
      const contentType = mimeFromExt(ext);
      let uploaded = false;
      if (apply) {
        await s3.put(rel, data, contentType);
        uploaded = true;
      }
      rows.push({ from: abs, key: rel, bytes: data.byteLength, contentType, uploaded });
      if (!jsonOut) {
        console.log(`[migrate] ${apply ? "UPLOADED" : "DRY-RUN"} ${rel}  <-  ${abs}  (${data.byteLength} bytes)`);
      }
    } catch (err) {
      failed++;
      rows.push({ from: abs, key: rel, bytes: 0, contentType: undefined, uploaded: false, error: String(err) });
      if (!jsonOut) console.error(`[migrate] FAILED ${abs}: ${String(err)}`);
    }
  }

  const okRows = rows.filter((r) => !r.error);
  if (jsonOut) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    console.log(
      `[migrate] 完成：扫描 ${rows.length} 个文件，成功 ${okRows.length}，失败 ${failed}，模式=${apply ? "APPLY（已上传 S3）" : "DRY-RUN（未写 S3）"}，bucket 前缀=${env.s3BucketPrefix ?? "(无)"}`,
    );
    console.log("[migrate] 本脚本未修改任何数据库记录。请核对上方 key 映射表，人工确认后另行执行第二步 DB 回写。");
  }
  if (failed > 0) process.exitCode = 2;
}

main().catch((err) => {
  console.error("[migrate] 致命错误：", err);
  process.exit(1);
});