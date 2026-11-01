/**
 * Payment provider adapter interface (Phase E1).
 *
 * Provider-agnostic: any payment gateway (QRIS, e-wallet, card, EDC)
 * implements this interface. The domain never depends on a specific
 * provider SDK — it depends on this port.
 *
 * Implementations MUST:
 *   * Be idempotent: same idempotency key → same result
 *   * Never leak raw credentials in logs or responses
 *   * Return deterministic results for the same input
 *   * Handle network timeouts gracefully (return FAILED, never hang)
 */
import type { PaymentStatus } from "./state-machine";

export interface PaymentIntentRequest {
  /** Merchant-generated idempotency key for this payment attempt. */
  idempotencyKey: string;
  /** Amount in whole rupiah (integer minor unit). */
  amountIdr: number;
  /** Human-readable description for the payment receipt. */
  description: string;
  /** Optional reference to the HANSAN order this payment settles. */
  orderId?: string;
  /** Optional customer-facing reference (order number, etc.). */
  customerReference?: string;
  /** Metadata for reconciliation (scalars only — no secrets/PII). */
  metadata?: Record<string, string | number | boolean>;
}

export interface PaymentIntentResult {
  /** Provider-assigned payment intent ID (for webhook correlation). */
  providerIntentId: string;
  /** Current payment status after attempting creation. */
  status: PaymentStatus;
  /** Client-facing action required (e.g. QR code URL, redirect URL). Null if none. */
  clientAction?: {
    type: "qr" | "redirect" | "display" | "none";
    payload: string; // QR data, URL, or display text
    expiresAt?: string; // ISO 8601
  };
  /** Provider-specific error code (only when status is FAILED). */
  providerErrorCode?: string | null;
  /** Human-safe error message (only when status is FAILED). */
  providerErrorMessage?: string | null;
}

export interface PaymentCallbackRequest {
  /** Provider-assigned payment intent ID. */
  providerIntentId: string;
  /** Provider-assigned event/webhook ID (for idempotency/dedup). */
  providerEventId: string;
  /** Provider-declared status. */
  status: PaymentStatus;
  /** Provider signature for authenticity verification. */
  signature: string;
  /** Timestamp of the provider event (ISO 8601). */
  occurredAt: string;
  /** Optional raw payload for audit (scalars only — no secrets). */
  metadata?: Record<string, string | number | boolean>;
}

export interface PaymentCallbackResult {
  /** Whether the callback was accepted and processed. */
  accepted: boolean;
  /** Resolved payment status after processing the callback. */
  status: PaymentStatus;
  /** Whether this was a duplicate (already processed) callback. */
  duplicate: boolean;
  /** Reason if not accepted. */
  reason?: string;
}

export interface PaymentRefundRequest {
  /** Original payment intent ID being refunded. */
  providerIntentId: string;
  /** Refund amount in whole rupiah (≤ original amount). */
  amountIdr: number;
  /** Idempotency key for this refund. */
  idempotencyKey: string;
  /** Reason for the refund (scalars only). */
  reason: string;
}

export interface PaymentRefundResult {
  /** Provider-assigned refund ID. */
  providerRefundId: string;
  /** Refund status after submission. */
  status: PaymentStatus;
  /** Whether the refund was already processed (idempotent replay). */
  duplicate: boolean;
}

/**
 * Port that every payment provider adapter must implement.
 */
export interface PaymentProviderAdapter {
  /** Create a payment intent with the provider. */
  createIntent(request: PaymentIntentRequest): Promise<PaymentIntentResult>;
  /** Verify and process a provider webhook callback. */
  verifyCallback(request: PaymentCallbackRequest): Promise<PaymentCallbackResult>;
  /** Submit a refund to the provider. */
  createRefund(request: PaymentRefundRequest): Promise<PaymentRefundResult>;
  /** Query the current payment status from the provider (for reconciliation). */
  queryStatus(providerIntentId: string): Promise<PaymentStatus>;
  /** Provider name for logging and audit (no secrets). */
  providerName(): string;
}