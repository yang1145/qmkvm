/**
 * 存储抽象层：统一本地盘 / S3 兼容对象存储（MinIO、阿里 OSS、腾讯 COS 等）双实现。
 *
 * 设计要点（架构演进 #1）：
 * - DB 里存的是 key（相对 key，如 identity/12/front-1690000000000.jpg 或
 *   tickets/88/1690000000000-截图.png），不再存绝对路径；
 * - 本地盘模式下 key 与历史绝对路径兼容：读侧 readPath() 对以 uploadDir 开头的
 *   历史绝对路径按旧逻辑读，否则按 key 拼 uploadDir 读（历史数据零迁移）；
 * - S3 模式依赖 @aws-sdk/client-s3（懒加载，安装缺失时 available=false 并降级本地盘）；
 * - 本包不依赖任何 @qmkvm/* 包，纯独立（node:fs/path + aws-sdk）。
 */
import path from "node:path";
import fs from "node:fs/promises";

// ---------------------------------------------------------------------------
// env
// ---------------------------------------------------------------------------

export interface StorageEnv {
  /** local | s3（缺省 local，行为与历史版本一致） */
  provider: "local" | "s3";
  /** 本地盘根目录（UPLOAD_DIR，缺省 ./uploads，与历史行为一致） */
  uploadDir: string;
  s3Endpoint?: string;
  s3Region?: string;
  s3Bucket?: string;
  s3AccessKey?: string;
  s3Secret?: string;
  /** 同一 bucket 承载多环境时的 key 前缀，如 "dev/"、"prod/" */
  s3BucketPrefix?: string;
}

function pickProvider(v: string | undefined): "local" | "s3" {
  if (v === "s3") return "s3";
  return "local";
}

export function readStorageEnv(source: Record<string, string | undefined> = process.env): StorageEnv {
  return {
    provider: pickProvider(source.STORAGE_PROVIDER),
    uploadDir: path.resolve(source.UPLOAD_DIR ?? "./uploads"),
    s3Endpoint: source.STORAGE_S3_ENDPOINT || undefined,
    s3Region: source.STORAGE_S3_REGION || undefined,
    s3Bucket: source.STORAGE_S3_BUCKET || undefined,
    s3AccessKey: source.STORAGE_S3_ACCESS_KEY || undefined,
    s3Secret: source.STORAGE_S3_SECRET || undefined,
    s3BucketPrefix: source.STORAGE_S3_BUCKET_PREFIX || undefined,
  };
}

export const storageEnv = readStorageEnv();

// ---------------------------------------------------------------------------
// provider 接口
// ---------------------------------------------------------------------------

export interface StoragePutResult {
  key: string;
}

export interface StorageGetResult {
  data: Buffer;
  contentType?: string;
}

export interface StorageProvider {
  /** 写入文件，返回存储 key（DB 存该值） */
  put(key: string, data: Buffer, contentType?: string): Promise<{ key: string }>;
  /** 读取文件；不存在返回 null */
  get(key: string): Promise<{ data: Buffer; contentType?: string } | null>;
  /** 删除文件；文件不存在时静默成功 */
  delete(key: string): Promise<void>;
  /** 返回可读 URL；本地盘实现返回 API 自身相对路径约定，S3 返回 presigned URL */
  presign(key: string, ttlSec: number): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// key 规范化与历史绝对路径兼容
// ---------------------------------------------------------------------------

/**
 * 规范化存储 key：绝对路径（历史数据，以 uploadDir 开头）→ 相对 key；
 * 绝对路径但不在 uploadDir 下（异常数据）→ null。
 */
export function toStorageKey(p: string, env: StorageEnv = storageEnv): string | null {
  const resolved = path.resolve(p);
  const root = path.resolve(env.uploadDir);
  if (resolved === root) return null;
  if (resolved.startsWith(root + path.sep)) {
    return path.relative(root, resolved).split(path.sep).join("/");
  }
  // 不在 uploadDir 下的绝对路径：视为历史遗留异常数据，调用方按无文件处理
  if (path.isAbsolute(p)) return null;
  // 已是相对 key：统一为 POSIX 风格
  return p.split(path.sep).join("/");
}

/**
 * 读侧兼容：历史 DB 记录里存的是绝对路径（以 uploadDir 开头按旧逻辑读），
 * 新记录是相对 key。返回绝对文件路径；无法定位返回 null。
 */
export function readLocalPath(keyOrPath: string, env: StorageEnv = storageEnv): string | null {
  const resolved = path.resolve(keyOrPath);
  const root = path.resolve(env.uploadDir);
  if (resolved.startsWith(root + path.sep)) return resolved; // 历史绝对路径，按旧逻辑读
  if (path.isAbsolute(keyOrPath)) return null; // uploadDir 之外的绝对路径：拒绝（防路径穿越）
  const joined = path.join(root, keyOrPath);
  const joinedResolved = path.resolve(joined);
  if (joinedResolved !== root && !joinedResolved.startsWith(root + path.sep)) return null;
  return joinedResolved;
}

// ---------------------------------------------------------------------------
// 本地盘实现（行为与历史代码完全一致：uploadDir/<key>）
// ---------------------------------------------------------------------------

export class LocalStorageProvider implements StorageProvider {
  constructor(readonly env: StorageEnv) {}

  async put(key: string, data: Buffer, _contentType?: string): Promise<{ key: string }> {
    const norm = this.normKey(key);
    if (!norm) throw new Error(`storage: invalid local key ${JSON.stringify(key)}`);
    const target = readLocalPath(norm, this.env);
    if (!target) throw new Error(`storage: invalid local key ${JSON.stringify(key)}`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data);
    return { key: norm };
  }

  async get(key: string): Promise<StorageGetResult | null> {
    const target = this.absPath(key);
    if (!target) return null;
    try {
      const data = await fs.readFile(target);
      return { data, contentType: mimeFromExt(path.extname(target)) };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    const target = this.absPath(key);
    if (!target) return;
    try {
      await fs.unlink(target);
    } catch {
      // 文件已不存在等情况忽略（与历史 removeFileQuiet 行为一致）
    }
  }

  /**
   * 本地盘模式返回 API 自身相对路径约定（与现状一致）：
   * 调用方（admin 图片端点）在本地盘模式下并不使用该 URL 直接回源，
   * 而是保持现有「API 读盘直接返回文件流」行为；此处返回的相对路径
   * 仅用于需要 URL 场景的统一占位（如 /storage/<key>）。
   */
  async presign(key: string, _ttlSec: number): Promise<string | null> {
    const norm = this.normKey(key);
    if (!norm) return null;
    return `/storage/${norm}`;
  }

  private normKey(key: string): string | null {
    return toStorageKey(key, this.env);
  }

  private absPath(key: string): string | null {
    const norm = this.normKey(key);
    if (!norm) return null;
    return readLocalPath(norm, this.env);
  }
}

export function mimeFromExt(extLower: string): string | undefined {
  switch (extLower) {
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".pdf":
      return "application/pdf";
    case ".zip":
      return "application/zip";
    case ".txt":
      return "text/plain";
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// S3 兼容实现（懒加载 client；安装缺失时 available=false 降级本地盘）
// ---------------------------------------------------------------------------

export interface S3ProviderStatus {
  available: boolean;
  reason?: string;
}

/** 懒加载的 S3 client 容器：import 失败（依赖缺失）时降级本地盘 */
let s3ClientPromise: Promise<S3ClientLike | null> | null = null;

/** 最小接口（避免直接把 aws-sdk 类型泄漏到模块顶层，依赖缺失时也可类型通过） */
interface S3ClientLike {
  send(command: { input: unknown }): Promise<unknown>;
}

function loadS3Client(env: StorageEnv): Promise<S3ClientLike | null> {
  if (!s3ClientPromise) {
    s3ClientPromise = (async () => {
      try {
        const { S3Client } = await import("@aws-sdk/client-s3");
        return new S3Client({
          ...(env.s3Endpoint ? { endpoint: env.s3Endpoint } : {}),
          ...(env.s3Region ? { region: env.s3Region } : {}),
          ...(env.s3AccessKey && env.s3Secret
            ? {
                credentials: {
                  accessKeyId: env.s3AccessKey,
                  secretAccessKey: env.s3Secret,
                },
              }
            : {}),
          // MinIO 等兼容存储需 path-style；AWS 官方端点会自动覆盖
          forcePathStyle: true,
        }) as unknown as S3ClientLike;
      } catch {
        return null; // 依赖缺失 → 降级
      }
    })();
  }
  return s3ClientPromise;
}

/** 检查 S3 实现是否可用（依赖安装完整且必要 env 齐备） */
export async function s3ProviderStatus(env: StorageEnv = storageEnv): Promise<S3ProviderStatus> {
  if (!env.s3Bucket) return { available: false, reason: "STORAGE_S3_BUCKET 未配置" };
  const client = await loadS3Client(env);
  if (!client) {
    return { available: false, reason: "@aws-sdk/client-s3 不可用（依赖缺失）" };
  }
  return { available: true };
}

export class S3StorageProvider implements StorageProvider {
  constructor(readonly env: StorageEnv) {}

  private fullKey(key: string): string {
    const norm = toStorageKey(key, this.env) ?? key;
    return this.env.s3BucketPrefix ? `${this.env.s3BucketPrefix}${norm}` : norm;
  }

  private async withClient<T>(fn: (client: S3ClientLike, cmds: typeof import("@aws-sdk/client-s3")) => Promise<T>): Promise<T> {
    const [client, cmds] = await Promise.all([loadS3Client(this.env), import("@aws-sdk/client-s3")]);
    if (!client) {
      throw new Error("storage: S3 provider unavailable（@aws-sdk/client-s3 加载失败）");
    }
    return fn(client, cmds);
  }

  async put(key: string, data: Buffer, contentType?: string): Promise<{ key: string }> {
    await this.withClient(async (client, cmds) => {
      await client.send(
        new cmds.PutObjectCommand({
          Bucket: this.env.s3Bucket,
          Key: this.fullKey(key),
          Body: data,
          ...(contentType ? { ContentType: contentType } : {}),
        }),
      );
    });
    return { key: toStorageKey(key, this.env) ?? key };
  }

  async get(key: string): Promise<StorageGetResult | null> {
    return this.withClient(async (client, cmds) => {
      try {
        const res = (await client.send(
          new cmds.GetObjectCommand({
            Bucket: this.env.s3Bucket,
            Key: this.fullKey(key),
          }),
        )) as { Body?: { transformToByteArray?: () => Promise<Uint8Array> }; ContentType?: string };
        if (!res.Body?.transformToByteArray) return null;
        const bytes = await res.Body.transformToByteArray();
        return { data: Buffer.from(bytes), contentType: res.ContentType ?? mimeFromExt(path.extname(key)) };
      } catch {
        return null; // NoSuchKey 等 → 视为不存在
      }
    });
  }

  async delete(key: string): Promise<void> {
    try {
      await this.withClient(async (client, cmds) => {
        await client.send(
          new cmds.DeleteObjectCommand({
            Bucket: this.env.s3Bucket,
            Key: this.fullKey(key),
          }),
        );
      });
    } catch {
      // 与本地盘 removeFileQuiet 一致：删除失败静默
    }
  }

  /** 返回 presigned GET URL（有效期 ttlSec 秒） */
  async presign(key: string, ttlSec: number): Promise<string | null> {
    return this.withClient(async (client, cmds) => {
      const presignerMod = await import("@aws-sdk/s3-request-presigner");
      const url = await presignerMod.getSignedUrl(
        client as unknown as import("@aws-sdk/client-s3").S3Client,
        new cmds.GetObjectCommand({
          Bucket: this.env.s3Bucket,
          Key: this.fullKey(key),
        }),
        { expiresIn: ttlSec },
      );
      return url;
    });
  }
}

// ---------------------------------------------------------------------------
// 单例
// ---------------------------------------------------------------------------

let singleton: StorageProvider | null = null;

/**
 * 存储单例：按 STORAGE_PROVIDER env 决定实现。
 * - local（缺省）：本地盘，行为与历史版本一致；
 * - s3：S3 兼容对象存储；若依赖缺失或 env 不齐，降级到本地盘（写日志到 stderr）。
 */
export function getStorage(env: StorageEnv = storageEnv): StorageProvider {
  if (singleton) return singleton;
  if (env.provider === "s3") {
    // 同步路径下无法等待懒加载，先给 S3 实例；首次实际 IO 时若 client 缺失会抛错，
    // 这里在创建时做一次预检（await 懒加载结果）由 getStorageAsync 兜底。
    singleton = new S3StorageProvider(env);
  } else {
    singleton = new LocalStorageProvider(env);
  }
  return singleton;
}

/**
 * 异步版 getStorage：S3 模式下先做依赖/env 预检，不可用时降级本地盘并告警。
 * API 启动与请求路径建议使用本函数（只做一次预检，之后与 getStorage 同缓存）。
 */
export async function getStorageAsync(env: StorageEnv = storageEnv): Promise<StorageProvider> {
  if (singleton) return singleton;
  if (env.provider === "s3") {
    const status = await s3ProviderStatus(env);
    if (!status.available) {
      process.stderr.write(
        `[storage] STORAGE_PROVIDER=s3 但不可用（${status.reason}），降级为本地盘实现\n`,
      );
    } else {
      singleton = new S3StorageProvider(env);
      return singleton;
    }
  }
  singleton = new LocalStorageProvider(env);
  return singleton;
}

/** 测试用：重置单例与 S3 client 缓存 */
export function __resetStorageForTests(): void {
  singleton = null;
  s3ClientPromise = null;
}