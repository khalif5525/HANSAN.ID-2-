/**
 * Phase 8 memory-store tenant guards (unit). MemoryOrders/Catalog/Payments
 * back the DEMO sandbox; the same scope contract is enforced so tests prove
 * cross-tenant rejection at the store boundary too.
 */
import { describe, expect, it } from "vitest";
import { MemoryCatalog, MemoryOrders, MemoryPayments } from "@/server/db/memory-store";

function order(id: string, tenantId: string, outletId = "out_1") {
  return {
    id, tenantId, outletId, orderNumber: "ORD-1", orderType: "take-away" as const,
    tableId: null, customerId: null, lines: [], subtotalIdr: 0, discountIdr: 0,
    taxIdr: 0, grandTotalIdr: 0, state: "placed" as const, paymentState: "unpaid" as const,
    createdBy: "u", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("memory store tenant scope (Phase 8 R4)", () => {
  it("MemoryOrders.findById rejects cross-tenant and cross-outlet reads", async () => {
    const m = new MemoryOrders();
    await m.save(order("o1", "ten_a", "out_1"));
    expect(await m.findById("o1", { organizationId: "ten_a", outletId: "out_1" })).not.toBeNull();
    expect(await m.findById("o1", { organizationId: "ten_b" })).toBeNull();
    expect(await m.findById("o1", { organizationId: "ten_a", outletId: "out_2" })).toBeNull();
  });
  it("MemoryCatalog.findById rejects cross-tenant reads", async () => {
    const m = new MemoryCatalog();
    m.put({ id: "p1", tenantId: "ten_a", categoryId: "c", name: "N", priceIdr: 1, station: "kitchen", active: true, createdAt: "2026-01-01T00:00:00.000Z" });
    expect(await m.findById("p1", { organizationId: "ten_a" })).not.toBeNull();
    expect(await m.findById("p1", { organizationId: "ten_b" })).toBeNull();
  });
  it("MemoryPayments.listByOrder rejects cross-tenant order ids", async () => {
    const m = new MemoryPayments();
    await m.save({ id: "pay_1", tenantId: "ten_a", outletId: "out_1", orderId: "ord_1", amountIdr: 1, method: "cash", capturedBy: "u", capturedAt: "2026-01-01T00:00:00.000Z", externalRef: null });
    expect(await m.listByOrder("ord_1", { organizationId: "ten_a" })).toHaveLength(1);
    expect(await m.listByOrder("ord_1", { organizationId: "ten_b" })).toEqual([]);
  });
});
