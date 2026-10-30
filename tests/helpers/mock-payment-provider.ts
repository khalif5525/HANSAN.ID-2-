/**
 * TEST-ONLY mock payment provider implementing PaymentProviderAdapter.
 *
 * This helper is never imported by production code. It performs real
 * signature checks and deduplication so tests exercise failure paths; it does
 * NOT auto-approve callbacks.
 */
import type { PaymentProviderAdapter } from "@/domain/payments/adapter";
import type { PaymentStatus } from "@/domain/payments/state-machine";

type CallbackMetadata = Record<string, string | number | boolean> | undefined;

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return (
    "{" +
    keys
      .map((key) => JSON.stringify(key) + ":" + canonicalize(record[key]))
      .join(",") +
    "}"
  );
}

function canonicalPayload(params: {
  providerIntentId: string;
  providerEventId: string;
  status: PaymentStatus;
  occurredAt: string;
  metadata?: CallbackMetadata;
}): string {
  return canonicalize({
    providerIntentId: params.providerIntentId,
    providerEventId: params.providerEventId,
    status: params.status,
    occurredAt: params.occurredAt,
    metadata: params.metadata ?? {},
  });
}


export interface MockPaymentProviderOptions {
  secret?: string;
  createStatus?: PaymentStatus;
  failCreate?: boolean;
  rejectCallback?: boolean;
}

export class MockPaymentProvider implements PaymentProviderAdapter {
  private readonly secret: string;
  private readonly createStatus: PaymentStatus;
  private readonly failCreate: boolean;
  private readonly rejectCallback: boolean;
  private readonly seenEvents = new Set<string>();
  private readonly intents = new Map<string, { amountIdr: number }>();
  readonly intentRequests: Array<{ amountIdr: number; idempotencyKey: string; orderId?: string; metadata?: Record<string, string | number | boolean> }> = [];

  constructor(options: MockPaymentProviderOptions = {}) {
    this.secret = options.secret ?? "mock-secret";
    this.createStatus = options.createStatus ?? "PENDING";
    this.failCreate = options.failCreate ?? false;
    this.rejectCallback = options.rejectCallback ?? false;
  }

  providerName(): string {
    return "mock-payment-provider";
  }

  async createIntent(request: {
    idempotencyKey: string;
    amountIdr: number;
    description: string;
    orderId?: string;
    customerReference?: string;
    metadata?: Record<string, string | number | boolean>;
  }): Promise<{
    providerIntentId: string;
    status: PaymentStatus;
    clientAction?: { type: "qr" | "redirect" | "display" | "none"; payload: string; expiresAt?: string };
    providerErrorCode?: string | null;
    providerErrorMessage?: string | null;
  }> {
    if (this.failCreate) {
      this.intentRequests.push({
        amountIdr: request.amountIdr,
        idempotencyKey: request.idempotencyKey,
        orderId: request.orderId,
        metadata: request.metadata,
      });
      return {
        providerIntentId: `mock_failed_${request.idempotencyKey}`,
        status: "FAILED",
        providerErrorCode: "MOCK_PROVIDER_FAILURE",
        providerErrorMessage: "mock provider configured to fail intent creation",
      };
    }
    this.intentRequests.push({
      amountIdr: request.amountIdr,
      idempotencyKey: request.idempotencyKey,
      orderId: request.orderId,
      metadata: request.metadata,
    });
    const providerIntentId = `mock_intent_${request.idempotencyKey}`;
    this.intents.set(providerIntentId, { amountIdr: request.amountIdr });
    return {
      providerIntentId,
      status: this.createStatus,
      clientAction: { type: "none", payload: "" },
    };
  }

  async verifyCallback(request: {
    providerIntentId: string;
    providerEventId: string;
    status: PaymentStatus;
    signature: string;
    occurredAt: string;
    metadata?: Record<string, string | number | boolean>;
  }): Promise<{
    accepted: boolean;
    status: PaymentStatus;
    duplicate: boolean;
    reason?: string;
  }> {
    const expectedSignature =
      `sig:${this.secret}:` +
      canonicalPayload({
        providerIntentId: request.providerIntentId,
        providerEventId: request.providerEventId,
        status: request.status,
        occurredAt: request.occurredAt,
        metadata: request.metadata,
      });
    if (request.signature !== expectedSignature) {
      return { accepted: false, status: request.status, duplicate: false, reason: "invalid_signature" };
    }
    if (this.rejectCallback) {
      return { accepted: false, status: request.status, duplicate: false, reason: "rejected_by_provider" };
    }
    const intent = this.intents.get(request.providerIntentId);
    const callbackAmount = request.metadata?.amountIdr;
    if (callbackAmount !== undefined && intent && Number(callbackAmount) !== intent.amountIdr) {
      return { accepted: false, status: request.status, duplicate: false, reason: "amount_mismatch" };
    }
    if (this.seenEvents.has(request.providerEventId)) {
      return { accepted: true, status: request.status, duplicate: true };
    }
    // Synchronous check+add keeps concurrent duplicate detection deterministic.
    this.seenEvents.add(request.providerEventId);
    return { accepted: true, status: request.status, duplicate: false };
  }

  async createRefund(request: {
    providerIntentId: string;
    amountIdr: number;
    idempotencyKey: string;
    reason: string;
  }): Promise<{ providerRefundId: string; status: PaymentStatus; duplicate: boolean }> {
    return {
      providerRefundId: `mock_refund_${request.idempotencyKey}`,
      status: "REFUNDED",
      duplicate: false,
    };
  }

  async queryStatus(_providerIntentId: string): Promise<PaymentStatus> {
    return "PENDING";
  }

  /**
   * Test helper: expected signature for a callback request.
   *
   * Flexible argument shapes:
   * - signatureFor(providerIntentId, providerEventId, status)
   * - signatureFor(providerIntentId, providerEventId, status, metadata)
   * - signatureFor(providerIntentId, providerEventId, status, occurredAt, metadata)
   */
  signatureFor(
    providerIntentId: string,
    providerEventId: string,
    status: PaymentStatus,
    occurredAtOrMetadata?: string | CallbackMetadata,
    metadata?: CallbackMetadata,
  ): string {
    let occurredAt = "2026-01-01T00:00:00.000Z";
    let resolvedMetadata: CallbackMetadata;
    if (typeof occurredAtOrMetadata === "string") {
      occurredAt = occurredAtOrMetadata;
      resolvedMetadata = metadata;
    } else if (occurredAtOrMetadata && typeof occurredAtOrMetadata === "object") {
      resolvedMetadata = occurredAtOrMetadata;
    } else {
      resolvedMetadata = metadata;
    }
    return (
      `sig:${this.secret}:` +
      canonicalPayload({
        providerIntentId,
        providerEventId,
        status,
        occurredAt,
        metadata: resolvedMetadata,
      })
    );
  }
}