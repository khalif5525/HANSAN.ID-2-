/**
 * Canonical POS order-create response envelope (Phase A).
 *
 * A LEAF module on purpose: it imports only the OrderRecord TYPE, so both the
 * API route AND the transactional Prisma adapter can build the exact same JSON
 * without creating an import cycle (adapter -> compose -> runtime -> adapter).
 *
 * The route returns this verbatim on a fresh create, and the adapter stores the
 * identical serialization as the Idempotency-Key replay payload — so a retry
 * returns byte-for-byte the same body the first caller received.
 */
import type { OrderRecord } from "@/domain/shared/ports";

export interface OrderCreateResponse {
  id: string;
  orderNumber: string;
  outletId: string;
  orderType: OrderRecord["orderType"];
  state: OrderRecord["state"];
  paymentState: OrderRecord["paymentState"];
  subtotalIdr: number;
  discountIdr: number;
  taxIdr: number;
  grandTotalIdr: number;
  lines: {
    id: string;
    productId: string;
    productName: string;
    quantity: number;
    unitPriceIdr: number;
    station: OrderRecord["lines"][number]["station"];
    state: OrderRecord["lines"][number]["state"];
    prepStatus: NonNullable<OrderRecord["lines"][number]["prepStatus"]>;
  }[];
  lineCount: number;
  createdAt: string;
}

export function orderCreateResponse(order: OrderRecord): OrderCreateResponse {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    outletId: order.outletId,
    orderType: order.orderType,
    state: order.state,
    paymentState: order.paymentState,
    subtotalIdr: order.subtotalIdr,
    discountIdr: order.discountIdr,
    taxIdr: order.taxIdr,
    grandTotalIdr: order.grandTotalIdr,
    lines: order.lines.map((l) => ({
      id: l.id,
      productId: l.productId,
      productName: l.productName,
      quantity: l.quantity,
      unitPriceIdr: l.unitPriceIdr,
      station: l.station,
      state: l.state,
      prepStatus: l.prepStatus ?? "pending",
    })),
    lineCount: order.lines.length,
    createdAt: order.createdAt,
  };
}
