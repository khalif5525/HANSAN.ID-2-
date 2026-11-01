import { describe, expect, it } from "vitest";
import { MemoryReservations } from "@/server/db/reservation-adapter";
import type { ReservationRecord, ReservationStatus } from "@/domain/reservations/service";
import type { TenantScope } from "@/domain/shared/tenant-scope";

function record(overrides: Partial<ReservationRecord> = {}): ReservationRecord {
  return {
    id: "rsv_contract",
    tenantId: "ten_contract",
    outletId: "out_contract",
    customerName: "Guest",
    customerEmail: "g@example.com",
    customerPhone: "0",
    partySize: 2,
    reservationAt: "2030-01-01T10:00:00.000Z",
    durationMinutes: 60,
    status: "CONFIRMED",
    createdBy: "usr_pos",
    createdAt: "2030-01-01T09:00:00.000Z",
    updatedAt: "2030-01-01T09:00:00.000Z",
    ...overrides,
  };
}

const scope: TenantScope = { organizationId: "ten_contract", outletId: "out_contract" };
const otherScope: TenantScope = { organizationId: "ten_other", outletId: "out_other" };

describe("ReservationPort contract (MemoryReservations baseline)", () => {
  it("returns null for a missing reservation", async () => {
    const repo = new MemoryReservations();
    expect(await repo.findById("missing", scope)).toBeNull();
  });

  it("enforces tenant scope on findById", async () => {
    const repo = new MemoryReservations();
    await repo.save(record());
    expect(await repo.findById("rsv_contract", scope)).not.toBeNull();
    expect(await repo.findById("rsv_contract", otherScope)).toBeNull();
  });

  it("round-trips a saved reservation", async () => {
    const repo = new MemoryReservations();
    const r = record();
    await repo.save(r);
    const found = await repo.findById(r.id, scope);
    expect(found).toMatchObject({ id: r.id, status: "CONFIRMED", partySize: 2 });
  });

  it("lists by outlet and applies status filter", async () => {
    const repo = new MemoryReservations();
    await repo.save(record({ id: "rsv_a", status: "CONFIRMED" }));
    await repo.save(record({ id: "rsv_b", status: "CANCELLED" }));
    const all = await repo.listByOutlet("out_contract");
    expect(all).toHaveLength(2);
    const confirmed = await repo.listByOutlet("out_contract", { status: "CONFIRMED" });
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]?.id).toBe("rsv_a");
  });

  it("lists by tenant and ignores other tenants", async () => {
    const repo = new MemoryReservations();
    await repo.save(record({ id: "rsv_t1", tenantId: "ten_contract" }));
    await repo.save(record({ id: "rsv_t2", tenantId: "ten_other", outletId: "out_other" }));
    const rows = await repo.listByTenant("ten_contract");
    expect(rows.map((r) => r.id)).toEqual(["rsv_t1"]);
  });

  it("honors limit on listByOutlet", async () => {
    const repo = new MemoryReservations();
    for (let i = 0; i < 5; i++) {
      await repo.save(record({ id: `rsv_${i}` }));
    }
    const rows = await repo.listByOutlet("out_contract", { limit: 2 });
    expect(rows).toHaveLength(2);
  });

  it("counts overlapping reservations for the same outlet", async () => {
    const repo = new MemoryReservations();
    await repo.save(record());
    expect(await repo.countByOutletAndTime("out_contract", "2030-01-01T10:00:00.000Z", 60)).toBe(1);
    expect(await repo.countByOutletAndTime("out_other", "2030-01-01T10:00:00.000Z", 60)).toBe(0);
  });

  it("returns an array from listTables", async () => {
    const repo = new MemoryReservations();
    const tables = await repo.listTables("out_contract");
    expect(Array.isArray(tables)).toBe(true);
  });

  it("supports all declared reservation statuses", async () => {
    const statuses: ReservationStatus[] = ["PENDING", "CONFIRMED", "CANCELLED", "EXPIRED", "COMPLETED"];
    const repo = new MemoryReservations();
    for (const status of statuses) {
      await repo.save(record({ id: `rsv_${status}`, status }));
    }
    expect((await repo.listByOutlet("out_contract")).length).toBe(statuses.length);
  });
});
