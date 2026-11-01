import { describe, expect, it } from "vitest";
import { aggregateProgress } from "@/domain/kds/aggregate";
import type { OrderRecord } from "@/domain/shared/ports";

function order(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: "ord_1",
    tenantId: "ten_test",
    outletId: "out_1",
    orderNumber: "HS-1042",
    orderType: "dine-in",
    tableId: null,
    customerId: null,
    lines: [
      { id: "l1", productId: "p1", productName: "Nasi Goreng", quantity: 1, unitPriceIdr: 20_000, modifierIds: [], station: "kitchen", state: "active", prepStatus: "pending" },
      { id: "l2", productId: "p2", productName: "Iced Latte", quantity: 1, unitPriceIdr: 10_000, modifierIds: [], station: "bar", state: "active", prepStatus: "pending" },
    ],
    subtotalIdr: 30_000,
    discountIdr: 0,
    taxIdr: 0,
    grandTotalIdr: 30_000,
    state: "placed",
    paymentState: "unpaid",
    createdBy: "usr_pos",
    createdAt: "2026-01-01T10:00:00.000Z",
    updatedAt: "2026-01-01T10:00:00.000Z",
    ...overrides,
  };
}

describe("kds aggregate progress (independent stations)", () => {
  it("starts new when nothing has started", () => {
    const view = aggregateProgress(order());
    expect(view.aggregate).toBe("new");
    expect(view.stations.find((s) => s.station === "kitchen")?.progress).toBe("new");
    expect(view.stations.find((s) => s.station === "bar")?.progress).toBe("new");
  });

  it("one station ready => partially-ready (never full ready)", () => {
    const view = aggregateProgress(
      order({
        lines: [
          { id: "l1", productId: "p1", productName: "Nasi Goreng", quantity: 1, unitPriceIdr: 20_000, modifierIds: [], station: "kitchen", state: "active", prepStatus: "ready" },
          { id: "l2", productId: "p2", productName: "Iced Latte", quantity: 1, unitPriceIdr: 10_000, modifierIds: [], station: "bar", state: "active", prepStatus: "pending" },
        ],
      }),
    );
    expect(view.aggregate).toBe("partially-ready");
  });

  it("all stations ready => ready", () => {
    const view = aggregateProgress(
      order({
        lines: [
          { id: "l1", productId: "p1", productName: "Nasi Goreng", quantity: 1, unitPriceIdr: 20_000, modifierIds: [], station: "kitchen", state: "active", prepStatus: "ready" },
          { id: "l2", productId: "p2", productName: "Iced Latte", quantity: 1, unitPriceIdr: 10_000, modifierIds: [], station: "bar", state: "active", prepStatus: "ready" },
        ],
      }),
    );
    expect(view.aggregate).toBe("ready");
  });

  it("preparation started but nothing ready => in-progress", () => {
    const view = aggregateProgress(
      order({
        lines: [
          { id: "l1", productId: "p1", productName: "Nasi Goreng", quantity: 1, unitPriceIdr: 20_000, modifierIds: [], station: "kitchen", state: "active", prepStatus: "preparing" },
          { id: "l2", productId: "p2", productName: "Iced Latte", quantity: 1, unitPriceIdr: 10_000, modifierIds: [], station: "bar", state: "active", prepStatus: "pending" },
        ],
      }),
    );
    expect(view.aggregate).toBe("in-progress");
  });

  it("single-station order derives from that station only", () => {
    const view = aggregateProgress(
      order({
        lines: [
          { id: "l1", productId: "p1", productName: "Nasi Goreng", quantity: 1, unitPriceIdr: 20_000, modifierIds: [], station: "kitchen", state: "active", prepStatus: "ready" },
        ],
      }),
    );
    expect(view.aggregate).toBe("ready");
    expect(view.stations.find((s) => s.station === "bar")?.progress).toBe("empty");
  });

  it("terminal order states map to completed aggregate", () => {
    expect(aggregateProgress(order({ state: "completed" })).aggregate).toBe("completed");
    expect(aggregateProgress(order({ state: "cancelled" })).aggregate).toBe("completed");
  });
});
