/**
 * Application error taxonomy — every domain/service/API error maps to a
 * stable machine code + HTTP status. Never leak internals to clients.
 * (Phase A1 foundation; extended per domain as needed.)
 */

export const ERROR_CODES = {
  // generic
  VALIDATION_FAILED: "VALIDATION_FAILED",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  PERSISTENCE_NOT_CONFIGURED: "PERSISTENCE_NOT_CONFIGURED",
  AUTH_NOT_CONFIGURED: "AUTH_NOT_CONFIGURED",
  INTERNAL: "INTERNAL",
  RATE_LIMITED: "RATE_LIMITED",
  // POS
  INVALID_ORDER_STATE: "INVALID_ORDER_STATE",
  INVALID_ORDER_TYPE: "INVALID_ORDER_TYPE",
  CART_EMPTY: "CART_EMPTY",
  INVALID_QUANTITY: "INVALID_QUANTITY",
  CANCELLATION_NOT_ALLOWED: "CANCELLATION_NOT_ALLOWED",
  REFUND_NOT_ELIGIBLE: "REFUND_NOT_ELIGIBLE",
  PAYMENT_STATE_INVALID: "PAYMENT_STATE_INVALID",
  // KDS
  INVALID_TICKET_TRANSITION: "INVALID_TICKET_TRANSITION",
  UNKNOWN_STATION: "UNKNOWN_STATION",
  // inventory
  NEGATIVE_STOCK_FORBIDDEN: "NEGATIVE_STOCK_FORBIDDEN",
  INVALID_UNIT: "INVALID_UNIT",
  UNIT_CONVERSION_IMPOSSIBLE: "UNIT_CONVERSION_IMPOSSIBLE",
  INSUFFICIENT_STOCK: "INSUFFICIENT_STOCK",
  RECIPE_INVALID: "RECIPE_INVALID",
  // finance
  REFUND_APPROVAL_REQUIRED: "REFUND_APPROVAL_REQUIRED",
  REFUND_NOT_CASH: "REFUND_NOT_CASH",
  REFUND_SELF_APPROVAL_FORBIDDEN: "REFUND_SELF_APPROVAL_FORBIDDEN",
  REFUND_ALREADY_DECIDED: "REFUND_ALREADY_DECIDED",
  // workforce
  SHIFT_TRANSITION_INVALID: "SHIFT_TRANSITION_INVALID",
  ATTENDANCE_TRANSITION_INVALID: "ATTENDANCE_TRANSITION_INVALID",
  // reservation / loyalty
  RESERVATION_TRANSITION_INVALID: "RESERVATION_TRANSITION_INVALID",
  TABLE_CAPACITY_EXCEEDED: "TABLE_CAPACITY_EXCEEDED",
  SLOT_UNAVAILABLE: "SLOT_UNAVAILABLE",
  VOUCHER_INVALID: "VOUCHER_INVALID",
  // authz
  TENANT_MISMATCH: "TENANT_MISMATCH",
  OUTLET_MISMATCH: "OUTLET_MISMATCH",
  ROLE_NOT_PERMITTED: "ROLE_NOT_PERMITTED",
  MEMBERSHIP_AMBIGUOUS: "MEMBERSHIP_AMBIGUOUS",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  PERSISTENCE_NOT_CONFIGURED: 503,
  AUTH_NOT_CONFIGURED: 503,
  INTERNAL: 500,
  RATE_LIMITED: 429,
  INVALID_ORDER_STATE: 409,
  INVALID_ORDER_TYPE: 400,
  CART_EMPTY: 400,
  INVALID_QUANTITY: 400,
  CANCELLATION_NOT_ALLOWED: 409,
  REFUND_NOT_ELIGIBLE: 409,
  PAYMENT_STATE_INVALID: 409,
  INVALID_TICKET_TRANSITION: 409,
  UNKNOWN_STATION: 400,
  NEGATIVE_STOCK_FORBIDDEN: 409,
  INVALID_UNIT: 400,
  UNIT_CONVERSION_IMPOSSIBLE: 400,
  INSUFFICIENT_STOCK: 409,
  RECIPE_INVALID: 400,
  REFUND_APPROVAL_REQUIRED: 403,
  REFUND_NOT_CASH: 400,
  REFUND_SELF_APPROVAL_FORBIDDEN: 403,
  REFUND_ALREADY_DECIDED: 409,
  SHIFT_TRANSITION_INVALID: 409,
  ATTENDANCE_TRANSITION_INVALID: 409,
  RESERVATION_TRANSITION_INVALID: 409,
  TABLE_CAPACITY_EXCEEDED: 400,
  SLOT_UNAVAILABLE: 409,
  VOUCHER_INVALID: 400,
  TENANT_MISMATCH: 403,
  OUTLET_MISMATCH: 403,
  ROLE_NOT_PERMITTED: 403,
  MEMBERSHIP_AMBIGUOUS: 403,
};

export interface AppErrorOptions {
  /** Safe, human-readable message. Never include secrets/SQL. */
  message?: string;
  /** Field-level issues for validation failures. */
  details?: { path: string; message: string }[];
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: { path: string; message: string }[];

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    super(options.message ?? code, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code] ?? 500;
    this.details = options.details;
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/** Convert unknown thrown values into safe AppErrors (no internal leakage). */
export function toAppError(e: unknown): AppError {
  if (isAppError(e)) return e;
  // Persistence adapters throw plain errors mentioning configuration — map honestly.
  if (e instanceof Error && /not configured/i.test(e.message)) {
    return new AppError(ERROR_CODES.PERSISTENCE_NOT_CONFIGURED, { cause: e });
  }
  return new AppError(ERROR_CODES.INTERNAL, { cause: e });
}
