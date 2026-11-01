/**
 * Phase A — atomic order persistence, isolation, and audit/integrity tests.
 *
 * These tests use an in-memory FAKE of the small slice of the Prisma client the
 * transactional adapter touches. They NEVER connect to Supabase and NEVER write
 * production data. The fake models a real transaction: `$transaction` runs the
 * callback against a shadow copy and only commits on success — a thrown error
 * leaves the store untouched, which is exactly how we prove atomic rollback.
 */
import { describe, expect, it } from "vitest";
import { PrismaOrders } from "@/server/db/orders-adapter";
import { PrismaAudit } from "@/server/db/audit-adapter";
import { createProductionOrder } from "@/server/orders-create";
import { MemoryOrders } from "@/server/db/memory-store";
import { demoSandbox } from "@/server/runtime";
import { assertOutlet } from "@/domain/authz/rbac";
import type { CreateOrderRequest } from "@/domain/pos/contracts";
import type { AuditEvent } from "@/domain/audit/events";

// ---------------------------------------------------------------------------
// Fake Prisma client — models only the operations the adapter performs.
// ---------------------------------------------------------------------------
interface FakeProduct {
  id: string;
  organizationId: string;
  name: string;
  priceIdr: bigint;
  station: "KITCHEN" | "BAR";
  active: boolean;
}

class FakeTx {
  orders: { id: string; organizationId: string; outletId: string; dataScope: "DEMO" | "PRODUCTION"; orderNumber: string; orderType: string }[] = [];
  /** Phase 11: committed-order snapshot visible to in-transaction reads (READ COMMITTED). */
  seed: { id: string; organizationId: string; outletId: string; dataScope: "DEMO" | "PRODUCTION"; orderNumber: string; orderType: string }[] = [];
  counters = new Map<string, bigint>();
  audits: { id: string; action: string; entityId: string; organizationId: string | null }[] = [];
  idempotency = new Map<string, { status: string; responseJson: string | null }>();
  products: FakeProduct[];

  constructor(products: FakeProduct[]) {
    this.products = products;
  }

  // Phase 8: tenant-context pinning no-ops on the fake (records GUC intent only).
  $executeRawUnsafe = async (_sql: string, ..._params: unknown[]): Promise<unknown> => undefined;

  menuItem = {
    findUnique: async ({ where }: { where: { id: string } }) => this.products.find((p) => p.id === where.id) ?? null,
  };

  sequenceCounter = {
    upsert: async ({ where, create, update }: {
      where: { outletId_kind: { outletId: string; kind: string } };
      create: { outletId: string; kind: string; value: bigint };
      update: { value: { increment: bigint } };
    }) => {
      const key = `${where.outletId_kind.outletId}::${where.outletId_kind.kind}`;
      const next = (this.counters.get(key) ?? BigInt(0)) + update.value.increment;
      this.counters.set(key, next);
      return { outletId: create.outletId, kind: create.kind, value: next };
    },
  };

  order = {
    create: async ({ data }: { data: { id: string; organizationId: string; outletId: string; dataScope: "DEMO" | "PRODUCTION"; orderNumber: string; orderType: string; items: { create: unknown[] } } }) => {
      if (data.organizationId === "THROW_ON_ORDER") throw new Error("simulated order insert failure");
      this.orders.push({ id: data.id, organizationId: data.organizationId, outletId: data.outletId, dataScope: data.dataScope, orderNumber: data.orderNumber, orderType: data.orderType });
      return { id: data.id };
    },
    findUnique: async ({ where }: { where: { id: string; organizationId?: string; outletId?: string } }) => {
      // Phase 11: in-transaction reads see committed rows (seed) + this tx's writes.
      const row = [...this.seed, ...this.orders].find((o) => o.id === where.id) ?? null;
      if (!row) return null;
      if (where.organizationId && row.organizationId !== where.organizationId) return null;
      if (where.outletId && row.outletId !== where.outletId) return null;
      const now = new Date();
      return {
        ...row,
        tableId: null,
        customerId: null,
        subtotalIdr: BigInt(0),
        discountIdr: BigInt(0),
        taxIdr: BigInt(0),
        grandTotalIdr: BigInt(0),
        state: "placed",
        paymentState: "unpaid",
        createdBy: "usr_pos",
        createdAt: now,
        updatedAt: now,
        items: [],
      };
    },
  };

  auditEvent = {
    create: async ({ data }: { data: { id: string; action: string; entityId: string; organizationId: string | null } }) => {
      if (data.id === "THROW") throw new Error("simulated audit insert failure");
      this.audits.push(data);
      return { id: data.id };
    },
  };

  idempotencyRecord = {
    update: async ({ where, data }: { where: { organizationId_scope_key: { organizationId: string; scope: string; key: string } }; data: { status: string; responseJson: string } }) => {
      const key = `${where.organizationId_scope_key.organizationId}::${where.organizationId_scope_key.scope}::${where.organizationId_scope_key.key}`;
      this.idempotency.set(key, { status: data.status, responseJson: data.responseJson });
      return { id: key };
    },
  };
}

/** Transactional fake: run the callback on a CLONE; commit only on success. */
function makeFakeDb(products: FakeProduct[]) {
  const committed = new FakeTx(products);
  // Serialize transactions (models the Postgres row-lock on the sequence
  // counter): concurrent createTransactional calls queue so each sees the
  // previous commit, exactly like a real DB. A thrown callback commits nothing.
  let chain: Promise<unknown> = Promise.resolve();
  return {
    committed,
    // Top-level reads (adapter findById reads outside a transaction).
    order: {
      findUnique: async ({ where }: { where: { id: string; organizationId?: string; outletId?: string } }) => {
        const row = committed.orders.find((o) => o.id === where.id) ?? null;
        if (!row) return null;
        if (where.organizationId && row.organizationId !== where.organizationId) return null;
        if (where.outletId && row.outletId !== where.outletId) return null;
        const now = new Date();
        return {
          ...row,
          tableId: null,
          customerId: null,
          subtotalIdr: BigInt(0),
          discountIdr: BigInt(0),
          taxIdr: BigInt(0),
          grandTotalIdr: BigInt(0),
          state: "placed",
          paymentState: "unpaid",
          createdBy: "usr_pos",
          createdAt: now,
          updatedAt: now,
          items: [],
        };
      },
    },
    $transaction<T>(fn: (tx: FakeTx) => Promise<T>): Promise<T> {
      const run = chain.then(async () => {
        const shadow = new FakeTx(products);
        shadow.counters = new Map(committed.counters); // continue counter sequence across commits
        shadow.seed = [...committed.orders]; // Phase 11: READ COMMITTED — see prior commits
        const result = await fn(shadow);
        committed.counters = shadow.counters;
        committed.orders = [...committed.orders, ...shadow.orders];
        committed.audits = [...committed.audits, ...shadow.audits];
        shadow.idempotency.forEach((v, k) => committed.idempotency.set(k, v));
        return result;
      });
      // Keep the chain alive regardless of this txn's outcome.
      chain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}

const PRODUCTS: FakeProduct[] = [
  { id: "prod_1", organizationId: "ten_prod", name: "Nasi Goreng", priceIdr: BigInt(25_000), station: "KITCHEN", active: true },
  { id: "prod_2", organizationId: "ten_prod", name: "Es Teh", priceIdr: BigInt(8_000), station: "BAR", active: true },
  { id: "prod_other", organizationId: "ten_other", name: "Foreign Item", priceIdr: BigInt(9_000), station: "KITCHEN", active: true },
  // Owned by the tenant that forces the ORDER insert to throw, so the catalog
  // check passes and the simulated failure happens exactly at order.create.
  { id: "prod_throw", organizationId: "THROW_ON_ORDER", name: "Boom", priceIdr: BigInt(10_000), station: "KITCHEN", active: true },
];


// ---------------------------------------------------------------------------
describe("Phase A — production order persistence", () => {
  it("1. writes dataScope PRODUCTION on the live transactional path", async () => {
    const db = makeFakeDb(PRODUCTS);
    const order = await createProductionOrder({
      orders: ordersOf(db),
      actor: { userId: "usr_pos", role: "pos", tenantId: "ten_prod", outletId: "out_prod" },
      request: req(),
      idempotency: { organizationId: "ten_prod", scope: "orders.create", key: "k1" },
    });
    expect(order.dataScope).toBe("PRODUCTION");
    expect(db.committed.orders[0]!.dataScope).toBe("PRODUCTION");
    expect(order.grandTotalIdr).toBe(50_000); // 2 × 25,000, server-authoritative
    expect(order.orderNumber).toBe("ORD-00001");
  });

  it("derives tenant/outlet from the session, ignoring untrusted body fields", async () => {
    const db = makeFakeDb(PRODUCTS);
    await createProductionOrder({
      orders: ordersOf(db),
      actor: { userId: "usr_pos", role: "pos", tenantId: "ten_prod", outletId: "out_prod" },
      request: req(),
      idempotency: { organizationId: "ten_prod", scope: "orders.create", key: "k-scope" },
    });
    const row = db.committed.orders[0]!;
    expect(row.organizationId).toBe("ten_prod");
    expect(row.outletId).toBe("out_prod");
  });

  it("rejects a cross-tenant product (server-authoritative catalog check)", async () => {
    const db = makeFakeDb(PRODUCTS);
    await expect(
      createProductionOrder({
        orders: ordersOf(db),
        actor: { userId: "usr_pos", role: "pos", tenantId: "ten_prod", outletId: "out_prod" },
        request: req({ lines: [{ productId: "prod_other", quantity: 1 }] }),
        idempotency: { organizationId: "ten_prod", scope: "orders.create", key: "k-xt" },
      }),
    ).rejects.toThrow(/Unknown product/);
    expect(db.committed.orders).toHaveLength(0);
  });

  it("3. rolls back order + items + counter + audit + idempotency together on failure", async () => {
    const db = makeFakeDb(PRODUCTS);
    await expect(
      createProductionOrder({
        orders: ordersOf(db),
        actor: { userId: "usr_pos", role: "pos", tenantId: "THROW_ON_ORDER", outletId: "out_prod" },
        request: req({ lines: [{ productId: "prod_throw", quantity: 1 }] }),
        idempotency: { organizationId: "THROW_ON_ORDER", scope: "orders.create", key: "k-rb" },
      }),
    ).rejects.toThrow(/simulated order insert failure/);
    expect(db.committed.orders).toHaveLength(0);
    expect(db.committed.counters.size).toBe(0);
    expect(db.committed.audits).toHaveLength(0);
    expect(db.committed.idempotency.size).toBe(0);
  });

  it("commits the audit row atomically with the order (no un-audited order)", async () => {
    const db = makeFakeDb(PRODUCTS);
    const order = await createProductionOrder({
      orders: ordersOf(db),
      actor: { userId: "usr_pos", role: "pos", tenantId: "ten_prod", outletId: "out_prod" },
      request: req(),
      idempotency: { organizationId: "ten_prod", scope: "orders.create", key: "k-aud" },
    });
    expect(db.committed.audits).toHaveLength(1);
    expect(db.committed.audits[0]!.action).toBe("order.created");
    expect(db.committed.audits[0]!.entityId).toBe(order.id);
  });

  it("6. rolls the order back when the audit insert fails (audit not silently ignored)", async () => {
    const db = makeFakeDb(PRODUCTS);
    await expect(
      ordersOf(db).createTransactional(
        {
          id: "ord_throw",
          organizationId: "ten_prod",
          outletId: "out_prod",
          dataScope: "PRODUCTION",
          orderType: "dine-in",
          tableId: null,
          customerId: null,
          discountIdr: 0,
          taxPercent: 0,
          lines: [{ id: "item_1", productId: "prod_1", quantity: 1, modifierIds: [] }],
          createdBy: "usr_pos",
          createdAt: new Date().toISOString(),
        },
        { audit: { id: "THROW", action: "order.created", actorId: "usr_pos", actorRole: "pos" } },
      ),
    ).rejects.toThrow(/simulated audit insert failure/);
    expect(db.committed.orders).toHaveLength(0);
  });

  it("PrismaAudit.record surfaces failures instead of swallowing them", async () => {
    const throwing = { auditEvent: { create: async () => { throw new Error("db down"); } } };
    const audit = new PrismaAudit(throwing as unknown as ConstructorParameters<typeof PrismaAudit>[0]);
    const event: AuditEvent = {
      id: "aud_1",
      action: "order.created",
      actorId: "usr_pos",
      actorRole: "pos",
      entityType: "order",
      entityId: "ord_1",
      occurredAt: new Date().toISOString(),
    };
    await expect(audit.record(event)).rejects.toThrow(/db down/);
  });

  it("5. completes the idempotency claim atomically with the order", async () => {
    const db = makeFakeDb(PRODUCTS);
    await createProductionOrder({
      orders: ordersOf(db),
      actor: { userId: "usr_pos", role: "pos", tenantId: "ten_prod", outletId: "out_prod" },
      request: req(),
      idempotency: { organizationId: "ten_prod", scope: "orders.create", key: "k-idem" },
    });
    const stored = db.committed.idempotency.get("ten_prod::orders.create::k-idem");
    expect(stored?.status).toBe("completed");
    expect(stored?.responseJson).toContain("ORD-00001");
  });

  it("4. preserves unique order numbers across concurrent creations", async () => {
    const db = makeFakeDb(PRODUCTS);
    const mk = (key: string) =>
      createProductionOrder({
        orders: ordersOf(db),
        actor: { userId: "usr_pos", role: "pos", tenantId: "ten_prod", outletId: "out_prod" },
        request: req(),
        idempotency: { organizationId: "ten_prod", scope: "orders.create", key },
      });
    const [a, b, c] = await Promise.all([mk("k1"), mk("k2"), mk("k3")]);
    expect(new Set([a.orderNumber, b.orderNumber, c.orderNumber]).size).toBe(3);
  });
});

function req(overrides: Partial<CreateOrderRequest> = {}): CreateOrderRequest {
  return { orderType: "dine-in", tableId: "t1", lines: [{ productId: "prod_1", quantity: 2 }], ...overrides };
}

function ordersOf(db: ReturnType<typeof makeFakeDb>): PrismaOrders {
  return new PrismaOrders(db as unknown as ConstructorParameters<typeof PrismaOrders>[0]);
}

// ---------------------------------------------------------------------------
describe("Phase A — demo isolation", () => {
  it("2. demo orders stay in memory and never reach Prisma", async () => {
    delete (globalThis as unknown as { __hansanDemoRuntime?: unknown }).__hansanDemoRuntime;
    const sandbox = demoSandbox();
    expect(sandbox.scope).toBe("DEMO");
    expect(sandbox.orders).toBeInstanceOf(MemoryOrders);
    await sandbox.orders.save({
      id: "ord_demo",
      tenantId: "ten_demo",
      outletId: "out_demo",
      orderNumber: "ORD-00001",
      orderType: "dine-in",
      dataScope: "DEMO",
      tableId: null,
      customerId: null,
      lines: [],
      subtotalIdr: 0,
      discountIdr: 0,
      taxIdr: 0,
      grandTotalIdr: 0,
      state: "placed",
      paymentState: "unpaid",
      createdBy: "usr_demo",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const found = await sandbox.orders.findById("ord_demo", { organizationId: "ten_demo" });
    expect(found?.dataScope).toBe("DEMO");
    expect((sandbox.orders as MemoryOrders).rows.get("ord_demo")?.tenantId).toBe("ten_demo");
  });
});

// ---------------------------------------------------------------------------
describe("Phase A — adapter tenant/outlet scoping (defense in depth)", () => {
  it("7. findById denies a cross-tenant record at the adapter boundary", async () => {
    const db = makeFakeDb(PRODUCTS);
    const orders = ordersOf(db);
    const order = await createProductionOrder({
      orders,
      actor: { userId: "usr_pos", role: "pos", tenantId: "ten_prod", outletId: "out_prod" },
      request: req(),
      idempotency: { organizationId: "ten_prod", scope: "orders.create", key: "k-find" },
    });
    expect((await orders.findById(order.id, { organizationId: "ten_prod" }))?.id).toBe(order.id);
    expect(await orders.findById(order.id, { organizationId: "ten_attacker" })).toBeNull();
  });

  it("MemoryOrders enforces the optional tenant scope too", async () => {
    const mem = new MemoryOrders();
    await mem.save({
      id: "ord_x",
      tenantId: "ten_a",
      outletId: "out_a",
      orderNumber: "ORD-00001",
      orderType: "dine-in",
      tableId: null,
      customerId: null,
      lines: [],
      subtotalIdr: 0,
      discountIdr: 0,
      taxIdr: 0,
      grandTotalIdr: 0,
      state: "placed",
      paymentState: "unpaid",
      createdBy: "u",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(await mem.findById("ord_x", { organizationId: "ten_a" })).not.toBeNull();
    expect(await mem.findById("ord_x", { organizationId: "ten_b" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("Phase A — outlet scoping & role separation", () => {
  it("9. developer role can no longer bypass outlet scope", () => {
    const dev = { userId: "usr_dev", role: "developer" as const, tenantId: "ten_prod", outletIds: [] as string[] };
    expect(() => assertOutlet(dev, "out_unassigned")).toThrow(/Outlet access denied/);
  });

  it("8. pos restricted to granted outlets; owner/finance are not", () => {
    const pos = { userId: "usr_pos", role: "pos" as const, tenantId: "ten_prod", outletIds: ["out_1"] };
    expect(() => assertOutlet(pos, "out_1")).not.toThrow();
    expect(() => assertOutlet(pos, "out_2")).toThrow(/Outlet access denied/);
    const owner = { userId: "usr_owner", role: "owner" as const, tenantId: "ten_prod", outletIds: [] as string[] };
    expect(() => assertOutlet(owner, "out_any")).not.toThrow();
    const finance = { userId: "usr_fin", role: "finance" as const, tenantId: "ten_prod", outletIds: [] as string[] };
    expect(() => assertOutlet(finance, "out_any")).not.toThrow();
  });
});

