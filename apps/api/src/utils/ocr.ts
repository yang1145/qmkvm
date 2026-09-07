/**
 * 身份证正面照 OCR（node-tesseract-ocr 封装）。
 * 仅用于辅助核对身份证号：提取 18 位证件号并做 GB11643 校验码验证；
 * tesseract 二进制或语言包缺失时视为「OCR 不可用」，不阻断提交流程。
 */
import tesseract from "node-tesseract-ocr";

const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const ID_CHECK_CODES = ["1", "0", "X", "9", "8", "7", "6", "5", "4", "3", "2"];

/** GB11643-1999 校验码验证：可靠的证件号才用于比对，避免 OCR 噪声误判 */
export function isValidIdNumber(id: string): boolean {
  if (!/^\d{17}[\dX]$/.test(id)) return false;
  const sum = ID_WEIGHTS.reduce((acc, w, i) => acc + w * Number(id[i]), 0);
  return ID_CHECK_CODES[sum % 11] === id[17];
}

/** 从 OCR 文本中提取证件号：去空白后找 18 位候选，优先取校验通过的 */
export function extractIdNumber(text: string): string | null {
  const digits = text.replace(/\s+/g, "").toUpperCase();
  const candidates = digits.match(/\d{17}[\dX]/g) ?? [];
  return candidates.find(isValidIdNumber) ?? candidates[0] ?? null;
}

export interface IdCardOcrResult {
  /** tesseract 是否可执行（二进制缺失/超时为 false） */
  available: boolean;
  /** 提取到的证件号（无可靠结果为 null） */
  idNumber: string | null;
  /** 提取号是否通过校验码验证（available=false 时为 null） */
  verified: boolean | null;
  raw: string;
}

export async function ocrIdCardFront(
  input: string | Buffer,
  opts: { lang?: string; timeoutMs?: number } = {},
): Promise<IdCardOcrResult> {
  const lang = opts.lang ?? process.env.TESSERACT_LANG ?? "chi_sim+eng";
  const binary = process.env.TESSERACT_BIN ?? "tesseract";
  const timeoutMs = opts.timeoutMs ?? 15000;
  try {
    const raw = await Promise.race([
      tesseract.recognize(input, { lang, oem: 1, psm: 3, binary }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("ocr timeout")), timeoutMs),
      ),
    ]);
    const idNumber = extractIdNumber(String(raw));
    return {
      available: true,
      idNumber,
      verified: idNumber ? isValidIdNumber(idNumber) : false,
      raw: String(raw),
    };
  } catch {
    return { available: false, idNumber: null, verified: null, raw: "" };
  }
}
