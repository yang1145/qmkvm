/**
 * ocr 组：身份证正面照异步识别。
 *
 * ocr.verify handler：读取 user_profiles 里的正面照路径 → 调 OcrProvider 识别 →
 * 回写 ocr_id_number / ocr_status（matched / unavailable）。
 * 提交侧只入队不等待；识别失败按 unavailable 兜底，不阻断人工审核。
 */
import { eq } from "drizzle-orm";
import { getDb, schema } from "@qmkvm/db";
import { logger } from "@qmkvm/logger";
import { ocrIdCardFront } from "@qmkvm/core";

const log = logger.child({ module: "worker:ocr" });
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
  if (ocr.idNumber) {
    if (ocr.verified && submitted && ocr.idNumber === submitted) ocrStatus = "matched";
  }

  await db
    .update(schema.userProfiles)
    .set({
      ocrIdNumber: ocr.idNumber,
      ocrStatus,
      updatedAt: new Date(),
    })
    .where(eq(schema.userProfiles.id, profileId));

  log.info({ profileId, status: ocrStatus, hasNumber: !!ocr.idNumber }, "OCR 异步识别完成");
}