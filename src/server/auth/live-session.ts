/**
 * Live session issuance + membership gating (Phase B2).
 *
 * Supabase Auth is the IDENTITY authority; Prisma `User`/`Membership` are the
 * TENANT/ROLE/OUTLET authority. A HANSAN `mode:"live"` session is issued ONLY
 * after BOTH are satisfied:
 *
 *   1. A trusted server-side Supabase `getUser()` returns a real identity
 *      (never a client-submitted id/role/tenant/outlet, never a raw JWT).
 *   2. That identity maps to an active `User` (via unique `authSubject`) with
 *      at least one active `Membership` whose Organization (and any referenced
 *      Outlet) are active and belong to the SAME organization.
 *
 * tenantId / role / outletIds are derived EXCLUSIVELY from verified database
 * rows. Multiple memberships are resolved deterministically; anything the
 * single-tenant, single-role session model cannot safely represent fails closed
 * (MEMBERSHIP_AMBIGUOUS) — see "Unresolved design decisions" in the report.
 *
 * Demo sessions never reach this module: `runtimeFor()` routes them to the
 * in-memory sandbox before any Prisma access.
 */
import "server-only";
import { AppError, ERROR_CODES } from "@/domain/shared/errors";
import type { DevRole } from "@/types/roles";
import { createLiveSession, signSession, type SessionPayload } from "@/server/session";

/** Business role carried by a Membership row (platform `developer` is never a membership). */
type OrgRoleValue = "OWNER" | "POS" | "KDS" | "FINANCE";

/** OrgRole -> business DevRole. `developer` is intentionally absent (platform-only). */
const ORG_ROLE_TO_DEV_ROLE: Readonly<Record<OrgRoleValue, DevRole>> = {
  OWNER: "owner",
  POS: "pos",
  KDS: "kds",
  FINANCE: "finance",
};

// --- Narrow structural DB port (only the queries this service performs) -----
// The real PrismaClient satisfies this; tests pass a plain object. Keeping the
// service decoupled from Prisma's generated generics makes it trivially testable
// and documents the exact persistence surface it depends on.

export interface LiveSessionUserRow {
  id: string;
  email: string;
  active: boolean;
}

export interface LiveSessionMembershipRow {
  organizationId: string;
  role: OrgRoleValue;
  outletId: string | null;
  organization: { id: string; active: boolean };
  outlet: { id: string; organizationId: string; active: boolean } | null;
}

export interface LiveSessionOutletRow {
  id: string;
}

export interface LiveSessionDb {
  user: {
    findUnique(args: { where: { authSubject: string } }): Promise<LiveSessionUserRow | null>;
  };
  membership: {
    findMany(args: {
      where: { userId: string; active: true };
      include: { organization: true; outlet: true };
    }): Promise<LiveSessionMembershipRow[]>;
  };
  outlet: {
    findMany(args: { where: { organizationId: string; active: true } }): Promise<LiveSessionOutletRow[]>;
  };
}

export interface MembershipResolution {
  /** HANSAN User.id (becomes session.sub / actor id — NOT the Supabase sub). */
  userId: string;
  /** Authoritative email from the HANSAN User record. */
  email: string;
  /** Single resolved business role. */
  role: DevRole;
  /** Organization.id (single tenant). */
  tenantId: string;
  /** Deterministically ordered, deduplicated active outlet ids. */
  outletIds: string[];
}

/**
 * Resolve the acting tenant/role/outlets for a VERIFIED Supabase identity.
 * Throws a non-sensitive AppError (fail-closed) on every unmet requirement.
 */
export async function resolveLiveActor(
  db: LiveSessionDb,
  authSubject: string,
): Promise<MembershipResolution> {
  const user = await db.user.findUnique({ where: { authSubject } });
  if (!user) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, {
      message: "No HANSAN account is linked to this identity",
    });
  }
  if (!user.active) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, { message: "This account is disabled" });
  }

  const memberships = await db.membership.findMany({
    where: { userId: user.id, active: true },
    include: { organization: true, outlet: true },
  });
  if (memberships.length === 0) {
    // No membership => no default privileges (never Owner/Developer).
    throw new AppError(ERROR_CODES.FORBIDDEN, { message: "No active organization membership" });
  }

  // --- Tenant: exactly one organization is representable in a single-tenant session.
  const tenantIds = new Set(memberships.map((m) => m.organizationId));
  if (tenantIds.size > 1) {
    throw new AppError(ERROR_CODES.MEMBERSHIP_AMBIGUOUS, {
      message: "Identity belongs to multiple organizations",
    });
  }
  const tenantId = memberships[0]!.organizationId;

  // --- Organization must be active.
  if (!memberships.every((m) => m.organization.active)) {
    throw new AppError(ERROR_CODES.FORBIDDEN, { message: "Organization is not active" });
  }

  // --- Role: exactly one distinct business role (no silent role merge).
  const roleValues = new Set(memberships.map((m) => m.role));
  if (roleValues.size > 1) {
    throw new AppError(ERROR_CODES.MEMBERSHIP_AMBIGUOUS, {
      message: "Identity holds multiple roles; the session model supports a single role",
    });
  }
  const role = ORG_ROLE_TO_DEV_ROLE[memberships[0]!.role];

  // --- Outlets: null outletId => all outlets of the org; otherwise the granted set.
  const allOutletAccess = memberships.some((m) => m.outletId === null);
  let outletIds: string[];
  if (allOutletAccess) {
    const outlets = await db.outlet.findMany({ where: { organizationId: tenantId, active: true } });
    outletIds = outlets.map((o) => o.id).sort();
  } else {
    const granted = new Set<string>();
    for (const m of memberships) {
      const outlet = m.outlet;
      // Referenced outlet must exist, be active, and belong to the SAME org.
      if (!outlet || !outlet.active || outlet.organizationId !== tenantId) {
        throw new AppError(ERROR_CODES.OUTLET_MISMATCH, {
          message: "Membership references an inactive or mismatched outlet",
        });
      }
      granted.add(outlet.id);
    }
    outletIds = Array.from(granted).sort();
  }

  // Roles that operate at an outlet must have at least one active outlet.
  if (outletIds.length === 0 && role !== "owner" && role !== "finance") {
    throw new AppError(ERROR_CODES.OUTLET_MISMATCH, {
      message: "No active outlet assigned for this role",
    });
  }

  return { userId: user.id, email: user.email, role, tenantId, outletIds };
}

export interface VerifiedIdentity {
  /** Verified Supabase Auth user id (maps to User.authSubject). */
  id: string;
  email: string | null;
}

export interface LiveSessionConfig {
  db: LiveSessionDb;
  /** Trusted server-side identity resolver (Supabase `auth.getUser()`). */
  getUser: () => Promise<VerifiedIdentity | null>;
  /** HANSAN session signing secret; null => fail closed (503). */
  secret: string | null;
  now?: () => Date;
}

export interface IssuedLiveSession {
  payload: SessionPayload;
  token: string;
}

/**
 * Full issuance path: verify identity -> resolve membership -> sign a live
 * session. Fails closed (never issues a token) unless every check passes.
 */
export async function establishLiveSession(
  config: LiveSessionConfig,
): Promise<IssuedLiveSession> {
  if (!config.secret) {
    throw new AppError(ERROR_CODES.AUTH_NOT_CONFIGURED, {
      message: "Session signing is not configured on this deployment",
    });
  }

  const identity = await config.getUser();
  if (!identity) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, { message: "Authentication required" });
  }

  const resolved = await resolveLiveActor(config.db, identity.id);

  const payload = createLiveSession({
    userId: resolved.userId,
    role: resolved.role,
    email: resolved.email,
    tenantId: resolved.tenantId,
    outletIds: resolved.outletIds,
    now: config.now?.(),
  });

  const token = await signSession(payload, config.secret);
  if (!token) {
    throw new AppError(ERROR_CODES.AUTH_NOT_CONFIGURED, { message: "Session signing failed" });
  }

  return { payload, token };
}

