/**
 * ocr.verify handler 的 API 侧薄包装（inline 降级模式复用）。
 *
 * 核心识别 + user_profiles 回写逻辑已下沉 packages/core/src/ocr/verify.ts
 * （ocrVerifyHandler），worker 侧与 API inline 侧共用同一实现，
 * 保证两条执行路径（inline/BullMQ）行为一致。本文件仅保留模块别名转发。
 */
import { ocrVerifyHandler as coreOcrVerifyHandler } from "@qmkvm/core";
import { getDb } from "@qmkvm/db";
import type { OcrVerifyData } from "@qmkvm/core";

type Db = ReturnType<typeof getDb>;

/** 兼容旧导入路径：直接转发 core 实现（db 连接由调用方传入） */
export async function ocrVerifyHandler(db: Db, data: OcrVerifyData): Promise<void> {
  await coreOcrVerifyHandler(db, data);
}