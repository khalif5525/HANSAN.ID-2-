/**
 * Customer order route-level tests (aligned with canonical /api/orders).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { signSession, SESSION_COOKIE, type SessionPayload } from "@/server/session";
import { demoSandbox } from "@/server/runtime";
import { MemoryCatalog } from "@/server/db/memory-store";
import { POST } from "@/app/api/customer/orders/route";
import { ERROR_CODES } from "@/domain/shared/errors";

const DEMO_SECRET = "test-demo-secret-not-for-production-use";
const DEMO_TENANT = "ten_demo";
const DEMO_OUTLET = "out_demo";
const DEMO_TENANT_2 = "ten_demo_2";
const DEMO_OUTLET_2 = "out_demo_2";

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

function seedProduct(productId: string, tenantId = DEMO_TENANT): void {
  const catalog = demoSandbox().catalog as MemoryCatalog;
  catalog.put({
    id: productId,
    tenantId,
    categoryId: "cat_demo",
    name: `${productId} Item`,
    priceIdr: 25_000,
    station: "kitchen",
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  });
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
  const req = new Request("http://localhost/api/customer/orders", {
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

describe("Customer order API (POST /api/customer/orders)", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const req = new Request("http://localhost/api/customer/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderType: "take-away", lines: [{ productId: "p1", quantity: 1 }] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(failCode((await res.json()) as Record<string, unknown>)).toBe(ERROR_CODES.UNAUTHENTICATED);
  });

  it("rejects roles lacking pos:order_create with 403", async () => {
    seedProduct("p1");
    const { token } = await demoSession({ role: "kds", userId: "usr_kds" });
    const res = await callPost(token, { orderType: "take-away", lines: [{ productId: "p1", quantity: 1 }] }, "co-1");
    expect(res.status).toBe(403);
    expect(failCode(res.json)).toBe(ERROR_CODES.ROLE_NOT_PERMITTED);
  });

  it("rejects invalid body with 400", async () => {
    seedProduct("p1");
    const { token } = await demoSession({ role: "pos", userId: "usr_pos" });
    const res = await callPost(token, "not-an-object", "co-2");
    expect(res.status).toBe(400);
    expect(failCode(res.json)).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it("rejects missing Idempotency-Key with 400", async () => {
    seedProduct("p1");
    const { token } = await demoSession({ role: "pos", userId: "usr_pos" });
    const res = await callPost(token, { orderType: "take-away", lines: [{ productId: "p1", quantity: 1 }] });
    expect(res.status).toBe(400);
    expect(failCode(res.json)).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it("creates an order successfully", async () => {
    seedProduct("p1");
    const { token } = await demoSession({ role: "pos", userId: "usr_pos" });
    const res = await callPost(token, { orderType: "take-away", lines: [{ productId: "p1", quantity: 2 }] }, "co-3");
    expect(res.status).toBe(201);
    expect(res.json.ok).toBe(true);
    const data = res.json.data as { grandTotalIdr: number; lines: unknown[] };
    expect(data.grandTotalIdr).toBe(50_000);
    expect(data.lines.length).toBe(1);
  });

  it("replays idempotent request with 200", async () => {
    seedProduct("p1");
    const { token } = await demoSession({ role: "pos", userId: "usr_pos" });
    const body = { orderType: "take-away", lines: [{ productId: "p1", quantity: 2 }] };
    const first = await callPost(token, body, "co-4");
    expect(first.status).toBe(201);
    const second = await callPost(token, body, "co-4");
    expect(second.status).toBe(200);
    expect(second.json.data).toEqual(first.json.data);
  });

  it("rejects conflicting payload under same key with 409", async () => {
    seedProduct("p1");
    const { token } = await demoSession({ role: "pos", userId: "usr_pos" });
    const first = await callPost(token, { orderType: "take-away", lines: [{ productId: "p1", quantity: 2 }] }, "co-5");
    expect(first.status).toBe(201);
    const second = await callPost(token, { orderType: "take-away", lines: [{ productId: "p1", quantity: 3 }] }, "co-5");
    expect(second.status).toBe(409);
  });

  it("ignores client-supplied tenant/outlet (tenant isolation)", async () => {
    seedProduct("p1");
    const { token } = await demoSession({ role: "pos", userId: "usr_pos", tenantId: DEMO_TENANT, outletId: DEMO_OUTLET });
    const res = await callPost(
      token,
      { orderType: "take-away", tenantId: DEMO_TENANT_2, outletId: DEMO_OUTLET_2, lines: [{ productId: "p1", quantity: 1 }] },
      "co-6",
    );
    expect(res.status).toBe(201);
    const data = res.json.data as { outletId: string };
    expect(data.outletId).toBe(DEMO_OUTLET);
  });

  it("returns 400 when no outlet assigned", async () => {
    seedProduct("p1");
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
    const res = await callPost(token, { orderType: "take-away", lines: [{ productId: "p1", quantity: 1 }] }, "co-7");
    expect(res.status).toBe(400);
    expect(failCode(res.json)).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it("releases idempotency claim on failure so a retry can succeed", async () => {
    const { token } = await demoSession({ role: "pos", userId: "usr_pos" });
    const body = { orderType: "take-away", lines: [{ productId: "missing", quantity: 1 }] };
    const first = await callPost(token, body, "co-err");
    expect(first.status).toBe(404);
    seedProduct("missing");
    const second = await callPost(token, { orderType: "take-away", lines: [{ productId: "missing", quantity: 1 }] }, "co-err");
    expect(second.status).toBe(201);
  });
});
