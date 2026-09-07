/**
 * OCR 验证 handler 的 API 侧实现（inline 降级模式复用）。
 * 与 worker 侧 handlers/ocr.ts 逻辑一致：识别 → 回写 ocr_id_number / ocr_status。
 * 抽成独立文件以共享核心逻辑说明：识别在两条执行路径（inline/BullMQ）行为一致。
 */
import { eq } from "drizzle-orm";
import { ocrIdCardFront } from "@qmkvm/core";
import { getDb, schema } from "@qmkvm/db";
import { logger } from "@qmkvm/logger";

const log = logger.child({ module: "api:inline-ocr" });
type Db = ReturnType<typeof getDb>;

export async function ocrVerifyHandler(
  db: Db,
  data: { profileId?: number | string; submittedIdNumber?: string | null },
): Promise<void> {
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

  log.info({ profileId, status: ocrStatus, hasNumber: !!ocr.idNumber }, "OCR 识别完成（inline）");
}