import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { PrismaClient, DataScope } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaReservations } from "@/server/db/reservation-adapter";
import type { ReservationRecord } from "@/domain/reservations/service";
import type { TenantScope } from "@/domain/shared/tenant-scope";
import { PG_TEST_URL_VAR, requirePgTestGuard } from "./helpers/pg-test-guard";
import { pinTenantContext, persistencePinContext } from "@/server/db/tenant-context";

requirePgTestGuard();

let prisma: PrismaClient;
const suffix = randomUUID().replace(/-/g, "");
const orgA = `ten_pd_a_${suffix}`;
const orgB = `ten_pd_b_${suffix}`;
const outletA = `out_pd_a_${suffix}`;
const outletB = `out_pd_b_${suffix}`;

function makeRecord(overrides: Partial<ReservationRecord> = {}): ReservationRecord {
  return {
    id: `rsv_pd_${randomUUID()}`,
    tenantId: orgA,
    outletId: outletA,
    customerName: "Phase D Guest",
    customerEmail: "phase-d@example.com",
    customerPhone: "08123456789",
    partySize: 4,
    reservationAt: "2030-01-01T12:00:00.000Z",
    durationMinutes: 60,
    status: "CONFIRMED",
    createdBy: "usr_phase_d",
    createdAt: "2030-01-01T11:00:00.000Z",
    updatedAt: "2030-01-01T11:00:00.000Z",
    ...overrides,
  };
}

beforeAll(async () => {
  const url = process.env[PG_TEST_URL_VAR];
  if (!url) throw new Error("missing test url");
  prisma = new PrismaClient({ datasources: { db: { url: url.trim() } } });
  await prisma.organization.create({
    data: { id: orgA, name: "Phase D Org A", slug: `phase-d-a-${suffix}`, dataScope: DataScope.PRODUCTION },
  });
  await prisma.organization.create({
    data: { id: orgB, name: "Phase D Org B", slug: `phase-d-b-${suffix}`, dataScope: DataScope.PRODUCTION },
  });
  await prisma.outlet.create({ data: { id: outletA, organizationId: orgA, name: "Phase D Outlet A" } });
  await prisma.outlet.create({ data: { id: outletB, organizationId: orgB, name: "Phase D Outlet B" } });
});

afterAll(async () => {
  if (prisma) await prisma.$disconnect();
});

async function scopedRow(id: string, orgId: string) {
  return prisma.$transaction(async (tx) => {
    await pinTenantContext(tx as never, persistencePinContext(orgId, null));
    return tx.reservation.findUnique({ where: { id } });
  });
}

describe("PrismaReservations persistence (live disposable PG)", () => {
  it("persists and reloads a reservation across transactions", async () => {
    const repo = new PrismaReservations(prisma);
    const scope: TenantScope = { organizationId: orgA, outletId: outletA };
    const record = makeRecord({ id: `rsv_pd_persist_${suffix}`, tableId: "tbl_1", area: "Main", notes: "hello" });
    await repo.save(record);
    const found = await repo.findById(record.id, scope);
    expect(found).not.toBeNull();
    expect(found).toMatchObject({
      id: record.id,
      status: "CONFIRMED",
      partySize: 4,
      tableId: "tbl_1",
      area: "Main",
      notes: "hello",
    });
    const row = await scopedRow(record.id, orgA);
    expect(row).not.toBeNull();
    expect(row?.organizationId).toBe(orgA);
  });

  it("preserves createdAt on update and changes mutable fields", async () => {
    const repo = new PrismaReservations(prisma);
    const scope: TenantScope = { organizationId: orgA, outletId: outletA };
    const record = makeRecord({ id: `rsv_pd_update_${suffix}` });
    await repo.save(record);
    const updated = { ...record, status: "CANCELLED" as const, notes: "cancelled", updatedAt: "2030-01-01T11:30:00.000Z" };
    await repo.save(updated);
    const found = await repo.findById(record.id, scope);
    expect(found?.status).toBe("CANCELLED");
    expect(found?.notes).toBe("cancelled");
    expect(found?.createdAt).toBe(record.createdAt);
  });

  it("returns null for a missing reservation", async () => {
    const repo = new PrismaReservations(prisma);
    const scope: TenantScope = { organizationId: orgA, outletId: outletA };
    expect(await repo.findById(`rsv_pd_missing_${suffix}`, scope)).toBeNull();
  });

  it("denies cross-tenant reads", async () => {
    const repo = new PrismaReservations(prisma);
    const record = makeRecord({ id: `rsv_pd_crossread_${suffix}` });
    await repo.save(record);
    const otherScope: TenantScope = { organizationId: orgB, outletId: outletB };
    expect(await repo.findById(record.id, otherScope)).toBeNull();
  });

  it("denies cross-tenant save attempts", async () => {
    const repo = new PrismaReservations(prisma);
    const record = makeRecord({ id: `rsv_pd_crosssave_${suffix}` });
    await repo.save(record);
    const crossTenant = { ...record, tenantId: orgB, outletId: outletB };
    await expect(repo.save(crossTenant)).rejects.toThrow();
  });

  it("isolates RLS direct access across tenants", async () => {
    const repo = new PrismaReservations(prisma);
    const record = makeRecord({ id: `rsv_pd_rls_${suffix}` });
    await repo.save(record);
    const rows = await prisma.$transaction(async (tx) => {
      await pinTenantContext(tx as never, persistencePinContext(orgB, null));
      return tx.reservation.findMany({ where: { id: record.id } });
    });
    expect(rows).toHaveLength(0);
  });

  it("lists by outlet with status filter, limit, and tenant isolation", async () => {
    const repo = new PrismaReservations(prisma);
    const a1 = makeRecord({ id: `rsv_pd_list_a1_${suffix}`, status: "CONFIRMED" });
    const a2 = makeRecord({ id: `rsv_pd_list_a2_${suffix}`, status: "CANCELLED" });
    const b1 = makeRecord({ id: `rsv_pd_list_b1_${suffix}`, tenantId: orgB, outletId: outletB, status: "CONFIRMED" });
    await repo.save(a1);
    await repo.save(a2);
    await repo.save(b1);
    const all = await repo.listByOutlet(outletA);
    expect(all.map((r) => r.id)).toEqual(expect.arrayContaining([a1.id, a2.id]));
    expect(all.map((r) => r.id)).not.toContain(b1.id);
    const confirmed = await repo.listByOutlet(outletA, { status: "CONFIRMED" });
    expect(confirmed.map((r) => r.id)).toContain(a1.id);
    expect(confirmed.map((r) => r.id)).not.toContain(a2.id);
    const limited = await repo.listByOutlet(outletA, { limit: 1 });
    expect(limited).toHaveLength(1);
  });

  it("lists by tenant without leaking other tenants", async () => {
    const repo = new PrismaReservations(prisma);
    const a = makeRecord({ id: `rsv_pd_tenant_a_${suffix}` });
    const b = makeRecord({ id: `rsv_pd_tenant_b_${suffix}`, tenantId: orgB, outletId: outletB });
    await repo.save(a);
    await repo.save(b);
    const rows = await repo.listByTenant(orgA);
    expect(rows.map((r) => r.id)).toContain(a.id);
    expect(rows.map((r) => r.id)).not.toContain(b.id);
  });

  it("counts overlapping occupying reservations", async () => {
    const repo = new PrismaReservations(prisma);
    const occupying = makeRecord({ id: `rsv_pd_count_occ_${suffix}`, reservationAt: "2030-01-01T10:00:00.000Z", durationMinutes: 60, status: "CONFIRMED" });
    const cancelled = makeRecord({ id: `rsv_pd_count_can_${suffix}`, reservationAt: "2030-01-01T10:00:00.000Z", durationMinutes: 60, status: "CANCELLED" });
    await repo.save(occupying);
    await repo.save(cancelled);
    expect(await repo.countByOutletAndTime(outletA, "2030-01-01T10:00:00.000Z", 60)).toBeGreaterThanOrEqual(1);
    expect(await repo.countByOutletAndTime(outletB, "2030-01-01T10:00:00.000Z", 60)).toBe(0);
  });

  it("returns an empty table list", async () => {
    const repo = new PrismaReservations(prisma);
    expect(await repo.listTables(outletA)).toEqual([]);
  });

  it("rolls back on invalid foreign key", async () => {
    const repo = new PrismaReservations(prisma);
    const bad = makeRecord({ id: `rsv_pd_badfk_${suffix}`, outletId: "out_does_not_exist" });
    await expect(repo.save(bad)).rejects.toThrow();
    const row = await scopedRow(bad.id, orgA);
    expect(row).toBeNull();
  });
});

