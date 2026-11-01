/**
 * Phase 3 — session token tests: signature integrity, expiry, secret policy.
 */
import { describe, expect, it } from "vitest";
import {
  createDemoSession,
  getSessionSecret,
  signSession,
  verifySession,
  DEMO_TENANT_ID,
} from "@/server/session";
import { getEnv, setEnv, setNodeEnv } from "./helpers/env";

const TEST_SECRET = "test-secret-at-least-32-characters-long!!";
// Anchor to the CURRENT time so issued sessions stay valid (exp = now + TTL).
// A hard-coded timestamp would rot into "already expired" as real time passes.
const now = new Date();

describe("session tokens", () => {
  it("round-trips a valid demo session", async () => {
    const payload = createDemoSession({ userId: "usr_demo_owner", role: "owner", email: "owner@hansan.local", now });
    const token = await signSession(payload, TEST_SECRET);
    expect(token).toBeTruthy();
    const verified = await verifySession(token, TEST_SECRET);
    expect(verified).toEqual(payload);
  });

  it("pins demo sessions to the demo tenant and DEMO data scope", () => {
    const payload = createDemoSession({ userId: "usr_demo_pos", role: "pos", email: "pos@hansan.local", now });
    expect(payload.tenantId).toBe(DEMO_TENANT_ID);
    expect(payload.dataScope).toBe("DEMO");
    expect(payload.mode).toBe("demo");
  });

  it("rejects tampered payloads (privilege escalation attempt)", async () => {
    const payload = createDemoSession({ userId: "usr_demo_owner", role: "owner", email: "owner@hansan.local", now });
    const token = (await signSession(payload, TEST_SECRET))!;
    const parts = token.split(".");
    const body = parts[1]!;
    const sig = parts[2]!;
    const forged = JSON.parse(Buffer.from(body, "base64url").toString()) as Record<string, unknown>;
    forged.role = "developer";
    forged.dataScope = "PRODUCTION";
    const forgedBody = Buffer.from(JSON.stringify(forged)).toString("base64url");
    expect(await verifySession(`v1.${forgedBody}.${sig}`, TEST_SECRET)).toBeNull();
    expect(await verifySession(`v1.${forgedBody}.${sig}`, null)).toBeNull();
  });

  it("rejects expired sessions", async () => {
    const past = new Date(now.getTime() - 13 * 60 * 60 * 1000);
    const payload = createDemoSession({ userId: "usr_demo_owner", role: "owner", email: "owner@hansan.local", now: past });
    const token = await signSession(payload, TEST_SECRET);
    expect(await verifySession(token, TEST_SECRET)).toBeNull();
  });

  it("rejects wrong-secret, missing-secret, and garbage tokens (fail closed)", async () => {
    const payload = createDemoSession({ userId: "usr_demo_owner", role: "owner", email: "owner@hansan.local", now });
    const token = await signSession(payload, TEST_SECRET);
    expect(await verifySession(token, "another-secret-that-is-different-entirely")).toBeNull();
    expect(await verifySession(token, null)).toBeNull();
    expect(await verifySession(null, TEST_SECRET)).toBeNull();
    expect(await verifySession("garbage", TEST_SECRET)).toBeNull();
    expect(await verifySession("v2.abc.def", TEST_SECRET)).toBeNull();
  });

  it("never signs when secret is unconfigured", async () => {
    const payload = createDemoSession({ userId: "usr_demo_owner", role: "owner", email: "owner@hansan.local", now });
    expect(await signSession(payload, null)).toBeNull();
  });

  it("secret policy: env (>=32 chars), dev fallback outside production, unconfigured in production", () => {
    const prevSecret = getEnv("SESSION_SECRET");
    const prevNodeEnv = getEnv("NODE_ENV");
    try {
      setEnv("SESSION_SECRET", "");
      setNodeEnv("development");
      expect(getSessionSecret().source).toBe("development-fallback");

      setNodeEnv("production");
      const unconfigured = getSessionSecret();
      expect(unconfigured.source).toBe("unconfigured");
      expect(unconfigured.secret).toBeNull();

      setEnv("SESSION_SECRET", "short");
      expect(getSessionSecret().source).toBe("unconfigured"); // < 32 chars refused

      setEnv("SESSION_SECRET", "a-production-secret-with-plenty-of-length-123");
      const configured = getSessionSecret();
      expect(configured.source).toBe("env");
      expect(configured.secret).toBe("a-production-secret-with-plenty-of-length-123");
    } finally {
      setEnv("SESSION_SECRET", prevSecret);
      setNodeEnv(prevNodeEnv);
    }
  });
});
