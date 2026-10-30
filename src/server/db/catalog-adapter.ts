/** Prisma adapter for CatalogPort (Phase 4) — server-authoritative prices. */
import type { PrismaClient } from "@prisma/client";
import type { CatalogPort, ProductRecord } from "@/domain/shared/ports";
import { pinTenantContext, persistencePinContext } from "@/server/db/tenant-context";

/** Cast a Prisma interactive-transaction client to the shape pinTenantContext expects. */
function asPinTx(tx: unknown): Parameters<typeof pinTenantContext>[0] {
  return tx as Parameters<typeof pinTenantContext>[0];
}

function toProduct(row: {
  id: string;
  organizationId: string;
  categoryId: string;
  name: string;
  priceIdr: bigint;
  station: string;
  active: boolean;
  createdAt: Date;
}): ProductRecord {
  return {
    id: row.id,
    tenantId: row.organizationId,
    categoryId: row.categoryId,
    name: row.name,
    priceIdr: Number(row.priceIdr),
    station: row.station.toLowerCase() as "kitchen" | "bar",
    active: row.active,
    createdAt: row.createdAt.toISOString(),
  };
}

export class PrismaCatalog implements CatalogPort {
  constructor(private readonly db: PrismaClient) {}

  /**
   * Scoped read (Phase 8 + 11/12). `scope` is REQUIRED: tenant GUCs are pinned
   * inside the transaction and `organizationId` is enforced at the query
   * boundary — a cross-tenant id resolves to null without leaking existence.
   * No unscoped fallback exists by design.
   */
  async findById(id: string, scope: { organizationId: string }): Promise<ProductRecord | null> {
    return this.db.$transaction(async (tx) => {
      await pinTenantContext(asPinTx(tx), persistencePinContext(scope.organizationId, null));
      const row = await tx.menuItem.findFirst({ where: { id, organizationId: scope.organizationId } });
      return row ? toProduct(row) : null;
    });
  }

  async listActive(tenantId: string): Promise<ProductRecord[]> {
    // Phase 11 — tenant-wide read pins the organization GUC ( __none__ outlet ).
    return this.db.$transaction(async (tx) => {
      await pinTenantContext(asPinTx(tx), persistencePinContext(tenantId, null));
      const rows = await tx.menuItem.findMany({
        where: { organizationId: tenantId, active: true },
        orderBy: [{ createdAt: "asc" }],
      });
      return rows.map(toProduct);
    });
  }
}
