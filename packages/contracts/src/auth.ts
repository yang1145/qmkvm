import { z } from "zod";

/** —— 认证与账户 DTO —— */

export const PHONE_RE = /^1[3-9]\d{9}$/;
export const phoneSchema = z.string().regex(PHONE_RE, "手机号格式不正确");
export const emailSchema = z.string().email("邮箱格式不正确").max(255);
/** ≥8 位且含字母与数字 */
export const passwordSchema = z
  .string()
  .min(8, "密码至少 8 位")
  .max(72)
  .regex(/[A-Za-z]/, "密码需包含字母")
  .regex(/\d/, "密码需包含数字");

export const smsPurposeSchema = z.enum(["login", "reset", "bind"]);

/** 发送短信验证码（login=注册登录合一） */
export const smsSendSchema = z.object({
  phone: phoneSchema,
  purpose: smsPurposeSchema,
  /** 人机验证票据（接入验证码服务商后必填） */
  captchaToken: z.string().max(2048).optional(),
});

/** 手机号 + 验证码：注册登录合一 */
export const smsLoginSchema = z.object({
  phone: phoneSchema,
  code: z.string().length(6),
  name: z.string().max(100).optional(),
});

/** 邮箱注册 */
export const emailRegisterSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().max(100).optional(),
});

/** 密码登录：login 支持邮箱或手机号 */
export const passwordLoginSchema = z.object({
  login: z.string().min(1).max(255),
  password: z.string().min(1).max(72),
});

/** 忘记密码：发起（二选一） */
export const forgotPasswordSchema = z
  .object({ phone: phoneSchema.optional(), email: emailSchema.optional() })
  .refine((v) => v.phone || v.email, { message: "手机号与邮箱至少填一项" });

/** 手机号验证码重置密码 */
export const resetPasswordBySmsSchema = z.object({
  phone: phoneSchema,
  code: z.string().length(6),
  password: passwordSchema,
});

/** 邮箱令牌重置密码 */
export const resetPasswordByTokenSchema = z.object({
  token: z.string().min(10).max(128),
  password: passwordSchema,
});

export const updateProfileSchema = z.object({
  name: z.string().max(100).optional(),
  email: emailSchema.optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(72),
  newPassword: passwordSchema,
});

export const bindPhoneSchema = z.object({
  phone: phoneSchema,
  code: z.string().length(6),
  /** 当前密码（已设密码时必填，防会话劫持换绑） */
  password: z.string().max(72).optional(),
});

export const userProfileSchema = z.object({
  id: z.number(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  name: z.string().nullable(),
  creditBalance: z.number().int(),
  createdAt: z.string(),
});

export const authResultSchema = z.object({
  user: userProfileSchema,
});

export type AuthResult = z.infer<typeof authResultSchema>;
