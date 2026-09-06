import { NextResponse } from "next/server";
import { z } from "zod";

// EdgeOne Makers：Next.js API Routes 自动部署为 Cloud Functions（PRD 10.2）
// 也可按需迁移到 /edge-functions 目录（仅 JavaScript，限制：代码包 5MB / body 1MB / CPU 200ms）

const contactSchema = z.object({
  name: z.string().min(1).max(80),
  email: z.email(),
  company: z.string().max(120).optional(),
  needType: z.string().max(80).optional(),
  scale: z.string().max(120).optional(),
  message: z.string().max(2000).optional(),
  privacy: z.boolean().refine((v) => v === true),
});

export type ContactPayload = z.infer<typeof contactSchema>;

/** POST /api/contact：接收联系销售表单，校验后待接入邮件/CRM/数据库（PRD 9.1） */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_body" },
      { status: 400 }
    );
  }

  const parsed = contactSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "validation_failed" },
      { status: 400 }
    );
  }

  // TODO(业务确认后启用)：
  // 1. 接入邮件 / CRM / 数据库，保存需求与联系方式
  // 2. 速率限制与垃圾提交防护（无感或低干扰方案）
  // 3. 日志脱敏，不记录个人数据原文
  // 当前仅输出脱敏日志，便于验收阶段确认链路连通
  console.info(
    `[contact] received: name=${parsed.data.name.length > 0 ? "*".repeat(parsed.data.name.length) : ""}, email=${parsed.data.email.replace(/^(.{2}).*(@.*)$/, "$1***$2")}, needType=${parsed.data.needType ?? "—"}`
  );

  return NextResponse.json({ ok: true });
}
