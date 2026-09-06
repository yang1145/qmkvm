/** 邮件通道：SMTP_* 齐全时走 nodemailer 真实发送，否则 mock（仅记日志） */

import nodemailer from "nodemailer";

import { createLogger } from "@pinhaoji/logger";

const log = createLogger("notifications:email");

export interface SendEmailResult {
  ok: boolean;
  provider: "smtp" | "mock";
  messageId?: string;
  error?: string;
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

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
): Promise<SendEmailResult> {
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

  try {
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to,
      subject,
      html,
    });
    log.info({ to: maskEmail(to), subject, messageId: info.messageId }, "邮件已发送");
    return { ok: true, provider: "smtp", messageId: info.messageId };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error({ err, to: maskEmail(to), subject }, "邮件发送失败");
    return { ok: false, provider: "smtp", error };
  }
}
