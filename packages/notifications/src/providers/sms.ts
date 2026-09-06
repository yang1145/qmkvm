/** 短信通道：SMS_PROVIDER=aliyun 且 ALIYUN_SMS_* 齐全时走官方 SDK，否则 mock（仅记日志） */

import { createLogger } from "@pinhaoji/logger";

const log = createLogger("notifications:sms");

export interface SendSmsResult {
  ok: boolean;
  provider: "aliyun" | "mock";
  messageId?: string;
  error?: string;
}

/** 本地脱敏（避免手机号明文进日志） */
function maskPhone(p: string): string {
  if (p.length < 7) return "****";
  return `${p.slice(0, 3)}****${p.slice(-4)}`;
}

/** 阿里云短信是否已配置齐全 */
function isAliyunConfigured(): boolean {
  return Boolean(
    process.env.SMS_PROVIDER === "aliyun" &&
      process.env.ALIYUN_SMS_ACCESS_KEY_ID &&
      process.env.ALIYUN_SMS_SECRET &&
      process.env.ALIYUN_SMS_SIGN_NAME &&
      process.env.ALIYUN_SMS_TEMPLATE_CODE,
  );
}

async function getAliyunClient() {
  // 动态导入：mock 环境无需加载 SDK
  const [dysmsapi, openapiCore] = await Promise.all([
    import("@alicloud/dysmsapi20170525"),
    import("@alicloud/openapi-core"),
  ]);
  const config = new openapiCore.$OpenApiUtil.Config({
    accessKeyId: process.env.ALIYUN_SMS_ACCESS_KEY_ID,
    accessKeySecret: process.env.ALIYUN_SMS_SECRET,
  });
  config.endpoint = "dysmsapi.aliyuncs.com";
  return { client: new dysmsapi.default(config), SendSmsRequest: dysmsapi.SendSmsRequest };
}

/**
 * 发送短信正文。P0 经阿里云模板通道发送：模板变量固定为 {"content": text}
 * （模板形如「${content}」，正文已由模板渲染层组装）。
 */
export async function sendSms(phone: string, text: string): Promise<SendSmsResult> {
  if (!isAliyunConfigured()) {
    log.info({ phone: maskPhone(phone), text }, "短信(mock)");
    return { ok: true, provider: "mock" };
  }

  try {
    const { client, SendSmsRequest } = await getAliyunClient();
    const response = await client.sendSms(
      new SendSmsRequest({
        phoneNumbers: phone,
        signName: process.env.ALIYUN_SMS_SIGN_NAME,
        templateCode: process.env.ALIYUN_SMS_TEMPLATE_CODE,
        templateParam: JSON.stringify({ content: text }),
      }),
    );
    const body = response.body;
    if (body?.code === "OK") {
      log.info({ phone: maskPhone(phone), bizId: body.bizId }, "短信已提交");
      return { ok: true, provider: "aliyun", messageId: body.bizId };
    }
    const error = `阿里云短信失败: ${body?.code ?? "UNKNOWN"} ${body?.message ?? ""}`.trim();
    log.error({ phone: maskPhone(phone), error }, "短信发送失败");
    return { ok: false, provider: "aliyun", error };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error({ err, phone: maskPhone(phone) }, "短信发送异常");
    return { ok: false, provider: "aliyun", error };
  }
}
