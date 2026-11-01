/**
 * Payment state machine (Phase E1) — deterministic payment lifecycle.
 *
 * States:
 *   PENDING   → payment initiated, awaiting provider confirmation
 *   PAID      → funds captured successfully
 *   FAILED    → payment attempt failed (retryable with new attempt)
 *   EXPIRED   → payment window closed without resolution
 *   CANCELLED → payment cancelled by merchant/customer before capture
 *   REFUNDED  → funds returned (partial or full)
 *
 * All transitions are validated — unknown transitions are rejected, never
 * silently applied. This is the single source of truth for payment status.
 */
import { AppError, ERROR_CODES } from "@/domain/shared/errors";

export type PaymentStatus = "PENDING" | "PAID" | "FAILED" | "EXPIRED" | "CANCELLED" | "REFUNDED";

export const PAYMENT_TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  PENDING: ["PAID", "FAILED", "EXPIRED", "CANCELLED"],
  PAID: ["REFUNDED"], // refunds create new payment records; PAID is terminal for captures
  FAILED: [], // terminal — a new payment attempt must be created as a new record
  EXPIRED: [], // terminal — a new payment attempt must be created as a new record
  CANCELLED: [], // terminal
  REFUNDED: [], // terminal
} as const;

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_TRANSITIONS[from].includes(to);
}

export function assertPaymentTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (!canTransitionPayment(from, to)) {
    throw new AppError(ERROR_CODES.PAYMENT_STATE_INVALID, {
      message: `Payment cannot move from ${from} to ${to}`,
    });
  }
}

/**
 * Terminal states — no further business transitions possible.
 * A payment in a terminal state requires a NEW payment record for any
 * further action (retry, refund, etc.).
 */
export const TERMINAL_PAYMENT_STATES: readonly PaymentStatus[] = [
  "FAILED",
  "EXPIRED",
  "CANCELLED",
  "REFUNDED",
];

/**
 * Whether a payment status represents successful fund capture.
 */
export function isPaymentSuccessful(status: PaymentStatus): boolean {
  return status === "PAID";
}

/**
 * Whether a payment status is final (no further transitions possible).
 */
export function isPaymentTerminal(status: PaymentStatus): boolean {
  return TERMINAL_PAYMENT_STATES.includes(status);
}