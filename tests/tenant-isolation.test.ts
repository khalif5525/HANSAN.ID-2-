/**
 * Phase 8 adversarial tenant-isolation tests (unit, no database).
 * Proves: missing/invalid context fails closed; cross-tenant reads/writes
 * rejected; GUC pinning is first-in-tx with no pool leakage (SET LOCAL);
 * RLS artifact predicates are fail-closed (no missing_ok fallback).
 * Real PostgreSQL integration is explicitly OUT OF SCOPE here (no prod creds,
 * no disposable PG available) — see remaining-risks section in final report.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ERROR_CODES } from "@/domain/shared/errors";
import {
  pinTenantContext,
  requireTenantContext,
  tenantContextForActor,
  tenantContextSetLocalSql,
  withTenantTransaction,
} from "@/server/db/tenant-context";

describe("tenant context validation (fail-closed)", () => {
  it("rejects missing organization", () => {
    expect(() => requireTenantContext({ organizationId: "", outletId: "out_1", role: "pos" })).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.TENANT_MISMATCH }),
    );
  });
  it("rejects empty outlet and unknown role", () => {
    expect(() => requireTenantContext({ organizationId: "ten_a", outletId: "  ", role: "pos" })).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.OUTLET_MISMATCH }),
    );
    expect(() => requireTenantContext({ organizationId: "ten_a", outletId: null, role: "superuser" })).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.FORBIDDEN }),
    );
  });
  it("rejects DEMO scope on the production path", () => {
    expect(() =>
      requireTenantContext({ organizationId: "ten_a", outletId: null, role: "owner", dataScope: "DEMO" }),
    ).toThrowError(expect.objectContaining({ code: ERROR_CODES.FORBIDDEN }));
  });
  it("rejects ungranted outlet for non-owner roles", () => {
    const actor = { tenantId: "ten_a", outletIds: ["out_1"], role: "pos" };
    expect(() => tenantContextForActor(actor, "out_2")).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.OUTLET_MISMATCH }),
    );
    expect(tenantContextForActor(actor, "out_1").organizationId).toBe("ten_a");
  });
});

describe("transaction-local pinning (no pool leakage)", () => {
  it("pins all four GUCs via SET LOCAL before protected work", async () => {
    const calls: { sql: string; param: unknown }[] = [];
    const tx = { $executeRawUnsafe: async (sql: string, ...p: unknown[]) => { calls.push({ sql, param: p[0] }); } };
    await pinTenantContext(tx, { organizationId: "ten_a", outletId: "out_1", role: "pos", dataScope: "PRODUCTION" });
    expect(calls).toHaveLength(4);
    for (const c of calls) expect(c.sql).toMatch(/set_config\('app\./);
    expect(calls.map((c) => c.param)).toEqual(["ten_a", "out_1", "pos", "PRODUCTION"]);
  });
  it("pins __none__ sentinel for tenant-wide reads (never empty string)", async () => {
    const params: unknown[] = [];
    const tx = { $executeRawUnsafe: async (_s: string, ...p: unknown[]) => { params.push(p[0]); } };
    await pinTenantContext(tx, { organizationId: "ten_a", outletId: null, role: "owner", dataScope: "PRODUCTION" });
    expect(params[1]).toBe("__none__");
  });
  it("withTenantTransaction pins context FIRST, then runs protected work", async () => {
    const order: string[] = [];
    const db = {
      $transaction: async <T>(fn: (tx: { $executeRawUnsafe: () => Promise<unknown> }) => Promise<T>): Promise<T> => {
        const tx = { $executeRawUnsafe: async () => { order.push("pin"); } };
        return fn(tx);
      },
    };
    await withTenantTransaction(db, { organizationId: "ten_a", outletId: "out_1", role: "pos", dataScope: "PRODUCTION" }, async () => {
      order.push("work");
      return "ok";
    });
    expect(order.slice(0, 4)).toEqual(["pin", "pin", "pin", "pin"]);
    expect(order[4]).toBe("work");
  });
});

const ROOT = path.resolve(__dirname, "..");

describe("adapter cross-tenant rejection (unit fakes)", () => {
  it("PrismaCatalog scoped findById cannot read another tenant", async () => {
    const { PrismaCatalog } = await import("@/server/db/catalog-adapter");
    const row = { id: "p1", organizationId: "ten_a", categoryId: "c", name: "N", priceIdr: BigInt(1000), station: "KITCHEN", active: true, createdAt: new Date() };
    const models = { menuItem: { findFirst: async (a: { where: { id: string; organizationId: string } }) => (a.where.organizationId === row.organizationId ? row : null), findUnique: async () => row } };
    // Phase 11: scoped reads run inside a pinned $transaction; the fake tx
    // simply no-ops the GUC pin and reuses the same model stubs.
    const db = { ...models, $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({ ...models, $executeRawUnsafe: async () => 0 }) };
    const catalog = new PrismaCatalog(db as unknown as ConstructorParameters<typeof PrismaCatalog>[0]);
    expect(await catalog.findById("p1", { organizationId: "ten_a" })).not.toBeNull();
    expect(await catalog.findById("p1", { organizationId: "ten_b" })).toBeNull();
  });
  it("PrismaPayments scoped listByOrder returns [] for foreign orders", async () => {
    const { PrismaPayments } = await import("@/server/db/payment-adapter");
    const models = {
      order: { findFirst: async (a: { where: { id: string; organizationId: string } }) => (a.where.organizationId === "ten_a" ? { id: "ord_1" } : null) },
      payment: { findMany: async () => [{ id: "pay_1", organizationId: "ten_a", outletId: "o", orderId: "ord_1", amountIdr: BigInt(1), method: "cash", capturedBy: "u", capturedAt: new Date(), externalRef: null }] },
    };
    // Phase 11: scoped listByOrder runs inside a pinned $transaction (GUC pin no-ops on the fake tx).
    const db = { ...models, $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({ ...models, $executeRawUnsafe: async () => 0 }) };
    const payments = new PrismaPayments(db as unknown as ConstructorParameters<typeof PrismaPayments>[0]);
    expect(await payments.listByOrder("ord_1", { organizationId: "ten_a" })).toHaveLength(1);
    expect(await payments.listByOrder("ord_1", { organizationId: "ten_b" })).toEqual([]);
  });
});

describe("RLS tenant artifact (static, fail-closed)", () => {
  const rls = readFileSync(path.join(ROOT, "prisma", "rls-tenant-isolation.sql"), "utf8");
  it("covers every tenant-owned table with org predicates", () => {
    for (const table of ["Order", "OrderItem", "Payment", "Refund", "SettlementBatch", "MenuCategory", "MenuItem", "Ingredient", "Recipe", "RecipeItem", "InventoryMovement", "SequenceCounter", "IdempotencyRecord", "Approval", "AuditEvent"]) {
      expect(rls, `missing policy for ${table}`).toMatch(new RegExp(`ON "${table}"`));
    }
    expect(rls).toMatch(/current_setting\('app\.organization_id', false\)/);
  });
  it("never fails open on absent context (no missing_ok fallback)", () => {
    expect(rls).not.toMatch(/current_setting\('app\.[^']+', true\)/);
  });
  it("deliberately excludes bootstrap identity tables", () => {
    expect(rls).toContain("Organization/Outlet/User/Membership");
    expect(rls).toContain("NO RLS");
  });
  it("keeps audit/movement append-only (no UPDATE/DELETE policies)", () => {
    const audit = rls.split("\n").filter((l) => l.includes('ON "AuditEvent"')).join("\n");
    expect(audit).not.toMatch(/FOR\s+(UPDATE|DELETE)/i);
    const movement = rls.split("\n").filter((l) => l.includes('ON "InventoryMovement"')).join("\n");
    expect(movement).not.toMatch(/FOR\s+(UPDATE|DELETE)/i);
  });
});
