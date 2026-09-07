/**
 * ocr.verify 任务核心实现：身份证正面照识别 + user_profiles 回写。
 *
 * 由 API（inline 降级，wiring.ts 注册）与 worker（ocr 组 handler）共用，
 * 保证两条执行路径（inline/BullMQ）行为一致；db 连接由调用方传入
 * （core 不持有连接，见 billing/lifecycle 同款参数约定）。
 *
 * 流程：读取 user_profiles.id_front_path → OcrProvider 识别 → 回写
 * ocr_id_number / ocr_status（matched / unavailable）。
 * 提交侧只入队不等待；识别失败按 unavailable 兜底，不阻断人工审核。
 */
import { eq } from "drizzle-orm";
import { schema, type Db } from "@qmkvm/db/client";
import { logger } from "@qmkvm/logger";
import { ocrIdCardFront } from "./index.js";

const log = logger.child({ module: "core:ocr-verify" });

/** ocr.verify 任务入参（提交侧 enqueueJob("ocr.verify", data) 的 data） */
export interface OcrVerifyData {
  /** user_profiles 主键 */
  profileId?: number | string;
  /** 用户提交的证件号（匹配一致才置 matched） */
  submittedIdNumber?: string | null;
}

/**
 * 处理 ocr.verify 任务：识别正面照并回写核验结果。
 * 缺 profileId 或无正面照记录时记 warn 跳过（不抛错——识别为辅助流程，不重试）。
 */
export async function ocrVerifyHandler(db: Db, data: OcrVerifyData): Promise<void> {
  const profileId = Number(data?.profileId);
  if (!Number.isFinite(profileId)) {
    log.warn({ data }, "ocr.verify 缺少 profileId，跳过");
    return;
  }
  const rows = await db
    .select()
    .from(schema.userProfiles)
    .where(eq(schema.userProfiles.id, profileId))
    .limit(1);
  const profile = rows[0];
  if (!profile?.idFrontPath) {
    log.warn({ profileId }, "ocr.verify 无正面照记录，跳过");
    return;
  }

  const ocr = await ocrIdCardFront(profile.idFrontPath);
  const submitted = data?.submittedIdNumber?.trim().toUpperCase();
  let ocrStatus: "matched" | "unavailable" = "unavailable";
  if (ocr.idNumber && ocr.verified && submitted && ocr.idNumber === submitted) {
    ocrStatus = "matched";
  }

  await db
    .update(schema.userProfiles)
    .set({ ocrIdNumber: ocr.idNumber, ocrStatus, updatedAt: new Date() })
    .where(eq(schema.userProfiles.id, profileId));

  log.info({ profileId, status: ocrStatus, hasNumber: !!ocr.idNumber }, "OCR 识别完成并回写");
}