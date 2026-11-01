/**
 * In-memory reservation adapter for demo sandbox only.
 *
 * NOTE: prisma/schema.prisma currently has no Reservation model, so durable
 * production persistence is NOT available. Production runtimes therefore use
 * `UnavailableReservations`, which fails closed instead of pretending that a
 * process-local write succeeded.
 */
import { AppError, ERROR_CODES } from "@/domain/shared/errors";
import { PrismaClient, ReservationStatus as PrismaReservationStatus, DataScope as PrismaDataScope } from "@prisma/client";
import { pinTenantContext, persistencePinContext } from "@/server/db/tenant-context";
import type { ReservationPort, ReservationRecord, ReservationStatus } from "@/domain/reservations/service";
import type { TenantScope } from "@/domain/shared/tenant-scope";

function asPinTx(tx: unknown): Parameters<typeof pinTenantContext>[0] {
  return tx as Parameters<typeof pinTenantContext>[0];
}

export class MemoryReservations implements ReservationPort {
  private reservations = new Map<string, ReservationRecord>();

  async findById(id: string, scope: TenantScope): Promise<ReservationRecord | null> {
    const r = this.reservations.get(id);
    if (!r) return null;
    if (r.tenantId !== scope.organizationId) return null;
    return r;
  }

  async save(reservation: ReservationRecord): Promise<void> {
    this.reservations.set(reservation.id, reservation);
  }

  async listByOutlet(outletId: string, options?: { limit?: number; sinceIso?: string; status?: ReservationStatus }): Promise<ReservationRecord[]> {
    return Array.from(this.reservations.values())
      .filter(r => r.outletId === outletId)
      .filter(r => !options?.status || r.status === options.status)
      .filter(r => !options?.sinceIso || r.createdAt >= options.sinceIso)
      .slice(0, options?.limit ?? 100);
  }

  async listByTenant(tenantId: string, options?: { limit?: number; sinceIso?: string; status?: ReservationStatus }): Promise<ReservationRecord[]> {
    return Array.from(this.reservations.values())
      .filter(r => r.tenantId === tenantId)
      .filter(r => !options?.status || r.status === options.status)
      .filter(r => !options?.sinceIso || r.createdAt >= options.sinceIso)
      .slice(0, options?.limit ?? 100);
  }

  async countByOutletAndTime(outletId: string, reservationAt: string, durationMinutes: number): Promise<number> {
    // Occupying statuses in the Phase C2 lifecycle (analogous to the
    // OCCUPYING_STATUSES rule in src/domain/customers/reservations.ts).
    const OCCUPYING_STATUSES = new Set<ReservationStatus>(['PENDING', 'CONFIRMED']);

    const requestedStart = Date.parse(reservationAt);
    if (Number.isNaN(requestedStart)) return 0;
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return 0;
    const requestedEnd = requestedStart + durationMinutes * 60 * 1000;

    return Array.from(this.reservations.values())
      .filter((r) => r.outletId === outletId)
      .filter((r) => {
        if (!OCCUPYING_STATUSES.has(r.status)) return false;
        const existingStart = Date.parse(r.reservationAt);
        if (Number.isNaN(existingStart)) return false;
        if (!Number.isFinite(r.durationMinutes) || r.durationMinutes <= 0) return false;
        const existingEnd = existingStart + r.durationMinutes * 60 * 1000;
        // Half-open interval overlap: [existingStart, existingEnd) intersects
        // [requestedStart, requestedEnd).
        return existingStart < requestedEnd && existingEnd > requestedStart;
      }).length;
  }

  async listTables(_outletId: string): Promise<{ id: string; name: string; capacity: number; area?: string }[]> {
    void _outletId;
    return [];
  }
}

/**
 * Fail-closed reservation port for production. There is no durable
 * Reservation model/migration yet, so accepting a write here would be a
 * non-durable success. Every operation throws PERSISTENCE_NOT_CONFIGURED.
 */
export class UnavailableReservations implements ReservationPort {
  private fail(): never {
    throw new AppError(ERROR_CODES.PERSISTENCE_NOT_CONFIGURED, {
      message: "Reservation persistence is not configured on this deployment",
    });
  }

  async findById(_id: string, _scope: TenantScope): Promise<ReservationRecord | null> {
    void _id;
    void _scope;
    this.fail();
  }

  async save(_reservation: ReservationRecord): Promise<void> {
    void _reservation;
    this.fail();
  }

  async listByOutlet(
    _outletId: string,
    _options?: { limit?: number; sinceIso?: string; status?: ReservationStatus },
  ): Promise<ReservationRecord[]> {
    void _outletId;
    void _options;
    this.fail();
  }

  async listByTenant(
    _tenantId: string,
    _options?: { limit?: number; sinceIso?: string; status?: ReservationStatus },
  ): Promise<ReservationRecord[]> {
    void _tenantId;
    void _options;
    this.fail();
  }

  async countByOutletAndTime(
    _outletId: string,
    _reservationAt: string,
    _durationMinutes: number,
  ): Promise<number> {
    void _outletId;
    void _reservationAt;
    void _durationMinutes;
    this.fail();
  }

  async listTables(_outletId: string): Promise<{ id: string; name: string; capacity: number; area?: string }[]> {
    void _outletId;
    this.fail();
  }
}

export class PrismaReservations implements ReservationPort {
  constructor(private readonly db: PrismaClient) {}

  private toRecord(row: unknown): ReservationRecord {
    const r = row as Record<string, unknown>;
    return {
      id: r.id as string,
      tenantId: r.organizationId as string,
      outletId: r.outletId as string,
      dataScope: r.dataScope as "DEMO" | "PRODUCTION",
      customerName: r.customerName as string,
      customerEmail: r.customerEmail as string,
      customerPhone: r.customerPhone as string,
      partySize: r.partySize as number,
      reservationAt: (r.reservationAt as Date).toISOString(),
      durationMinutes: r.durationMinutes as number,
      status: r.status as ReservationStatus,
      tableId: (r.tableId as string | null) ?? undefined,
      area: (r.area as string | null) ?? undefined,
      notes: (r.notes as string | null) ?? undefined,
      createdBy: r.createdBy as string,
      createdAt: (r.createdAt as Date).toISOString(),
      updatedAt: (r.updatedAt as Date).toISOString(),
    };
  }

  private async resolveOrganizationForOutlet(outletId: string): Promise<string> {
    const outlet = await this.db.outlet.findUnique({
      where: { id: outletId },
      select: { organizationId: true },
    });
    if (!outlet) {
      throw new AppError(ERROR_CODES.OUTLET_MISMATCH, { message: "Unknown outlet" });
    }
    return outlet.organizationId;
  }

  async findById(id: string, scope: TenantScope): Promise<ReservationRecord | null> {
    return this.db.$transaction(async (tx) => {
      await pinTenantContext(asPinTx(tx), persistencePinContext(scope.organizationId, scope.outletId ?? null));
      const row = await tx.reservation.findUnique({
        where: {
          id,
          organizationId: scope.organizationId,
          ...(scope.outletId ? { outletId: scope.outletId } : {}),
        },
      });
      return row ? this.toRecord(row) : null;
    });
  }

  async save(reservation: ReservationRecord): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await pinTenantContext(asPinTx(tx), persistencePinContext(reservation.tenantId, reservation.outletId));
      const existing = await tx.reservation.findUnique({
        where: { id: reservation.id },
        select: { organizationId: true },
      });
      if (existing && existing.organizationId !== reservation.tenantId) {
        throw new AppError(ERROR_CODES.TENANT_MISMATCH, { message: "Cross-tenant reservation write denied" });
      }
      const data = {
        organizationId: reservation.tenantId,
        outletId: reservation.outletId,
        dataScope: (reservation.dataScope ?? "PRODUCTION") as PrismaDataScope,
        customerName: reservation.customerName,
        customerEmail: reservation.customerEmail,
        customerPhone: reservation.customerPhone,
        partySize: reservation.partySize,
        reservationAt: new Date(reservation.reservationAt),
        durationMinutes: reservation.durationMinutes,
        status: reservation.status as PrismaReservationStatus,
        tableId: reservation.tableId ?? null,
        area: reservation.area ?? null,
        notes: reservation.notes ?? null,
        createdBy: reservation.createdBy,
        updatedAt: new Date(reservation.updatedAt),
      };
      await tx.reservation.upsert({
        where: { id: reservation.id },
        create: { id: reservation.id, createdAt: new Date(reservation.createdAt), ...data },
        update: data,
      });
    });
  }

  async listByOutlet(
    outletId: string,
    options?: { limit?: number; sinceIso?: string; status?: ReservationStatus },
  ): Promise<ReservationRecord[]> {
    const organizationId = await this.resolveOrganizationForOutlet(outletId);
    return this.db.$transaction(async (tx) => {
      await pinTenantContext(asPinTx(tx), persistencePinContext(organizationId, outletId));
      const rows = await tx.reservation.findMany({
        where: {
          outletId,
          ...(options?.status ? { status: options.status } : {}),
          ...(options?.sinceIso ? { createdAt: { gte: new Date(options.sinceIso) } } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: options?.limit ?? 100,
      });
      return rows.map((r) => this.toRecord(r));
    });
  }

  async listByTenant(
    tenantId: string,
    options?: { limit?: number; sinceIso?: string; status?: ReservationStatus },
  ): Promise<ReservationRecord[]> {
    return this.db.$transaction(async (tx) => {
      await pinTenantContext(asPinTx(tx), persistencePinContext(tenantId, null));
      const rows = await tx.reservation.findMany({
        where: {
          organizationId: tenantId,
          ...(options?.status ? { status: options.status } : {}),
          ...(options?.sinceIso ? { createdAt: { gte: new Date(options.sinceIso) } } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: options?.limit ?? 100,
      });
      return rows.map((r) => this.toRecord(r));
    });
  }

  async countByOutletAndTime(outletId: string, reservationAt: string, durationMinutes: number): Promise<number> {
    const OCCUPYING_STATUSES = new Set<ReservationStatus>(["PENDING", "CONFIRMED"]);
    const requestedStart = Date.parse(reservationAt);
    if (Number.isNaN(requestedStart)) return 0;
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return 0;
    const requestedEnd = requestedStart + durationMinutes * 60 * 1000;

    const organizationId = await this.resolveOrganizationForOutlet(outletId);
    return this.db.$transaction(async (tx) => {
      await pinTenantContext(asPinTx(tx), persistencePinContext(organizationId, outletId));
      const rows = await tx.reservation.findMany({
        where: { outletId, status: { in: ["PENDING", "CONFIRMED"] } },
      });
      return rows.filter((r) => {
        if (!OCCUPYING_STATUSES.has(r.status as ReservationStatus)) return false;
        const existingStart = (r.reservationAt as Date).getTime();
        if (Number.isNaN(existingStart)) return false;
        const dur = r.durationMinutes as number;
        if (!Number.isFinite(dur) || dur <= 0) return false;
        const existingEnd = existingStart + dur * 60 * 1000;
        return existingStart < requestedEnd && existingEnd > requestedStart;
      }).length;
    });
  }

  async listTables(_outletId: string): Promise<{ id: string; name: string; capacity: number; area?: string }[]> {
    void _outletId;
    return [];
  }
}
