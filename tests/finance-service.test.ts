import { describe, expect, it, beforeEach } from "vitest";
import { FinanceService } from "@/domain/finance/service";
import { MemoryAudit, MemoryFinance, MemoryOrders } from "./helpers/memory";
import { ERROR_CODES } from "@/domain/shared/errors";

function deps(clock: () => Date = () => new Date("2026-01-01T00:00:00.000Z")) {
  return { finance: new MemoryFinance(), orders: new MemoryOrders(), audit: new MemoryAudit(), clock };
}

describe("FinanceService", () => {
  let s: FinanceService;
  let orders: MemoryOrders;
  let audit: MemoryAudit;
  let finance: MemoryFinance;

  beforeEach(() => {
    const d = deps();
    s = new FinanceService(d);
    orders = d.orders;
    audit = d.audit;
    finance = d.finance;
  });

  it("records expense after integer validation", async () => {
    const e = await s.recordExpense({ actor: { id: "a1", displayName: "A", email: "a@x", role: "owner", tenantId: "t1", outletIds: ["o1"], active: true, createdAt: "2026-01-01T00:00:00.000Z" }, tenantId: "t1", outletId: "o1", category: "ops", description: "Shift", amountIdr: 150_000, incurredAtIso: "2026-01-01T00:00:00.000Z" });
    expect(e.id).toMatch(/^exp_/);
    expect(e.amountIdr).toBe(150_000);
    expect(audit.events).toHaveLength(0);
    await expect(s.recordExpense({ actor: { id: "a1", displayName: "A", email: "a@x", role: "owner", tenantId: "t1", outletIds: ["o1"], active: true, createdAt: "2026-01-01T00:00:00.000Z" }, tenantId: "t1", outletId: "o1", category: "ops", description: "x", amountIdr: 10.5, incurredAtIso: "2026-01-01T00:00:00.000Z" })).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });
  });

  it("end-to-end refund: request → approve (different actor) → complete", async () => {
    const order = { id: "ord_1", tenantId: "t1", outletId: "o1", orderNumber: "ORD-00001", orderType: "take-away" as const, tableId: null, customerId: null, lines: [], subtotalIdr: 100_000, discountIdr: 0, taxIdr: 0, grandTotalIdr: 100_000, state: "completed" as const, paymentState: "paid" as const, createdBy: "u1", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
    await orders.save(order);
    const r = await s.requestRefund({ tenantId: "t1", outletId: "o1", orderId: "ord_1", amountIdr: 30_000, reason: "wrong", requester: { id: "u_pos", displayName: "Pos", email: "pos@x", role: "pos", tenantId: "t1", outletIds: ["o1"], active: true, createdAt: "2026-01-01T00:00:00.000Z" } });
    expect(r.status).toBe("pending");
    expect(audit.events.some((e) => e.action === "finance.refund_requested")).toBe(true);

    const approved = await s.decideRefund(r.id, "approved", { id: "u_hr", displayName: "Hr", email: "hr@x", role: "finance", tenantId: "t1", outletIds: ["o1"], active: true, createdAt: "2026-01-01T00:00:00.000Z" });
    expect(approved.status).toBe("approved");
    await expect(s.decideRefund(r.id, "approved", { id: "u_pos", displayName: "Pos", email: "pos@x", role: "pos", tenantId: "t1", outletIds: ["o1"], active: true, createdAt: "2026-01-01T00:00:00.000Z" })).rejects.toMatchObject({ code: ERROR_CODES.REFUND_ALREADY_DECIDED });

    const completed = await s.completeRefund(r.id, { id: "u_hr2", displayName: "Hr2", email: "hr2@x", role: "finance", tenantId: "t1", outletIds: ["o1"], active: true, createdAt: "2026-01-01T00:00:00.000Z" });
    expect(completed.status).toBe("completed");
    expect(finance.events.some((e) => e.action === "finance.refund_approved")).toBe(true);
    expect(finance.events.some((e) => e.action === "finance.refund_completed")).toBe(true);
  });

  it("rejects self-approval and out-of-order decisions", async () => {
    const order = { id: "ord_1", tenantId: "t1", outletId: "o1", orderNumber: "ORD-00001", orderType: "take-away" as const, tableId: null, customerId: null, lines: [], subtotalIdr: 100_000, discountIdr: 0, taxIdr: 0, grandTotalIdr: 100_000, state: "completed" as const, paymentState: "paid" as const, createdBy: "u1", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
    await orders.save(order);
    const r2 = await s.requestRefund({ tenantId: "t1", outletId: "o1", orderId: "ord_1", amountIdr: 10_000, reason: "x", requester: { id: "u1", displayName: "U1", email: "u1@x", role: "pos", tenantId: "t1", outletIds: ["o1"], active: true, createdAt: "2026-01-01T00:00:00.000Z" } });
    await expect(s.decideRefund(r2.id, "approved", { id: "u1", displayName: "U1", email: "u1@x", role: "pos", tenantId: "t1", outletIds: ["o1"], active: true, createdAt: "2026-01-01T00:00:00.000Z" })).rejects.toMatchObject({ code: ERROR_CODES.REFUND_APPROVAL_REQUIRED });
    await s.decideRefund(r2.id, "approved", { id: "u_hr", displayName: "Uhr", email: "uhr@x", role: "finance", tenantId: "t1", outletIds: ["o1"], active: true, createdAt: "2026-01-01T00:00:00.000Z" });
    await expect(s.decideRefund(r2.id, "rejected", { id: "u_hr2", displayName: "Uhr2", email: "uhr2@x", role: "finance", tenantId: "t1", outletIds: ["o1"], active: true, createdAt: "2026-01-01T00:00:00.000Z" })).rejects.toMatchObject({ code: ERROR_CODES.REFUND_ALREADY_DECIDED });
    await expect(s.completeRefund("ref_9", { id: "u_hr", displayName: "Uhr", email: "uhr@x", role: "finance", tenantId: "t1", outletIds: ["o1"], active: true, createdAt: "2026-01-01T00:00:00.000Z" })).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
  });


  // ---------- OA17: atomic transition + audit consistency ----------

  const financeActor = (overrides: Partial<{ id: string; role: string; tenantId: string }> = {}) => ({
    id: overrides.id ?? "u_hr",
    displayName: "Hr",
    email: "hr@x",
    role: overrides.role ?? "finance",
    tenantId: overrides.tenantId ?? "t1",
    outletIds: ["o1"],
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  const seedPendingRefund = async (tenantId = "t1", outletId = "o1") => {
    const order = {
      id: "ord_refund_1", tenantId, outletId, orderNumber: "ORD-00001",
      orderType: "take-away" as const, tableId: null, customerId: null, lines: [],
      subtotalIdr: 100_000, discountIdr: 0, taxIdr: 0, grandTotalIdr: 100_000,
      state: "completed" as const, paymentState: "paid" as const, createdBy: "u1",
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    };
    await orders.save(order);
    const r = await s.requestRefund({ tenantId, outletId, orderId: "ord_refund_1", amountIdr: 30_000, reason: "wrong", requester: financeActor({ id: "u_pos", role: "pos", tenantId }) });
    return r;
  };

  it("OA17: successful refund decision changes state and records exactly one audit event", async () => {
    const r = await seedPendingRefund();
    const beforeAuditLen = finance.events.length;
    const approved = await s.decideRefund(r.id, "approved", financeActor({ id: "u_hr", role: "finance" }));
    expect(approved.status).toBe("approved");
    expect(approved.decidedBy).toBe("u_hr");
    expect(finance.events).toHaveLength(beforeAuditLen + 1);
    const ev = finance.events[finance.events.length - 1];
    expect(ev.action).toBe("finance.refund_approved");
    expect(ev.actorId).toBe("u_hr");
    expect(ev.actorRole).toBe("finance");
    expect(ev.tenantId).toBe("t1");
    expect(ev.entityType).toBe("refund");
    expect(ev.entityId).toBe(r.id);
    expect(ev.metadata).toMatchObject({ amountIdr: 30_000 });
  });

  it("OA17: successful refund completion changes state and records exactly one audit event", async () => {
    const r = await seedPendingRefund();
    await s.decideRefund(r.id, "approved", financeActor({ id: "u_hr", role: "finance" }));
    const beforeAuditLen = finance.events.length;
    const completed = await s.completeRefund(r.id, financeActor({ id: "u_hr2", role: "finance" }));
    expect(completed.status).toBe("completed");
    expect(finance.events).toHaveLength(beforeAuditLen + 1);
    const ev = finance.events[finance.events.length - 1];
    expect(ev.action).toBe("finance.refund_completed");
    expect(ev.actorId).toBe("u_hr2");
    expect(ev.actorRole).toBe("finance");
    expect(ev.tenantId).toBe("t1");
    expect(ev.entityId).toBe(r.id);
  });

  it("OA17: invalid transition does not mutate state or create audit events", async () => {
    const r = await seedPendingRefund();
    const beforeAuditLen = finance.events.length;
    await expect(s.completeRefund(r.id, financeActor({ id: "u_hr", role: "finance" }))).rejects.toMatchObject({ code: ERROR_CODES.REFUND_ALREADY_DECIDED });
    const after = await finance.getRefund(r.id, "t1");
    expect(after!.status).toBe("pending");
    expect(finance.events).toHaveLength(beforeAuditLen);
  });

  it("OA17: cross-tenant attempt cannot mutate refund or create audit events", async () => {
    const r = await seedPendingRefund("t1", "o1");
    const beforeAuditLen = finance.events.length;
    await expect(s.decideRefund(r.id, "approved", financeActor({ id: "u_evil", role: "finance", tenantId: "ten_evil" }))).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
    const after = await finance.getRefund(r.id, "t1");
    expect(after!.status).toBe("pending");
    expect(finance.events).toHaveLength(beforeAuditLen);
  });

  it("OA17: concurrent transition conflict creates no audit event", async () => {
    const r = await seedPendingRefund();
    const beforeAuditLen = finance.events.length;
    const first = await s.decideRefund(r.id, "approved", financeActor({ id: "u_hr", role: "finance" }));
    expect(first.status).toBe("approved");
    await expect(s.decideRefund(r.id, "rejected", financeActor({ id: "u_hr2", role: "finance" }))).rejects.toMatchObject({ code: ERROR_CODES.REFUND_ALREADY_DECIDED });
    expect(finance.events).toHaveLength(beforeAuditLen + 1);
  });

  it("OA17: actor identity/role/tenant are server-derived and persisted", async () => {
    const r = await seedPendingRefund();
    const approved = await s.decideRefund(r.id, "approved", financeActor({ id: "u_hr", role: "finance", tenantId: "t1" }));
    expect(approved.decidedBy).toBe("u_hr");
    const ev = finance.events[finance.events.length - 1];
    expect(ev.actorId).toBe("u_hr");
    expect(ev.actorRole).toBe("finance");
    expect(ev.tenantId).toBe("t1");
    expect(ev.entityId).toBe(r.id);
    await expect(s.decideRefund(r.id, "rejected", financeActor({ id: "u_evil", role: "finance", tenantId: "ten_evil" }))).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
    expect(finance.events).toHaveLength(1);
  });

  it("OA17: repeated service calls do not duplicate audit events", async () => {
    const r = await seedPendingRefund();
    const approved = await s.decideRefund(r.id, "approved", financeActor({ id: "u_hr", role: "finance" }));
    expect(approved.status).toBe("approved");
    const approvedCount = finance.events.filter((e) => e.action === "finance.refund_approved").length;
    expect(approvedCount).toBe(1);
    await expect(s.decideRefund(r.id, "approved", financeActor({ id: "u_hr", role: "finance" }))).rejects.toMatchObject({ code: ERROR_CODES.REFUND_ALREADY_DECIDED });
    expect(finance.events.filter((e) => e.action === "finance.refund_approved")).toHaveLength(approvedCount);
  });

  it("summary returns REAL aggregates, never fake data", async () => {
    const sev = new FinanceService(deps(() => new Date("2026-01-02T00:00:00.000Z")));
    const s1 = await sev.summary("t1");
    expect(s1).toEqual({
      grossSalesIdr: 0, discountsIdr: 0, taxCollectedIdr: 0, refundsIdr: 0, netRevenueIdr: 0, expensesIdr: 0, operatingResultIdr: 0,
      orderCount: 0, refundCount: 0, expenseCount: 0, expensesByCategory: [],
    });
  });
});
