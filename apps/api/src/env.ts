export const env = {
  port: Number(process.env.API_PORT ?? 4000),
  corsOrigins: (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,
  isProd: process.env.NODE_ENV === "production",
  devMockPayments: process.env.DEV_MOCK_PAYMENTS === "true",
  portalUrl: process.env.PORTAL_URL ?? "http://localhost:3001",
  adminUrl: process.env.ADMIN_URL ?? "http://localhost:3002",
  uploadDir: process.env.UPLOAD_DIR ?? "./uploads",
  // 存储抽象（@qmkvm/storage）：local=本地盘（缺省，与历史行为一致）；s3=S3 兼容对象存储
  storageProvider: process.env.STORAGE_PROVIDER === "s3" ? ("s3" as const) : ("local" as const),
  storageS3Endpoint: process.env.STORAGE_S3_ENDPOINT || undefined,
  storageS3Region: process.env.STORAGE_S3_REGION || undefined,
  storageS3Bucket: process.env.STORAGE_S3_BUCKET || undefined,
  storageS3AccessKey: process.env.STORAGE_S3_ACCESS_KEY || undefined,
  storageS3Secret: process.env.STORAGE_S3_SECRET || undefined,
  storageS3BucketPrefix: process.env.STORAGE_S3_BUCKET_PREFIX || undefined,
} as const;

export const COOKIE_PORTAL = "kvm_session";
export const COOKIE_ADMIN = "kvm_admin";
