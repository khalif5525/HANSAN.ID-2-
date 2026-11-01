/**
 * Customer reservation route-level tests.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { signSession, SESSION_COOKIE, type SessionPayload } from "@/server/session";
import { demoSandbox } from "@/server/runtime";
import { POST } from "@/app/api/customer/reservations/route";
import { ERROR_CODES } from "@/domain/shared/errors";

const DEMO_SECRET = "test-demo-secret-not-for-production-use";
const DEMO_TENANT = "ten_demo";
const DEMO_OUTLET = "out_demo";
const FUTURE = "2030-01-01T12:00:00.000Z";

function setSecret(): void {
  const env = process.env as Record<string, string | undefined>;
  env.SESSION_SECRET = DEMO_SECRET;
}
setSecret();

beforeEach(() => {
  delete (globalThis as unknown as { __hansanDemoRuntime?: unknown }).__hansanDemoRuntime;
});

async function demoSession(params: {
  role: "pos" | "owner" | "kds" | "finance";
  userId: string;
  tenantId?: string;
  outletId?: string;
}): Promise<{ session: SessionPayload; token: string }> {
  const session: SessionPayload = {
    v: 1,
    mode: "demo",
    sub: params.userId,
    role: params.role,
    email: `${params.userId}@hansan.local`,
    tenantId: params.tenantId ?? DEMO_TENANT,
    outletIds: [params.outletId ?? DEMO_OUTLET],
    dataScope: "DEMO",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const token = (await signSession(session, DEMO_SECRET)) ?? "";
  return { session, token };
}

function authHeaders(token: string): Record<string, string> {
  return { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` };
}

async function callPost(
  token: string,
  body: unknown,
  idempotencyKey?: string,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const h: Record<string, string> = {
    "content-type": "application/json",
    ...authHeaders(token),
  };
  if (idempotencyKey) h["idempotency-key"] = idempotencyKey;
  const req = new Request("http://localhost/api/customer/reservations", {
    method: "POST",
    headers: h,
    body: JSON.stringify(body),
  });
  const res = await POST(req);
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json };
}

function failCode(json: Record<string, unknown>): string {
  return (json as { ok: false; error: { code: string } }).error.code;
}

const VALID_BODY = {
  customerName: "Jane Doe",
  customerEmail: "jane@example.com",
  customerPhone: "08123456789",
  partySize: 4,
  reservationAt: FUTURE,
};

describe("Customer reservation API (POST /api/customer/reservations)", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const req = new Request("http://localhost/api/customer/reservations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(VALID_BODY),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(failCode((await res.json()) as Record<string, unknown>)).toBe(ERROR_CODES.UNAUTHENTICATED);
  });

  it("rejects roles lacking pos:order_create with 403", async () => {
    const { token } = await demoSession({ role: "kds", userId: "usr_kds" });
    const res = await callPost(token, VALID_BODY, "r-1");
    expect(res.status).toBe(403);
    expect(failCode(res.json)).toBe(ERROR_CODES.ROLE_NOT_PERMITTED);
  });

  it("rejects invalid body with 400", async () => {
    const { token } = await demoSession({ role: "pos", userId: "usr_pos" });
    const res = await callPost(token, "not-an-object", "r-2");
    expect(res.status).toBe(400);
    expect(failCode(res.json)).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it("rejects missing required fields with 400", async () => {
    const { token } = await demoSession({ role: "pos", userId: "usr_pos" });
    const res = await callPost(token, { customerName: "Jane" }, "r-3");
    expect(res.status).toBe(400);
    expect(failCode(res.json)).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it("rejects missing Idempotency-Key with 400", async () => {
    const { token } = await demoSession({ role: "pos", userId: "usr_pos" });
    const res = await callPost(token, VALID_BODY);
    expect(res.status).toBe(400);
    expect(failCode(res.json)).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it("creates a reservation successfully", async () => {
    const { token } = await demoSession({ role: "pos", userId: "usr_pos" });
    const res = await callPost(token, VALID_BODY, "r-4");
    expect(res.status).toBe(201);
    expect(res.json.ok).toBe(true);
    const data = res.json.data as { status: string; partySize: number; customerName: string };
    expect(data.status).toBe("CONFIRMED");
    expect(data.partySize).toBe(4);
    expect(data.customerName).toBe("Jane Doe");
  });

  it("replays idempotent request with 200", async () => {
    const { token } = await demoSession({ role: "pos", userId: "usr_pos" });
    const first = await callPost(token, VALID_BODY, "r-5");
    expect(first.status).toBe(201);
    const second = await callPost(token, VALID_BODY, "r-5");
    expect(second.status).toBe(200);
    expect(second.json.data).toEqual(first.json.data);
  });

  it("rejects conflicting payload under same key with 409", async () => {
    const { token } = await demoSession({ role: "pos", userId: "usr_pos" });
    const first = await callPost(token, VALID_BODY, "r-6");
    expect(first.status).toBe(201);
    const second = await callPost(token, { ...VALID_BODY, partySize: 2 }, "r-6");
    expect(second.status).toBe(409);
  });

  it("returns 400 when no outlet assigned", async () => {
    const session: SessionPayload = {
      v: 1,
      mode: "demo",
      sub: "usr_pos2",
      role: "pos",
      email: "usr_pos2@hansan.local",
      tenantId: DEMO_TENANT,
      outletIds: [],
      dataScope: "DEMO",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const token = (await signSession(session, DEMO_SECRET)) ?? "";
    const res = await callPost(token, VALID_BODY, "r-8");
    expect(res.status).toBe(400);
    expect(failCode(res.json)).toBe(ERROR_CODES.VALIDATION_FAILED);
  });
});
