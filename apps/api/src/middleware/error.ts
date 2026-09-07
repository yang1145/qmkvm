import type { ErrorHandler } from "hono";
import { ZodError } from "zod";
import { AppError } from "@qmkvm/core";

export const errorHandler: ErrorHandler = (err, c) => {
  const requestId = c.get("requestId") ?? "req_unknown";
  if (err instanceof AppError) {
    return c.json(
      {
        code: err.code,
        message: err.message,
        requestId,
        ...(err.details ? { details: err.details } : {}),
      },
      err.status as 400,
    );
  }
  if (err instanceof ZodError) {
    return c.json(
      {
        code: "VALIDATION_FAILED",
        message: "请求参数不合法",
        requestId,
        details: {
          issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      },
      400,
    );
  }
  console.error(JSON.stringify({ level: "error", msg: "unhandled", requestId, error: String(err), stack: err.stack }));
  return c.json(
    { code: "INTERNAL", message: "服务内部错误，请稍后重试", requestId },
    500,
  );
};
