import { describe, expect, it } from "vitest";
import { MemoryReservations } from "@/server/db/reservation-adapter";
import type { ReservationRecord } from "@/domain/reservations/service";

function record(overrides: Partial<ReservationRecord> = {}): ReservationRecord {
  return {
    id: "rsv_1",
    tenantId: "ten_demo",
    outletId: "out_demo",
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

describe("MemoryReservations.countByOutletAndTime overlap", () => {
  it("counts an exactly overlapping reservation", async () => {
    const repo = new MemoryReservations();
    await repo.save(record());
    expect(await repo.countByOutletAndTime("out_demo", "2030-01-01T10:00:00.000Z", 60)).toBe(1);
  });

  it("does not count a reservation entirely before the requested interval", async () => {
    const repo = new MemoryReservations();
    await repo.save(record({ reservationAt: "2030-01-01T08:00:00.000Z", durationMinutes: 60 }));
    expect(await repo.countByOutletAndTime("out_demo", "2030-01-01T10:00:00.000Z", 60)).toBe(0);
  });

  it("does not count a reservation entirely after the requested interval", async () => {
    const repo = new MemoryReservations();
    await repo.save(record({ reservationAt: "2030-01-01T12:00:00.000Z", durationMinutes: 60 }));
    expect(await repo.countByOutletAndTime("out_demo", "2030-01-01T10:00:00.000Z", 60)).toBe(0);
  });

  it("counts a partial overlap on the requested start boundary", async () => {
    const repo = new MemoryReservations();
    await repo.save(record({ reservationAt: "2030-01-01T09:30:00.000Z", durationMinutes: 60 }));
    expect(await repo.countByOutletAndTime("out_demo", "2030-01-01T10:00:00.000Z", 60)).toBe(1);
  });

  it("counts a partial overlap on the requested end boundary", async () => {
    const repo = new MemoryReservations();
    await repo.save(record({ reservationAt: "2030-01-01T10:30:00.000Z", durationMinutes: 60 }));
    expect(await repo.countByOutletAndTime("out_demo", "2030-01-01T10:00:00.000Z", 60)).toBe(1);
  });

  it("counts an existing interval that fully contains the requested interval", async () => {
    const repo = new MemoryReservations();
    await repo.save(record({ reservationAt: "2030-01-01T09:00:00.000Z", durationMinutes: 180 }));
    expect(await repo.countByOutletAndTime("out_demo", "2030-01-01T10:00:00.000Z", 60)).toBe(1);
  });
  it("counts a requested interval that fully contains an existing reservation", async () => {
    const repo = new MemoryReservations();
    await repo.save(record({ reservationAt: "2030-01-01T10:15:00.000Z", durationMinutes: 15 }));
    expect(await repo.countByOutletAndTime("out_demo", "2030-01-01T10:00:00.000Z", 60)).toBe(1);
  });

  it("does not count adjacent intervals sharing an endpoint (before)", async () => {
    const repo = new MemoryReservations();
    await repo.save(record({ reservationAt: "2030-01-01T09:00:00.000Z", durationMinutes: 60 }));
    expect(await repo.countByOutletAndTime("out_demo", "2030-01-01T10:00:00.000Z", 60)).toBe(0);
  });

  it("does not count adjacent intervals sharing an endpoint (after)", async () => {
    const repo = new MemoryReservations();
    await repo.save(record({ reservationAt: "2030-01-01T11:00:00.000Z", durationMinutes: 60 }));
    expect(await repo.countByOutletAndTime("out_demo", "2030-01-01T10:00:00.000Z", 60)).toBe(0);
  });

  it("ignores reservations for a different outlet", async () => {
    const repo = new MemoryReservations();
    await repo.save(record({ outletId: "out_other" }));
    expect(await repo.countByOutletAndTime("out_demo", "2030-01-01T10:00:00.000Z", 60)).toBe(0);
  });

  it("ignores reservations on a different date", async () => {
    const repo = new MemoryReservations();
    await repo.save(record({ reservationAt: "2030-01-02T10:00:00.000Z", durationMinutes: 60 }));
    expect(await repo.countByOutletAndTime("out_demo", "2030-01-01T10:00:00.000Z", 60)).toBe(0);
  });

  it("does not count non-occupying statuses", async () => {
    const repo = new MemoryReservations();
    for (const status of ["CANCELLED", "COMPLETED", "EXPIRED"] as const) {
      await repo.save(record({ id: `rsv_${status}`, status }));
    }
    expect(await repo.countByOutletAndTime("out_demo", "2030-01-01T10:00:00.000Z", 60)).toBe(0);
  });

  it("counts PENDING reservations as occupying", async () => {
    const repo = new MemoryReservations();
    await repo.save(record({ status: "PENDING" }));
    expect(await repo.countByOutletAndTime("out_demo", "2030-01-01T10:00:00.000Z", 60)).toBe(1);
  });

  it("returns 0 for an invalid requested time", async () => {
    const repo = new MemoryReservations();
    await repo.save(record());
    expect(await repo.countByOutletAndTime("out_demo", "not-a-date", 60)).toBe(0);
  });

  it("returns 0 for an invalid requested duration", async () => {
    const repo = new MemoryReservations();
    await repo.save(record());
    expect(await repo.countByOutletAndTime("out_demo", "2030-01-01T10:00:00.000Z", 0)).toBe(0);
    expect(await repo.countByOutletAndTime("out_demo", "2030-01-01T10:00:00.000Z", NaN)).toBe(0);
  });

  it("skips existing reservations with invalid time or duration", async () => {
    const repo = new MemoryReservations();
    await repo.save(record({ id: "rsv_bad_time", reservationAt: "not-a-date" }));
    await repo.save(record({ id: "rsv_bad_dur", durationMinutes: 0 }));
    expect(await repo.countByOutletAndTime("out_demo", "2030-01-01T10:00:00.000Z", 60)).toBe(0);
  });

  it("handles time-zone offsets consistently", async () => {
    const repo = new MemoryReservations();
    await repo.save(record({ reservationAt: "2030-01-01T10:00:00.000Z", durationMinutes: 60 }));
    expect(await repo.countByOutletAndTime("out_demo", "2030-01-01T11:00:00.000+01:00", 60)).toBe(1);
  });
});
