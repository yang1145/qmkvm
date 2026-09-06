import { ERR, type ErrorCode } from "@pinhaoji/contracts";

/** 业务错误：API 层统一捕获转 HTTP 响应。 */
const STATUS_MAP: Partial<Record<ErrorCode, number>> = {
  VALIDATION_FAILED: 400,
  AUTH_WEAK_PASSWORD: 400,
  TICKET_ATTACHMENT_INVALID: 400,
  AUTH_REQUIRED: 401,
  AUTH_SESSION_EXPIRED: 401,
  AUTH_INVALID_CREDENTIALS: 401,
  AUTH_SMS_CODE_INVALID: 401,
  AUTH_RESET_TOKEN_INVALID: 401,
  PAY_SIGNATURE_INVALID: 401,
  PERM_DENIED: 403,
  AUTH_DISABLED: 403,
  CATALOG_IDENTITY_REQUIRED: 403,
  NOT_FOUND: 404,
  ORDER_NOT_FOUND: 404,
  CATALOG_NOT_FOUND: 404,
  PAY_INTENT_NOT_FOUND: 404,
  PAY_GATEWAY_UNAVAILABLE: 404,
  BILL_INVOICE_NOT_FOUND: 404,
  SVC_NOT_FOUND: 404,
  SVC_MODULE_NOT_FOUND: 404,
  TICKET_NOT_FOUND: 404,
  CONFLICT: 409,
  AUTH_PHONE_EXISTS: 409,
  AUTH_EMAIL_EXISTS: 409,
  ORDER_STATUS_INVALID: 409,
  BILL_INVOICE_STATUS_INVALID: 409,
  SVC_STATUS_INVALID: 409,
  TICKET_CLOSED: 409,
  RATE_LIMITED: 429,
  AUTH_SMS_SEND_LIMIT: 429,
  MAINTENANCE: 503,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message?: string, details?: Record<string, unknown>) {
    super(message ?? code);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_MAP[code] ?? 500;
    this.details = details;
  }
}

export function appError(
  code: ErrorCode,
  message?: string,
  details?: Record<string, unknown>,
): AppError {
  return new AppError(code, message, details);
}

export { ERR };
