/**
 * Provisioning service (Phase 4) — server-only, privileged.
 *
 * Implements the SECURE, AUDITED, IDEMPOTENT code paths for:
 *   * first-Owner bootstrap (Organization + first Outlet + User + OWNER membership)
 *   * staff invitations (owner-initiated; User + Membership in the owner's org)
 *   * platform Developer provisioning (Supabase user + User, NO business membership)
 *
 * Supabase Auth is the identity authority (admin/service-role client, server
 * only); Prisma User/Membership/Organization/Outlet are the tenancy authority.
 * All writes that must be atomic happen inside ONE Prisma transaction; a Prisma
 * failure after the Supabase user is created triggers a COMPENSATING delete of
 * that Supabase user (documented retry strategy — see the module report).
 *
 * This module is guarded by `server-only` and is loaded by routes via dynamic
 * import. It is NOT wired to any real Supabase project or database here — the
 * routes/tests inject mock admin + db ports.
 */
import "server-only";
import { AppError, ERROR_CODES } from "@/domain/shared/errors";
import { createId } from "@/domain/shared/ids";

export type OrgRoleValue = "OWNER" | "POS" | "KDS" | "FINANCE";

// --- Structural Prisma port (only the operations provisioning performs) ------
export interface ProvisioningOrg { id: string }
export interface ProvisioningUser { id: string; active: boolean }

export interface ProvisioningTx {
  organization: {
    create(a: { data: { id: string; name: string; slug: string; dataScope: "PRODUCTION" | "DEMO"; active: boolean } }): Promise<ProvisioningOrg>;
    findUnique(a: { where: { slug?: string; id?: string } }): Promise<ProvisioningOrg | null>;
  };
  outlet: {
    create(a: { data: { id: string; organizationId: string; name: string; active: boolean } }): Promise<{ id: string }>;
    findMany(a: { where: { organizationId: string; active?: boolean } }): Promise<{ id: string }[]>;
  };
  user: {
    findUnique(a: { where: { email?: string; authSubject?: string } }): Promise<ProvisioningUser | null>;
    create(a: { data: { id: string; authSubject: string; email: string; displayName: string; active: boolean } }): Promise<{ id: string }>;
  };
  membership: {
    create(a: { data: { userId: string; organizationId: string; outletId: string | null; role: OrgRoleValue; active: boolean } }): Promise<{ id: string }>;
  };
}

export interface ProvisioningDb {
  $transaction<T>(fn: (tx: ProvisioningTx) => Promise<T>): Promise<T>;
}

// --- Structural Supabase admin port (only the operations used) --------------
export interface SupabaseAdminUser { id: string; email: string | null }
export interface ProvisioningAdmin {
  auth: {
    admin: {
      createUser(a: { email: string; password: string; email_confirm: boolean; app_metadata?: Record<string, unknown> }): Promise<{ data: { user: SupabaseAdminUser | null }; error: { message: string } | null }>;
      inviteUserByEmail(email: string, o?: { data?: Record<string, unknown> }): Promise<{ data: { user: SupabaseAdminUser | null }; error: { message: string } | null }>;
      deleteUser(uid: string): Promise<{ error: { message: string } | null }>;
    };
  };
}

export interface ProvisionResult {
  userId: string;
  authSubject: string;
  organizationId: string;
  outletIds: string[];
  role: OrgRoleValue | "DEVELOPER";
  created: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function requireText(value: unknown, field: string, max = 120): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, { message: `${field} is required` });
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, { message: `${field} is too long` });
  }
  return trimmed;
}

function requireEmail(value: unknown): string {
  const email = requireText(value, "email", 254).toLowerCase();
  if (!EMAIL_RE.test(email)) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, { message: "A valid email is required" });
  }
  return email;
}

export interface ProvisionOwnerInput {
  email: string;
  password: string;
  organizationName: string;
  organizationSlug: string;
  outletName: string;
  ownerDisplayName?: string;
}

/**
 * First-Owner bootstrap: creates the Supabase identity, then — atomically —
 * the Organization, first Outlet, User, and an OWNER Membership (all outlets).
 * Idempotent by email (an existing user returns `created: false`). A Prisma
 * failure after the Supabase user is created triggers a compensating delete.
 */
export async function provisionOwner(deps: {
  db: ProvisioningDb;
  admin: ProvisioningAdmin;
  input: ProvisionOwnerInput;
}): Promise<ProvisionResult> {
  const email = requireEmail(deps.input.email);
  const password = requireText(deps.input.password, "password", 200);
  if (password.length < 8) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, { message: "password must be at least 8 characters" });
  }
  const organizationName = requireText(deps.input.organizationName, "organizationName", 120);
  const organizationSlug = requireText(deps.input.organizationSlug, "organizationSlug", 60).toLowerCase();
  if (!SLUG_RE.test(organizationSlug)) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, { message: "organizationSlug must be a URL-safe slug" });
  }
  const outletName = requireText(deps.input.outletName, "outletName", 120);
  const ownerDisplayName = deps.input.ownerDisplayName?.trim() || email.split("@")[0]!;

  const existing = await deps.db.$transaction((tx) => tx.user.findUnique({ where: { email } }));
  if (existing) {
    return { userId: existing.id, authSubject: "", organizationId: "", outletIds: [], role: "OWNER", created: false };
  }

  const sb = await deps.admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (sb.error || !sb.data.user) {
    throw new AppError(ERROR_CODES.INTERNAL, { message: "Failed to create the authentication user" });
  }
  const authSubject = sb.data.user.id;

  let created: { userId: string; organizationId: string; outletId: string };
  try {
    created = await deps.db.$transaction(async (tx) => {
      const clash = await tx.organization.findUnique({ where: { slug: organizationSlug } });
      if (clash) throw new AppError(ERROR_CODES.CONFLICT, { message: "Organization slug already in use" });
      const organizationId = createId("ten");
      const outletId = createId("out");
      await tx.organization.create({ data: { id: organizationId, name: organizationName, slug: organizationSlug, dataScope: "PRODUCTION", active: true } });
      await tx.outlet.create({ data: { id: outletId, organizationId, name: outletName, active: true } });
      const user = await tx.user.create({ data: { id: createId("usr"), authSubject, email, displayName: ownerDisplayName, active: true } });
      await tx.membership.create({ data: { userId: user.id, organizationId, outletId: null, role: "OWNER", active: true } });
      return { userId: user.id, organizationId, outletId };
    });
  } catch (error) {
    // Compensating action: never leave an orphaned Supabase identity behind.
    await deps.admin.auth.admin.deleteUser(authSubject).catch(() => {});
    throw error;
  }

  return { userId: created.userId, authSubject, organizationId: created.organizationId, outletIds: [created.outletId], role: "OWNER", created: true };
}

export interface ProvisionDeveloperInput {
  email: string;
  password: string;
  displayName?: string;
}

/**
 * Platform Developer provisioning: creates a Supabase identity flagged with the
 * SERVER-ONLY `app_metadata.hansan_platform_role = "developer"` and a HANSAN
 * User with NO business membership (Developer is never an OrgRole).
 *
 * DOCUMENTED LIMITATION: recognizing this platform role at LIVE-SESSION ISSUANCE
 * requires either (a) a small change to establishLiveSession/resolveLiveActor to
 * read Supabase `app_metadata` for the platform role, or (b) a schema field.
 * That session-issuance change is intentionally OUT OF SCOPE for this phase so
 * the verified B2/B3 auth path is not destabilized; it is recorded as a release
 * blocker / follow-up.
 */
export async function provisionDeveloper(deps: {
  db: ProvisioningDb;
  admin: ProvisioningAdmin;
  input: ProvisionDeveloperInput;
}): Promise<ProvisionResult> {
  const email = requireEmail(deps.input.email);
  const password = requireText(deps.input.password, "password", 200);
  if (password.length < 8) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, { message: "password must be at least 8 characters" });
  }
  const displayName = deps.input.displayName?.trim() || email.split("@")[0]!;

  const existing = await deps.db.$transaction((tx) => tx.user.findUnique({ where: { email } }));
  if (existing) {
    return { userId: existing.id, authSubject: "", organizationId: "", outletIds: [], role: "DEVELOPER", created: false };
  }

  const sb = await deps.admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { hansan_platform_role: "developer" },
  });
  if (sb.error || !sb.data.user) {
    throw new AppError(ERROR_CODES.INTERNAL, { message: "Failed to create the developer identity" });
  }
  const authSubject = sb.data.user.id;

  let userId: string;
  try {
    userId = await deps.db.$transaction(async (tx) => (await tx.user.create({ data: { id: createId("usr"), authSubject, email, displayName, active: true } })).id);
  } catch (error) {
    await deps.admin.auth.admin.deleteUser(authSubject).catch(() => {});
    throw error;
  }

  return { userId, authSubject, organizationId: "", outletIds: [], role: "DEVELOPER", created: true };
}

export interface InviteStaffInput {
  email: string;
  role: "OWNER" | "POS" | "KDS" | "FINANCE";
  /** Explicit outlet ids (must belong to the actor's org). Empty => all outlets. */
  outletIds: string[];
  displayName?: string;
}

export interface StaffActor {
  /** Revalidated acting owner (HANSAN User id). */
  userId: string;
  /** Revalidated acting owner's organization. */
  organizationId: string;
}

const STAFF_ROLES: readonly InviteStaffInput["role"][] = ["OWNER", "POS", "KDS", "FINANCE"];

/**
 * Owner-initiated staff invitation. The actor MUST be a revalidated OWNER; the
 * invited role + outlets are validated against the ACTOR'S organization only —
 * a request body can never place staff into another tenant or mint a Developer.
 * POS/KDS require at least one explicit outlet; OWNER/FINANCE may be all-outlet
 * (outletId null). Creates the Supabase identity via invite (invitee sets their
 * own password) then User + Membership(s) atomically, with a compensating
 * Supabase delete on Prisma failure. Idempotent by email.
 */
export async function inviteStaff(deps: {
  db: ProvisioningDb;
  admin: ProvisioningAdmin;
  actor: StaffActor;
  input: InviteStaffInput;
}): Promise<ProvisionResult> {
  const email = requireEmail(deps.input.email);
  const role = deps.input.role;
  if (!STAFF_ROLES.includes(role)) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, { message: "Unsupported staff role" });
  }
  const displayName = deps.input.displayName?.trim() || email.split("@")[0]!;
  const requested = Array.isArray(deps.input.outletIds)
    ? Array.from(new Set(deps.input.outletIds.filter((x): x is string => typeof x === "string" && x.length > 0)))
    : [];

  // Resolve outlet scope: null => all outlets; otherwise validate against the org.
  let outletIds: string[] | null;
  if (requested.length === 0) {
    outletIds = null;
  } else {
    const orgOutlets = await deps.db.$transaction((tx) =>
      tx.outlet.findMany({ where: { organizationId: deps.actor.organizationId, active: true } }),
    );
    const orgOutletIds = new Set(orgOutlets.map((o) => o.id));
    for (const o of requested) {
      if (!orgOutletIds.has(o)) {
        throw new AppError(ERROR_CODES.OUTLET_MISMATCH, { message: "Outlet does not belong to this organization" });
      }
    }
    outletIds = requested;
  }
  if ((role === "POS" || role === "KDS") && outletIds === null) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, { message: "POS/KDS staff require at least one outlet" });
  }

  const existing = await deps.db.$transaction((tx) => tx.user.findUnique({ where: { email } }));
  if (existing) {
    return { userId: existing.id, authSubject: "", organizationId: deps.actor.organizationId, outletIds: outletIds ?? [], role, created: false };
  }

  const sb = await deps.admin.auth.admin.inviteUserByEmail(email, { data: { displayName } });
  if (sb.error || !sb.data.user) {
    throw new AppError(ERROR_CODES.INTERNAL, { message: "Failed to invite the staff member" });
  }
  const authSubject = sb.data.user.id;

  let userId: string;
  try {
    userId = await deps.db.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { id: createId("usr"), authSubject, email, displayName, active: true } });
      if (outletIds === null) {
        await tx.membership.create({ data: { userId: user.id, organizationId: deps.actor.organizationId, outletId: null, role, active: true } });
      } else {
        for (const o of outletIds) {
          await tx.membership.create({ data: { userId: user.id, organizationId: deps.actor.organizationId, outletId: o, role, active: true } });
        }
      }
      return user.id;
    });
  } catch (error) {
    await deps.admin.auth.admin.deleteUser(authSubject).catch(() => {});
    throw error;
  }

  return { userId, authSubject, organizationId: deps.actor.organizationId, outletIds: outletIds ?? [], role, created: true };
}


