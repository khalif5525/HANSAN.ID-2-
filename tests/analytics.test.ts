import { describe, expect, it } from "vitest";
import { buildPeriod, bucketLabels, fallsWithin } from "@/domain/analytics/periods";
import { salesSeries, salesSummary, productPerformance, customerAnalytics, inventoryAnalytics, operationalAnalytics } from "@/domain/analytics/aggregations";
import type { OrderRecord } from "@/domain/shared/ports";

const DAILY = buildPeriod("daily", new Date("2026-01-01T00:00:00Z"));

function order(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: "o1", tenantId: "t1", outletId: "o1", orderNumber: "ORD-0001",
    orderType: "dine-in", tableId: null, customerId: "c1",
    lines: [],
    subtotalIdr: 100_000, discountIdr: 0, taxIdr: 0, grandTotalIdr: 100_000,
    state: "completed", paymentState: "paid", createdBy: "u1",
    createdAt: "2026-01-01T10:00:00.000Z", updatedAt: "2026-01-01T10:00:00.000Z",
    ...overrides,
  };
}

describe("periods", () => {
  it("builds a daily period with the right bounds", () => {
    const p = buildPeriod("daily", new Date("2026-01-01T12:00:00Z"));
    expect(p.kind).toBe("daily");
    expect(p.startMs).toBe(Date.UTC(2026, 0, 1));
    expect(p.endMs).toBe(Date.UTC(2026, 0, 2));
    expect(p.label).toBe("2026-01-01");
  });

  it("daily buckets cover a month", () => {
    const p = buildPeriod("monthly", new Date("2026-01-15T00:00:00Z"));
    expect(p.label).toBe("2026-01");
    expect(p.startMs).toBe(Date.UTC(2026, 0, 1));
    expect(p.endMs).toBe(Date.UTC(2026, 1, 1));
    expect(bucketLabels(p, "day")).toHaveLength(31);
  });

  it("fallsWithin is half-open [start, end)", () => {
    const p = buildPeriod("daily", new Date("2026-01-01T00:00:00Z"));
    expect(fallsWithin(p, "2026-01-01T00:00:00.000Z")).toBe(true);
    expect(fallsWithin(p, "2026-01-01T23:59:59.999Z")).toBe(true);
    expect(fallsWithin(p, "2026-01-02T00:00:00.000Z")).toBe(false);
  });
});

describe("sales aggregation — empty input ⇒ zeros (never fabricated)", () => {
  it("salesSummary", () => {
    expect(salesSummary([])).toEqual({ orderCount: 0, grossIdr: 0, taxIdr: 0, discountIdr: 0, netIdr: 0, averageOrderIdr: 0 });
  });

  it("salesSeries zero-fills every bucket (length === bucketLabels length)", () => {
    const series = salesSeries([], DAILY);
    expect(series).toHaveLength(bucketLabels(DAILY, "hour").length);
    const buckets = bucketLabels(DAILY, "hour");
    const filled = salesSeries([order({ createdAt: "2026-01-01T00:30:00.000Z" })], DAILY);
    expect(filled).toHaveLength(buckets.length);
    const p0 = filled.find((x) => x.bucket === "2026-01-01T00:00");
    expect(p0).toEqual({ bucket: "2026-01-01T00:00", orderCount: 1, netIdr: 100_000 });
    const p1 = filled.find((x) => x.bucket === "2026-01-01T01:00");
    expect(p1).toEqual({ bucket: "2026-01-01T01:00", orderCount: 0, netIdr: 0 });
  });
});

describe("products / customers / inventory / operational", () => {
  it("productPerformance sorts by revenue", () => {
    const o = order({
      lines: [
        { id: "l1", productId: "a", productName: "A", quantity: 2, unitPriceIdr: 1000, modifierIds: [], station: "kitchen", state: "active" },
        { id: "l2", productId: "b", productName: "B", quantity: 1, unitPriceIdr: 1000, modifierIds: [], station: "bar", state: "active" },
      ],
    });
    expect(productPerformance([o])).toEqual([
      { productId: "a", productName: "A", units: 2, revenueIdr: 2000 },
      { productId: "b", productName: "B", units: 1, revenueIdr: 1000 },
    ]);
  });

  it("customerAnalytics: activeInPeriod = distinct buyers", () => {
    const customers = [{ id: "c1", tenantId: "t1", name: "A", email: null, phone: null, loyaltyPoints: 10, membershipTier: "none" as const, createdAt: "2026-01-01T00:00:00.000Z" }, { id: "c2", tenantId: "t1", name: "B", email: null, phone: null, loyaltyPoints: 20, membershipTier: "none" as const, createdAt: "2026-01-01T00:00:00.000Z" }];
    const orders = [
      order({ customerId: "c1", createdAt: "2026-01-01T10:00:00.000Z" }),
      order({ customerId: "c1", createdAt: "2026-01-02T10:00:00.000Z" }),
      order({ customerId: "c3", createdAt: "2026-01-01T15:00:00.000Z" }),
    ] as OrderRecord[];
    expect(customerAnalytics(customers, orders, DAILY)).toEqual({ totalCustomers: 2, activeInPeriod: 2, averagePoints: 15 });
  });

  it("inventoryAnalytics: zeros for empty materials", () => {
    expect(inventoryAnalytics([], new Date("2026-01-01T00:00:00Z"))).toEqual({ materialCount: 0, lowStockCount: 0, expiringSoonCount: 0 });
  });

  it("operationalAnalytics: zeros for empty", () => {
    expect(operationalAnalytics([])).toEqual({ byType: [], cancellationRate: 0, completedCount: 0 });
  });
});




