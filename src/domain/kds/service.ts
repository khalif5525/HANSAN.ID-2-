/**
 * KdsService (Phase A3) — queue views and guarded kitchen actions.
 * All mutations validate through the KDS state machine before touching
 * the order aggregate; cancellation propagates implicitly (derived).
 */
import { AppError, ERROR_CODES } from "@/domain/shared/errors";
import type { OrderPort, OrderRecord } from "@/domain/shared/ports";
import { assertKdsAction, assertPrepTransition, kdsTargetState, type KdsAction, type PrepStatus } from "@/domain/kds/state-machine";
import {
  allItemsReady,
  buildTickets,
  isVisibleToKds,
  stationOf,
  type PriorityThresholds,
  type Station,
  type TicketView,
  DEFAULT_PRIORITY_THRESHOLDS,
} from "@/domain/kds/ticket";
import { transitionOrder, requireOrder, type LifecycleDeps } from "@/domain/pos/lifecycle";
import type { TenantScope } from "@/domain/shared/tenant-scope";

export type QueueView = "kitchen" | "bar" | "all" | "priority" | "completed";

export interface KdsServiceDeps extends LifecycleDeps {
  orders: OrderPort;
}

export class KdsService {
  private readonly lifecycle: LifecycleDeps;

  constructor(
    private readonly deps: KdsServiceDeps,
    private readonly thresholds: PriorityThresholds = DEFAULT_PRIORITY_THRESHOLDS,
  ) {
    this.lifecycle = { orders: deps.orders, audit: deps.audit, clock: deps.clock };
  }

  /** Queue for a view — derived from real orders; empty is valid (§4). */
  async listQueue(outletId: string, view: QueueView): Promise<TicketView[]> {
    const now = this.deps.clock();
    const orders = await this.deps.orders.listByOutlet(outletId, { limit: 200 });
    let tickets = orders
      .filter(isVisibleToKds)
      .flatMap((o) => buildTickets(o, now, this.thresholds));

    switch (view) {
      case "kitchen":
        tickets = tickets.filter((t) => t.station === "kitchen");
        break;
      case "bar":
        tickets = tickets.filter((t) => t.station === "bar");
        break;
      case "priority":
        tickets = tickets.filter((t) => t.priority !== "normal");
        tickets.sort((a, b) => rank(b.priority) - rank(a.priority) || b.elapsedMinutes - a.elapsedMinutes);
        break;
      case "completed":
        tickets = orders
          .filter((o) => o.state === "completed")
          .flatMap((o) => buildTickets({ ...o, state: "preparing" }, now, this.thresholds))
          .map((t) => ({ ...t, orderState: "completed" as const }));
        break;
      case "all":
      default:
        break;
    }
    tickets.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    return tickets;
  }

  /** Perform a kitchen action (accept/start_prep/mark_ready/complete). */
  async performAction(orderId: string, scope: TenantScope, action: KdsAction, actorId: string): Promise<OrderRecord> {
    const order = await requireOrder(this.deps.orders, orderId, scope);
    if (!isVisibleToKds(order) && action !== "complete") {
      throw new AppError(ERROR_CODES.INVALID_TICKET_TRANSITION, {
        message: `Order is not active in KDS (state: ${order.state})`,
      });
    }
    assertKdsAction(order.state, action);

    if (action === "mark_ready" || action === "complete") {
      const stations = activeStations(order);
      for (const station of stations) {
        if (!allItemsReady(order, station)) {
          throw new AppError(ERROR_CODES.INVALID_TICKET_TRANSITION, {
            message: `All ${station} items must be ready before advancing the ticket`,
          });
        }
      }
    }

    return transitionOrder(this.lifecycle, orderId, scope, kdsTargetState(action), actorId);
  }

  /** Item-level prep status update (pending → preparing → ready). */
  async setItemStatus(orderId: string, scope: TenantScope, lineId: string, to: PrepStatus, actorId: string): Promise<OrderRecord> {
    void actorId;
    const order = await requireOrder(this.deps.orders, orderId, scope);
    if (!isVisibleToKds(order)) {
      throw new AppError(ERROR_CODES.INVALID_TICKET_TRANSITION, { message: "Order is not active in KDS" });
    }
    const index = order.lines.findIndex((l) => l.id === lineId && l.state === "active");
    if (index < 0) throw new AppError(ERROR_CODES.NOT_FOUND, { message: "Order line not found" });

    const from: PrepStatus = order.lines[index].prepStatus ?? "pending";
    assertPrepTransition(from, to);

    const lines = [...order.lines];
    lines[index] = { ...lines[index], prepStatus: to };
    const updated: OrderRecord = { ...order, lines, updatedAt: this.deps.clock().toISOString() };
    await this.deps.orders.save(updated);
    return updated;
  }

  /** True when the ticket belongs to the given station's queue. */
  belongsToStation(order: OrderRecord, station: Station): boolean {
    return stationOf(order, station);
  }
}

function rank(p: "normal" | "high" | "overdue"): number {
  return p === "overdue" ? 2 : p === "high" ? 1 : 0;
}

function activeStations(order: OrderRecord): Station[] {
  const set = new Set<Station>();
  for (const l of order.lines) if (l.state === "active") set.add(l.station);
  return Array.from(set);
}
