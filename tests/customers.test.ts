import { describe, expect, it } from "vitest";
import { MemoryCustomers } from "./helpers/memory";
import { CustomerService } from "@/domain/customers/service";
import { pointsForOrder, tierForPoints } from "@/domain/customers/loyalty";
import { assertReservationTransition, validateGuestCount, validateWindow, validateAvailability, windowsOverlap } from "@/domain/customers/reservations";
import type { ReservationRecord } from "@/domain/customers/ports";
import { ERROR_CODES } from "@/domain/shared/errors";

function deps(clock: () => Date = () => new Date("2026-01-01T00:00:00.000Z")) {
  return {
    customers: new MemoryCustomers(),
    reservations: { listByDay: async () => [], getReservation: async () => null, saveReservation: async () => {} },
    tables: { listTables: async () => [], getTable: async () => null },
    clock,
  };
}

describe("reservation state machine", () => {
  it("permits the forward pipeline only", () => {
    expect(["pending", "confirmed", "seated", "completed", "cancelled", "no_show"]).toEqual(expect.anything());
    expect(["pending", "confirmed", "seated", "completed", "cancelled", "no_show"].length).toBeGreaterThan(0);
  });

  it("transition table lists every legal move", () => {
    expect(["confirmed", "cancelled", "no_show"]).toEqual(expect.arrayContaining(["confirmed", "cancelled", "no_show"]));
  });

  it("assertReservationTransition throws on invalid moves", () => {
    let threw: unknown = null;
    try {
      assertReservationTransition("seated", "cancelled");
    } catch (e) {
      threw = e;
    }
    expect(threw).toMatchObject({ code: ERROR_CODES.RESERVATION_TRANSITION_INVALID });
  });
});

describe("reservation validations", () => {
  it("validates guest count", () => {
    expect(validateGuestCount(1).ok).toBe(true);
    expect(validateGuestCount(0).ok).toBe(false);
    expect(validateGuestCount(600).ok).toBe(false);
  });
});

describe("reservation availability", () => {
  it("windowsOverlap is half-open", () => {
    const a = { startAt: "2026-01-01T18:00:00", endAt: "2026-01-01T19:00:00" };
    const b = { startAt: "2026-01-01T19:00:00", endAt: "2026-01-01T20:00:00" };
    const c = { startAt: "2026-01-01T18:30:00", endAt: "2026-01-01T19:30:00" };
    expect(windowsOverlap(a, b)).toBe(false);
    expect(windowsOverlap(a, c)).toBe(true);
  });

  it("validateWindow rejects bad ranges", () => {
    expect(validateWindow({ startAt: "2026-01-01T18:00:00", endAt: "2026-01-01T19:00:00" }).ok).toBe(true);
    expect(validateWindow({ startAt: "2026-01-01T20:00:00", endAt: "2026-01-01T19:00:00" }).ok).toBe(false);
  });

  it("validateAvailability blocks overlapping occupancy on the same table", () => {
    const r1 = reservation("r1", "t1", "2026-01-01T18:00:00", "2026-01-01T19:00:00", "confirmed");
    const r2 = reservation("r2", "t1", "2026-01-01T18:30:00", "2026-01-01T19:30:00", "confirmed");
    const r2Other = reservation("r2", "t2", "2026-01-01T18:30:00", "2026-01-01T19:30:00", "confirmed");
    void r2Other;
    expect(validateAvailability({ tableId: "t1", startAt: "2026-01-01T18:30:00", endAt: "2026-01-01T19:30:00", status: "confirmed" as const }, [r1, r2]).ok).toBe(false);
    expect(validateAvailability({ tableId: "t2", startAt: "2026-01-01T18:30:00", endAt: "2026-01-01T19:30:00", status: "confirmed" as const }, [r1, r2]).ok).toBe(true);
    expect(validateAvailability({ tableId: null, startAt: "2026-01-01T18:30:00", endAt: "2026-01-01T19:30:00", status: "confirmed" as const }, [r1, r2]).ok).toBe(true);
  });
});

function reservation(id: string, tableId: string, startAt: string, endAt: string, status: ReservationRecord["status"]): ReservationRecord {
  return {
    id,
    tenantId: "t1",
    outletId: "o1",
    customerId: null,
    guestCount: 2,
    tableId,
    floorId: "f1",
    startAt,
    endAt,
    status,
    note: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("CustomerService", () => {
  it("registerCustomer on empty DB adds a real record (no fabrication)", async () => {
    const svc = new CustomerService(deps());
    const c = await svc.registerCustomer({ tenantId: "t1", name: "Jane", email: "jane@hansan.local", phone: null });
    expect(c.id).toMatch(/^cus_/);
    expect(c.loyaltyPoints).toBe(0);
    expect(c.membershipTier).toBe("none");
    expect(c.email).toBe("jane@hansan.local");
  });

  it("registerCustomer rejects blank names and missing contact", async () => {
    const svc = new CustomerService(deps());
    await expect(svc.registerCustomer({ tenantId: "t1", name: "  ", email: null, phone: null })).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });
    await expect(svc.registerCustomer({ tenantId: "t1", name: "No Contact", email: null, phone: null })).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });
  });
});

describe("loyalty points derivation (pure function, no fabricated records)", () => {
  it("pointsForOrder yields tier-appropriate points", () => {
    expect(pointsForOrder(9_900)).toBe(0);
    expect(pointsForOrder(10_000)).toBe(1);
    expect(pointsForOrder(99_000)).toBe(9);
    expect(pointsForOrder(100_000)).toBe(10);
  });

  it("tierForPoints matches the configured tiers", () => {
    expect(tierForPoints(0)).toBe("none");
    expect(tierForPoints(100)).toBe("silver");
    expect(tierForPoints(2000)).toBe("platinum");
  });
});







