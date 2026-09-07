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
} as const;

export const COOKIE_PORTAL = "kvm_session";
export const COOKIE_ADMIN = "kvm_admin";
