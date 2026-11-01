/** Regression: `GET /api/orders` rejects malformed `sinceIso` at the route. */
import { beforeEach, describe, expect, it } from "vitest";
import { signSession, SESSION_COOKIE, type SessionPayload } from "@/server/session";
import { demoSandbox } from "@/server/runtime";
import { MemoryCatalog } from "@/server/db/memory-store";
import { GET, POST } from "@/app/api/orders/route";
import { ERROR_CODES } from "@/domain/shared/errors";
import { setEnv } from "./helpers/env";

const DEMO_SECRET = "test-demo-secret-not-for-production-use";
const DEMO_TENANT = "ten_demo";
const DEMO_OUTLET = "out_demo";

// Point requireAuth at the test secret so the demo auth cookie is accepted.
// This is never a real credential.
setEnv("SESSION_SECRET", DEMO_SECRET);

// Reset the process-local DEMO sandbox before each test.
beforeEach(() => {
  delete (globalThis as unknown as { __hansanDemoRuntime?: unknown }).__hansanDemoRuntime;
});

async function demoSession(role: "pos", userId: string): Promise<string> {
  const session: SessionPayload = {
    v: 1,
    mode: "demo",
    sub: userId,
    role,
    email: `${userId}@hansan.local`,
    tenantId: DEMO_TENANT,
    outletIds: [DEMO_OUTLET],
    dataScope: "DEMO",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const token = (await signSession(session, DEMO_SECRET)) ?? "";
  return token;
}

function authHeaders(token: string): Record<string, string> {
  return { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` };
}

/** Seed the SANDBOX catalog (the one the route actually reads). */
function seedProduct(productId: string): void {
  const catalog = demoSandbox().catalog as MemoryCatalog;
  catalog.put({
    id: productId,
    tenantId: DEMO_TENANT,
    categoryId: "cat_demo",
    name: `${productId} Item`,
    priceIdr: 25_000,
    station: "kitchen",
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  });
}

async function callPost(token: string, body: unknown, idempotencyKey: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const req = new Request("http://localhost/api/orders", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
      ...authHeaders(token),
    },
    body: JSON.stringify(body),
  });
  const res = await POST(req);
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json };
}

async function callGetList(token: string, search = ""): Promise<{ status: number; json: Record<string, unknown> }> {
  const url = "http://localhost/api/orders" + (search ? "?" + search : "");
  const req = new Request(url, {
    method: "GET",
    headers: authHeaders(token),
  });
  const res = await GET(req);
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json };
}

/** Extract the `data` field from an API OK envelope. */
function okData<T>(json: Record<string, unknown>): T {
  return (json as { ok: true; data: T }).data;
}

/** Seed one order (assumes product already seeded). */
async function seedOrder(token: string): Promise<string> {
  const order = await callPost(token, { orderType: "take-away", lines: [{ productId: "p1", quantity: 1 }] }, "idem-h1");
  if (order.status !== 201) throw new Error("seed failed: " + JSON.stringify(order.json));
  return okData<{ id: string }>(order.json).id;
}

async function seedProductAndOrder(token: string): Promise<string> {
  seedProduct("p1");
  return await seedOrder(token);
}

function failBody(json: unknown): { ok: false; error: { code: string } } {
  return json as { ok: false; error: { code: string } };
}

describe("GET /api/orders sinceIso validation", () => {
  it("accepts a valid UTC timestamp and keeps the order in history", async () => {
    const token = await demoSession("pos", "usr_pos_history");
    const orderId = await seedProductAndOrder(token);
    const res = await callGetList(token, "sinceIso=2026-01-01T00:00:00.000Z");
    expect(res.status).toBe(200);
    const data = okData<{ orders: unknown[] }>(res.json).orders;
    expect(data.some((o) => (o as Record<string, unknown>).id === orderId)).toBe(true);
  });

  it("accepts missing sinceIso (no filter)", async () => {
    const token = await demoSession("pos", "usr_pos_history");
    const orderId = await seedProductAndOrder(token);
    const res = await callGetList(token, "sinceIso=");
    expect(res.status).toBe(200);
    const data = okData<{ orders: unknown[] }>(res.json).orders;
    expect(data.some((o) => (o as Record<string, unknown>).id === orderId)).toBe(true);
  });

  it("accepts empty search (no sinceIso param, no filter)", async () => {
    const token = await demoSession("pos", "usr_pos_history");
    const orderId = await seedProductAndOrder(token);
    const res = await callGetList(token, "");
    expect(res.status).toBe(200);
    const data = okData<{ orders: unknown[] }>(res.json).orders;
    expect(data.some((o) => (o as Record<string, unknown>).id === orderId)).toBe(true);
  });

  it("rejects a non-timestamp string with VALIDATION_FAILED (400)", async () => {
    const token = await demoSession("pos", "usr_pos_history");
    await seedProductAndOrder(token);
    const res = await callGetList(token, "sinceIso=not-a-date");
    expect(res.status).toBe(400);
    const body = failBody(res.json);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it("rejects an impossible date (month 13) with VALIDATION_FAILED (400)", async () => {
    const token = await demoSession("pos", "usr_pos_history");
    await seedProductAndOrder(token);
    const res = await callGetList(token, "sinceIso=2026-13-01T00:00:00Z");
    expect(res.status).toBe(400);
    const body = failBody(res.json);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });
});