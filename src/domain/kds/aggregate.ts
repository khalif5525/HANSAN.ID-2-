/**
 * KDS aggregate progress (master autopilot §5) — DERIVED read model.
 * Aggregates per-station item prepStatus into one parent-order view.
 * Pure function: no I/O, no persistence. Empty orders are "new".
 *
 * Mapping onto the existing order state machine:
 * - item pending/preparing → station "in-progress"
 * - all station items ready → station "ready"
 * - order states cancelled/refunded map to the terminal aggregate.
 */
import type { OrderRecord } from "@/domain/shared/ports";
import type { Station } from "@/domain/kds/ticket";

export type StationProgress = "empty" | "new" | "in-progress" | "ready";

export type AggregateOrderProgress = "new" | "in-progress" | "partially-ready" | "ready" | "completed";

export interface StationProgressView {
  station: Station;
  progress: StationProgress;
  total: number;
  ready: number;
}

export interface AggregateProgressView {
  orderId: string;
  orderNumber: string;
  aggregate: AggregateOrderProgress;
  stations: StationProgressView[];
}

const TERMINAL: Readonly<Record<string, AggregateOrderProgress | null>> = {
  completed: "completed",
  cancelled: "completed",
  refunded: "completed",
  refund_requested: null,
};

function stationProgress(order: OrderRecord, station: Station): StationProgressView {
  const lines = order.lines.filter((l) => l.state === "active" && l.station === station);
  if (lines.length === 0) return { station, progress: "empty", total: 0, ready: 0 };
  const ready = lines.filter((l) => (l.prepStatus ?? "pending") === "ready").length;
  if (ready === lines.length) return { station, progress: "ready", total: lines.length, ready };
  const started = lines.some((l) => (l.prepStatus ?? "pending") !== "pending");
  return { station, progress: started ? "in-progress" : "new", total: lines.length, ready };
}

/**
 * Derive the aggregate parent-order view. Independent station progress:
 * one station ready never implies the whole order is ready.
 */
export function aggregateProgress(order: OrderRecord): AggregateProgressView {
  const terminal = TERMINAL[order.state];
  const stations: StationProgressView[] = [stationProgress(order, "kitchen"), stationProgress(order, "bar")];
  if (terminal) return { orderId: order.id, orderNumber: order.orderNumber, aggregate: terminal, stations };

  const active = stations.filter((s) => s.progress !== "empty");
  if (active.length === 0) return { orderId: order.id, orderNumber: order.orderNumber, aggregate: "new", stations };

  const readyCount = active.filter((s) => s.progress === "ready").length;
  if (readyCount === active.length) {
    return { orderId: order.id, orderNumber: order.orderNumber, aggregate: "ready", stations };
  }
  if (readyCount > 0) {
    return { orderId: order.id, orderNumber: order.orderNumber, aggregate: "partially-ready", stations };
  }
  const started = active.some((s) => s.progress === "in-progress");
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    aggregate: started ? "in-progress" : "new",
    stations,
  };
}
