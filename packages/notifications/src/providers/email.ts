/** 邮件通道：SMTP 配置（注入或 SMTP_* 环境变量）齐全时走 nodemailer 真实发送，否则 mock（仅记日志） */

import nodemailer from "nodemailer";

import { createLogger } from "@pinhaoji/logger";

const log = createLogger("notifications:email");

export interface SendEmailResult {
  ok: boolean;
  provider: "smtp" | "mock";
  messageId?: string;
  error?: string;
}

/** 可注入的 SMTP 配置（后台「邮件设置」落库值；未传时回退 SMTP_* 环境变量） */
export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string | null;
  pass?: string | null;
  from: string;
}

/** 本地脱敏（避免收件人明文进日志） */
function maskEmail(e: string): string {
  const at = e.indexOf("@");
  if (at <= 0) return "***";
  return `${e[0]}***${e.slice(at)}`;
}

/** SMTP 是否已配置：SMTP_HOST + SMTP_FROM 必填；SMTP_PORT 缺省 587；SMTP_USER/SMTP_PASS 可选（中继模式） */
export function isSmtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

/** 由 settings 表落库的 SMTP 配置创建 transporter（供 API 测试发送等场景复用） */
export function createTransportFromSettings(cfg: SmtpConfig) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure || cfg.port === 465,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass ?? "" } : undefined,
  });
}

async function sendWithTransport(
  transporter: ReturnType<typeof nodemailer.createTransport>,
  from: string,
  to: string,
  subject: string,
  html: string,
): Promise<SendEmailResult> {
  try {
    const info = await transporter.sendMail({ from, to, subject, html });
    log.info({ to: maskEmail(to), subject, messageId: info.messageId }, "邮件已发送");
    return { ok: true, provider: "smtp", messageId: info.messageId };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error({ err, to: maskEmail(to), subject }, "邮件发送失败");
    return { ok: false, provider: "smtp", error };
  }
}

/**
 * 发送邮件。smtpConfig 未传（或缺 host/from）时回退 SMTP_* 环境变量；
 * 两侧都不可用则 mock（仅记日志，返回 ok:true, provider:"mock"）。
 * 保持既有调用方 sendEmail(to, subject, html) 兼容。
 */
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  smtpConfig?: SmtpConfig,
): Promise<SendEmailResult> {
  if (smtpConfig?.host && smtpConfig?.from) {
    const transporter = createTransportFromSettings(smtpConfig);
    return sendWithTransport(transporter, smtpConfig.from, to, subject, html);
  }

  if (!isSmtpConfigured()) {
    log.info({ to: maskEmail(to), subject }, "邮件(mock)");
    return { ok: true, provider: "mock" };
  }

  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: user ? { user, pass: process.env.SMTP_PASS ?? "" } : undefined,
  });
  return sendWithTransport(transporter, process.env.SMTP_FROM as string, to, subject, html);
}
