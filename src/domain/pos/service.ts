/**
 * PosService — application service facade (Phase A2).
 * Server-authoritative pricing, association validation, totals, and
 * delegation to lifecycle operations. Ports only — no framework/DB.
 */
import { AppError, ERROR_CODES } from "@/domain/shared/errors";
import { createId } from "@/domain/shared/ids";
import type { AuditLogPort } from "@/domain/audit/events";
import type { CatalogPort, OrderPort, OrderRecord, OrderState, PaymentPort, PayMethod, UserRecord } from "@/domain/shared/ports";
import type { TenantScope } from "@/domain/shared/tenant-scope";
import { assertCartNotEmpty, cartAdd, cartSubtotalIdr, EMPTY_CART, type Cart } from "@/domain/pos/cart";
import { computeTotals, type TaxConfig } from "@/domain/pos/totals";
import { validateOrderAssociations, type RefundPolicy } from "@/domain/pos/rules";
import {
  cancelOrder,
  capturePayment,
  requestRefund,
  transitionOrder,
  type LifecycleDeps,
  type PaymentLifecycleDeps,
} from "@/domain/pos/lifecycle";
import type { CreateOrderRequest, OrderHistoryItem, OrderHistoryQuery } from "@/domain/pos/contracts";
import { toHistoryItem } from "@/domain/pos/contracts";

export interface PosServiceDeps {
  orders: OrderPort;
  catalog: CatalogPort;
  audit: AuditLogPort;
  payments: PaymentPort;
  tax: TaxConfig;
  clock: () => Date;
}

export class PosService {
  private readonly lifecycle: LifecycleDeps;
  private readonly paymentLifecycle: PaymentLifecycleDeps;

  constructor(private readonly deps: PosServiceDeps) {
    this.lifecycle = { orders: deps.orders, audit: deps.audit, clock: deps.clock };
    this.paymentLifecycle = { ...this.lifecycle, payments: deps.payments };
  }

  /** Price a request from the server catalog — client prices are ignored. */
  async priceRequest(req: CreateOrderRequest, tenantId: string): Promise<Cart> {
    let cart: Cart = EMPTY_CART;
    for (const line of req.lines) {
      // Phase 12 — scoped catalog read: `tenantId` is the verified actor's tenant (never a request-body field); a cross-tenant product id resolves to null → NOT_FOUND.
      const product = await this.deps.catalog.findById(line.productId, { organizationId: tenantId });
      if (!product || !product.active || product.tenantId !== tenantId) {
        throw new AppError(ERROR_CODES.NOT_FOUND, { message: `Unknown product: ${line.productId}` });
      }
      const result = cartAdd(cart, {
        id: createId("item"),
        productId: product.id,
        productName: product.name,
        quantity: line.quantity,
        unitPriceIdr: product.priceIdr,
        station: product.station,
        modifierIds: line.modifierIds ?? [],
        note: line.note,
      });
      if (!result.ok) throw result.error;
      cart = result.value;
    }
    return cart;
  }

  async createOrder(params: {
    tenantId: string;
    outletId: string;
    actor: UserRecord;
    req: CreateOrderRequest;
  }): Promise<OrderRecord> {
    const { tenantId, outletId, actor, req } = params;
    const assoc = validateOrderAssociations(req.orderType, {
      tableId: req.tableId ?? null,
      customerId: req.customerId ?? null,
    });
    if (!assoc.ok) throw assoc.error;

    const cart = await this.priceRequest(req, tenantId);
    const notEmpty = assertCartNotEmpty(cart);
    if (!notEmpty.ok) throw notEmpty.error;

    const totals = computeTotals({
      subtotalIdr: cartSubtotalIdr(cart),
      discountIdr: req.discountIdr ?? 0,
      tax: this.deps.tax,
    });

    const now = this.deps.clock().toISOString();
    const order: OrderRecord = {
      id: createId("ord"),
      tenantId,
      outletId,
      orderNumber: await this.deps.orders.nextOrderNumber(outletId),
      orderType: req.orderType,
      tableId: req.tableId ?? null,
      customerId: req.customerId ?? null,
      lines: cart.lines,
      subtotalIdr: totals.subtotalIdr,
      discountIdr: totals.discountIdr,
      taxIdr: totals.taxIdr,
      grandTotalIdr: totals.grandTotalIdr,
      state: "placed",
      paymentState: "unpaid",
      createdBy: actor.id,
      createdAt: now,
      updatedAt: now,
    };
    await this.deps.orders.save(order);
    return order;
  }

  transition(orderId: string, scope: TenantScope, to: OrderState, actorId: string): Promise<OrderRecord> {
    return transitionOrder(this.lifecycle, orderId, scope, to, actorId);
  }

  pay(orderId: string, scope: TenantScope, actorId: string, method: PayMethod): Promise<OrderRecord> {
    return capturePayment(this.paymentLifecycle, orderId, scope, actorId, method);
  }

  cancel(orderId: string, scope: TenantScope, actorId: string): Promise<OrderRecord> {
    return cancelOrder(this.lifecycle, orderId, scope, actorId);
  }

  requestRefund(orderId: string, scope: TenantScope, actorId: string, policy?: RefundPolicy): Promise<OrderRecord> {
    return requestRefund(this.lifecycle, orderId, scope, actorId, policy);
  }

  async history(query: OrderHistoryQuery): Promise<OrderHistoryItem[]> {
    const orders = await this.deps.orders.listByOutlet(query.outletId, {
      limit: Math.min(Math.max(query.limit, 1), 200),
      ...(query.sinceIso ? { sinceIso: query.sinceIso } : {}),
    });
    return orders.map(toHistoryItem);
  }

  /** Read one order by its persisted id — `scope` is REQUIRED (Phase 12), comes from the verified actor, and a cross-tenant id resolves to null (non-leaking). */
  async getOrderById(orderId: string, scope: TenantScope): Promise<OrderRecord | null> {
    return this.deps.orders.findById(orderId, scope);
  }
}
