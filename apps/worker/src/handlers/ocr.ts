/**
 * ocr 组 handler：身份证正面照异步识别（薄包装）。
 *
 * ocr.verify job 的注册入口；核心识别 + user_profiles 回写逻辑已下沉
 * packages/core/src/ocr/verify.ts（与 API inline 降级路径共用，行为一致）。
 * 订阅队列：kvm-ocr（分组模式）/ kvm（单队列模式兜底）。
 * 凭据边界：tesseract 二进制/语言包经环境变量（TESSERACT_BIN/TESSERACT_LANG）
 * 配置，本组进程需能访问识别程序；不触达支付/供应凭据。
 */
import { getDb } from "@qmkvm/db";
import { ocrVerifyHandler, registerJobHandler } from "@qmkvm/core";

type Db = ReturnType<typeof getDb>;

/** ocr 组注册：OCR 异步识别（重 CPU，独立组便于资源隔离扩缩容） */
export function registerOcrHandlers(db: Db): void {
  registerJobHandler("ocr.verify", (data) => ocrVerifyHandler(db, data));
}