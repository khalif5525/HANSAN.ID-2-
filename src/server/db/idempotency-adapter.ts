/** Prisma adapter for IdempotencyPort (Phase 4). Backed by the unique
 * (organizationId, scope, key) constraint so concurrent duplicates cannot
 * both start. */
import type { PrismaClient } from "@prisma/client";
import { DEFAULT_IDEMPOTENCY_TTL_SECONDS, type BeginResult, type IdempotencyPort } from "@/server/idempotency";

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

interface KeyParts {
  organizationId: string;
  scope: string;
  key: string;
}

export class PrismaIdempotency implements IdempotencyPort {
  constructor(private readonly db: PrismaClient) {}

  private where(p: KeyParts) {
    return { organizationId_scope_key: { organizationId: p.organizationId, scope: p.scope, key: p.key } };
  }

  async begin(params: KeyParts & { requestHash: string; ttlSeconds?: number }): Promise<BeginResult> {
    const expiresAt = new Date(Date.now() + (params.ttlSeconds ?? DEFAULT_IDEMPOTENCY_TTL_SECONDS) * 1000);
    const data = {
      organizationId: params.organizationId,
      scope: params.scope,
      key: params.key,
      requestHash: params.requestHash,
      status: "in_progress",
      expiresAt,
    };
    const create = async (): Promise<BeginResult> => {
      const row = await this.db.idempotencyRecord.create({ data });
      return { status: "started", recordId: row.id };
    };
    try {
      return await create();
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
    const existing = await this.db.idempotencyRecord.findUnique({ where: this.where(params) });
    if (!existing) {
      try {
        return await create();
      } catch {
        return { status: "conflict" };
      }
    }
    // Expired claim: reclaim it.
    if (existing.expiresAt.getTime() <= Date.now()) {
      await this.db.idempotencyRecord.delete({ where: { id: existing.id } }).catch(() => {});
      try {
        return await create();
      } catch {
        return { status: "conflict" };
      }
    }
    if (existing.requestHash !== params.requestHash) return { status: "conflict" };
    if (existing.status === "completed") {
      return { status: "replay", response: existing.responseJson ? JSON.parse(existing.responseJson) : null };
    }
    return { status: "conflict" };
  }

  async complete(params: KeyParts & { response: unknown }): Promise<void> {
    await this.db.idempotencyRecord
      .update({
        where: this.where(params),
        data: { status: "completed", responseJson: JSON.stringify(params.response) },
      })
      .catch(() => {});
  }

  async fail(params: KeyParts): Promise<void> {
    const existing = await this.db.idempotencyRecord.findUnique({ where: this.where(params) });
    // Only release in_progress claims. A completed claim MUST remain — a retry
    // on a completed claim must replay (not re-execute) to prevent duplicates.
    if (existing && existing.status !== 'completed') {
      await this.db.idempotencyRecord.delete({ where: this.where(params) }).catch(() => {});
    }
  }

  async get(params: KeyParts): Promise<unknown | null> {
    const existing = await this.db.idempotencyRecord.findUnique({ where: this.where(params) });
    if (existing && existing.status === 'completed') {
      return existing.responseJson ? JSON.parse(existing.responseJson) : null;
    }
    return null;
  }
}
