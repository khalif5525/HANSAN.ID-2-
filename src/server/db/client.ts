/**
 * Prisma client singleton (Phase 2/4). Created lazily ONLY when
 * DATABASE_URL exists; never imported at module scope in request paths
 * that must work without a database. The service-role key is never
 * exposed to the browser (this module is server-only by import graph).
 */
import { PrismaClient } from "@prisma/client";
import { hasDatabase } from "@/config/environment";
import { AppError, ERROR_CODES } from "@/domain/shared/errors";
import { PrismaOrders } from "@/server/db/orders-adapter";
import { PrismaCatalog } from "@/server/db/catalog-adapter";
import { PrismaAudit } from "@/server/db/audit-adapter";
import { PrismaIdempotency } from "@/server/db/idempotency-adapter";

// Prisma recommends a single client per process (serverless-safe via cache).
const globalForPrisma = globalThis as unknown as { __hansanPrisma?: PrismaClient };

export function getPrisma(): PrismaClient | null {
  if (!hasDatabase()) return null;
  if (!globalForPrisma.__hansanPrisma) {
    globalForPrisma.__hansanPrisma = new PrismaClient({ log: ["warn", "error"] });
  }
  return globalForPrisma.__hansanPrisma;
}

/**
 * Fail-closed adapter factories: when DATABASE_URL is missing these throw
 * PERSISTENCE_NOT_CONFIGURED (503) instead of silently falling back to a
 * non-persistent store. Business mutations must never pretend to succeed.
 */
export function requirePrismaOrders(): PrismaOrders {
  const db = getPrisma();
  if (!db) throw new AppError(ERROR_CODES.PERSISTENCE_NOT_CONFIGURED, { message: "DATABASE_URL is not configured" });
  return new PrismaOrders(db);
}

export function requirePrismaCatalog(): PrismaCatalog {
  const db = getPrisma();
  if (!db) throw new AppError(ERROR_CODES.PERSISTENCE_NOT_CONFIGURED, { message: "DATABASE_URL is not configured" });
  return new PrismaCatalog(db);
}

export function requirePrismaAudit(): PrismaAudit {
  const db = getPrisma();
  if (!db) throw new AppError(ERROR_CODES.PERSISTENCE_NOT_CONFIGURED, { message: "DATABASE_URL is not configured" });
  return new PrismaAudit(db);
}

export function requirePrismaIdempotency(): PrismaIdempotency {
  const db = getPrisma();
  if (!db) throw new AppError(ERROR_CODES.PERSISTENCE_NOT_CONFIGURED, { message: "DATABASE_URL is not configured" });
  return new PrismaIdempotency(db);
}
