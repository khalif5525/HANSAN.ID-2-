/**
 * Reservation service (Phase C2) — customer-facing table reservations.
 */
import { AppError, ERROR_CODES } from '@/domain/shared/errors';
import { createId } from '@/domain/shared/ids';
import { AUDIT_ACTIONS, type AuditLogPort } from '@/domain/audit/events';
import type { TenantScope } from '@/domain/shared/tenant-scope';

export type ReservationStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED' | 'COMPLETED';

export interface ReservationRecord {
  id: string;
  tenantId: string;
  outletId: string;
  dataScope?: 'DEMO' | 'PRODUCTION';
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  partySize: number;
  reservationAt: string;
  durationMinutes: number;
  status: ReservationStatus;
  tableId?: string;
  area?: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReservationPort {
  findById(id: string, scope: TenantScope): Promise<ReservationRecord | null>;
  save(reservation: ReservationRecord): Promise<void>;
  listByOutlet(outletId: string, options?: { limit?: number; sinceIso?: string; status?: ReservationStatus }): Promise<ReservationRecord[]>;
  listByTenant(tenantId: string, options?: { limit?: number; sinceIso?: string; status?: ReservationStatus }): Promise<ReservationRecord[]>;
  countByOutletAndTime(outletId: string, reservationAt: string, durationMinutes: number): Promise<number>;
  listTables(outletId: string): Promise<{ id: string; name: string; capacity: number; area?: string }[]>;
}

export interface ReservationServiceDeps {
  reservations: ReservationPort;
  audit: AuditLogPort;
  clock: () => Date;
}

export class ReservationService {
  constructor(private readonly deps: ReservationServiceDeps) {}

  async createReservation(params: {
    tenantId: string;
    outletId: string;
    actorId: string;
    customerName: string;
    customerEmail: string;
    customerPhone: string;
    partySize: number;
    reservationAt: string;
    durationMinutes?: number;
    tableId?: string;
    area?: string;
    notes?: string;
    idempotencyKey: string;
  }): Promise<ReservationRecord> {
    const {
      tenantId, outletId, actorId, customerName, customerEmail, customerPhone,
      partySize, reservationAt, durationMinutes = 60, tableId, area, notes,
    } = params;

    if (partySize < 1 || partySize > 20) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, { message: 'Party size must be between 1 and 20' });
    }

    const resAt = new Date(reservationAt);
    if (Number.isNaN(resAt.getTime())) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, { message: 'Invalid reservation time' });
    }
    if (resAt.getTime() <= Date.now()) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, { message: 'Reservation must be in the future' });
    }

    const count = await this.deps.reservations.countByOutletAndTime(
      outletId, reservationAt, durationMinutes,
    );
    const tables = await this.deps.reservations.listTables(outletId);
    if (tables.length > 0 && count >= tables.length) {
      throw new AppError(ERROR_CODES.SLOT_UNAVAILABLE, { message: 'No tables available for this time slot' });
    }

    let assignedTableId: string | undefined;
    if (tableId) {
      const suggested = tables.find((t) => t.id === tableId && t.capacity >= partySize);
      if (suggested) assignedTableId = tableId;
    }
    if (!assignedTableId) {
      const fit = tables.find((t) => t.capacity >= partySize);
      if (fit) assignedTableId = fit.id;
    }

    const reservation: ReservationRecord = {
      id: createId('rsv'),
      tenantId,
      outletId,
      customerName: customerName.trim(),
      customerEmail: customerEmail.trim().toLowerCase(),
      customerPhone: customerPhone.trim(),
      partySize,
      reservationAt: resAt.toISOString(),
      durationMinutes,
      status: 'CONFIRMED',
      tableId: assignedTableId,
      area,
      notes: notes?.trim(),
      createdBy: actorId,
      createdAt: this.deps.clock().toISOString(),
      updatedAt: this.deps.clock().toISOString(),
    };
    await this.deps.reservations.save(reservation);

    await this.deps.audit.record({
      id: createId('aud'),
      action: AUDIT_ACTIONS.ORDER_CREATED,
      actorId,
      actorRole: 'system',
      entityType: 'reservation',
      entityId: reservation.id,
      tenantId,
      outletId,
      occurredAt: reservation.createdAt,
      metadata: {
        customerName: reservation.customerName,
        partySize,
        reservationAt: reservation.reservationAt,
        tableId: assignedTableId || '',
        channel: 'customer',
      },
    });

    return reservation;
  }

  async cancelReservation(params: {
    id: string;
    scope: TenantScope;
    actorId: string;
    reason?: string;
  }): Promise<ReservationRecord> {
    const { id, scope, actorId, reason } = params;
    const reservation = await this.deps.reservations.findById(id, scope);
    if (!reservation) {
      throw new AppError(ERROR_CODES.NOT_FOUND, { message: 'Reservation not found' });
    }
    if (reservation.status === 'CANCELLED' || reservation.status === 'COMPLETED' || reservation.status === 'EXPIRED') {
      throw new AppError(ERROR_CODES.RESERVATION_TRANSITION_INVALID, {
        message: 'Cannot cancel a ' + reservation.status + ' reservation',
      });
    }

    const updated: ReservationRecord = {
      ...reservation,
      status: 'CANCELLED',
      updatedAt: this.deps.clock().toISOString(),
      ...(reason ? { notes: (reservation.notes ? reservation.notes + ' | ' : '') + 'Cancelled: ' + reason } : {}),
    };
    await this.deps.reservations.save(updated);

    await this.deps.audit.record({
      id: createId('aud'),
      action: AUDIT_ACTIONS.ORDER_CANCELLED,
      actorId,
      actorRole: 'system',
      entityType: 'reservation',
      entityId: id,
      tenantId: reservation.tenantId,
      outletId: reservation.outletId,
      occurredAt: updated.updatedAt,
      metadata: { previousStatus: reservation.status, reason: reason || '' },
    });

    return updated;
  }

  async completeReservation(params: {
    id: string;
    scope: TenantScope;
    actorId: string;
  }): Promise<ReservationRecord> {
    const { id, scope } = params;
    const reservation = await this.deps.reservations.findById(id, scope);
    if (!reservation) {
      throw new AppError(ERROR_CODES.NOT_FOUND, { message: 'Reservation not found' });
    }
    if (reservation.status !== 'CONFIRMED') {
      throw new AppError(ERROR_CODES.RESERVATION_TRANSITION_INVALID, {
        message: 'Only CONFIRMED reservations can be completed, current: ' + reservation.status,
      });
    }

    const updated: ReservationRecord = {
      ...reservation,
      status: 'COMPLETED',
      updatedAt: this.deps.clock().toISOString(),
    };
    await this.deps.reservations.save(updated);
    return updated;
  }
}
