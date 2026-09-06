/**
 * 后台登录图形验证码（纯 node 生成 SVG，无 canvas 依赖）。
 *
 * - 4 位易读字符（剔除 0/O/1/l/I 等易混字符）；
 * - 手绘 SVG：逐字符随机旋转/偏移/字号 + 噪声线 + 干扰点；
 * - 答案 sha256 后存 Redis（key=captcha:{id}，TTL 5 分钟）；无 Redis 时用进程 Map 兜底；
 * - 一次性消费：无论对错，校验一次后即作废（错误尝试由调用方计入限流/作废逻辑）。
 */
import { createHash, randomBytes, randomInt } from "node:crypto";
import { getRedis } from "@pinhaoji/db/redis";

const CAPTCHA_TTL_SEC = 5 * 60;

/** 易读字符集（去除 0O1lI + 2/9 等形近项保留可读性） */
const CHARS = "2345678abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";

const COLORS = ["#1f77b4", "#2ca02c", "#d62728", "#9467bd", "#ff7f0e", "#17becf"];

function pick<T>(arr: readonly T[]): T {
  return arr[randomInt(0, arr.length)] as T;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** 进程内兜底存储（无 Redis）：id → sha256(答案) */
const memoryStore = new Map<string, { hash: string; expiresAt: number }>();

function sha256(v: string): string {
  return createHash("sha256").update(v).digest("hex");
}

function keyOf(id: string): string {
  return `captcha:${id}`;
}

/** 生成验证码：返回 id / SVG / 明文答案（仅测试/调试使用，不对外返回） */
export function generateCaptcha(): { id: string; svg: string; answer: string } {
  let answer = "";
  for (let i = 0; i < 4; i += 1) answer += CHARS[randomInt(0, CHARS.length)];

  const id = randomBytes(16).toString("hex");
  const hash = sha256(answer.toLowerCase()); // 校验端统一小写比较（大小写不敏感）
  const redis = getRedis();
  if (redis) {
    void redis.set(keyOf(id), hash, "EX", CAPTCHA_TTL_SEC).catch(() => {
      memoryStore.set(id, { hash, expiresAt: Date.now() + CAPTCHA_TTL_SEC * 1000 });
    });
  } else {
    memoryStore.set(id, { hash, expiresAt: Date.now() + CAPTCHA_TTL_SEC * 1000 });
  }

  return { id, svg: renderSvg(answer), answer };
}

/** 渲染手绘风 SVG：扭曲文字 + 噪声线 + 干扰点 */
function renderSvg(text: string): string {
  const width = 130;
  const height = 44;
  const parts: string[] = [];

  parts.push(
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#f6f8fa" rx="4" ry="4"/>`,
  );

  // 噪声线：3-4 条随机贝塞尔/折线
  const lineCount = 3 + randomInt(0, 2);
  for (let i = 0; i < lineCount; i += 1) {
    const color = pick(COLORS);
    const x1 = rand(0, width * 0.3);
    const y1 = rand(4, height - 4);
    const x2 = rand(width * 0.7, width);
    const y2 = rand(4, height - 4);
    const cx = rand(width * 0.3, width * 0.7);
    const cy = rand(4, height - 4);
    parts.push(
      `<path d="M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${color}" stroke-width="${rand(0.6, 1.4).toFixed(2)}" fill="none" opacity="0.5"/>`,
    );
  }

  // 干扰点：30 个左右
  for (let i = 0; i < 30; i += 1) {
    parts.push(
      `<circle cx="${rand(2, width - 2).toFixed(1)}" cy="${rand(2, height - 2).toFixed(1)}" r="${rand(0.6, 1.6).toFixed(2)}" fill="${pick(COLORS)}" opacity="${rand(0.3, 0.8).toFixed(2)}"/>`,
    );
  }

  // 文字：逐字符随机旋转 / 基线偏移 / 字号 / 颜色
  const charWidth = width / (text.length + 1);
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const x = charWidth * (i + 0.7) + rand(-2, 2);
    const y = height / 2 + rand(4, 8);
    const rotate = rand(-28, 28).toFixed(1);
    const fontSize = rand(20, 26).toFixed(1);
    const color = pick(COLORS);
    parts.push(
      `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="Georgia, 'Times New Roman', serif" font-size="${fontSize}" font-style="${Math.random() > 0.5 ? "italic" : "normal"}" font-weight="bold" fill="${color}" transform="rotate(${rotate} ${x.toFixed(1)} ${y.toFixed(1)})" text-anchor="middle">${ch}</text>`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join("")}</svg>`;
}

/** 校验并消费验证码（一次性：无论对错均作废）。code 大小写不敏感。 */
export async function consumeCaptcha(id: string, code: string): Promise<boolean> {
  if (!id || !code) return false;
  const normalized = code.trim().toLowerCase();
  if (!normalized) return false;

  const redis = getRedis();
  let hash: string | null = null;

  if (redis) {
    try {
      hash = (await redis.getdel(keyOf(id))) ?? null;
    } catch {
      hash = null;
    }
  }
  if (hash === null) {
    const entry = memoryStore.get(id);
    memoryStore.delete(id);
    hash = entry && entry.expiresAt > Date.now() ? entry.hash : null;
  }

  if (!hash) return false;
  return sha256(normalized) === hash;
}
