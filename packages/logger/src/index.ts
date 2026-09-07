/** 结构化日志：JSON 输出，敏感字段强制脱敏。 */

import pino from "pino";

const redactPaths = [
  "password",
  "*.password",
  "passwordHash",
  "*.passwordHash",
  "code",
  "*.code",
  "token",
  "*.token",
  "authorization",
  "*.authorization",
  "phone",
  "*.phone",
  "email",
  "*.email",
];

export type Logger = pino.Logger;

export function createLogger(name: string, level = process.env.LOG_LEVEL ?? "info"): Logger {
  return pino({
    name,
    level,
    redact: { paths: redactPaths, censor: "[REDACTED]" },
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export const logger = createLogger("qmkvm");
