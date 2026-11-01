import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getPrisma: vi.fn(() => ({})) }));

import { getPrisma } from "@/server/db/client";
import { runtimeFor } from "@/server/runtime";
import { PrismaReservations } from "@/server/db/reservation-adapter";
import { createDemoSession, type SessionPayload } from "@/server/session";

describe("production reservation persistence fail-closed", () => {
  it("uses UnavailableReservations instead of in-memory success", () => {
    vi.mocked(getPrisma).mockReturnValue({} as never);
    const session: SessionPayload = {
      v: 1,
      mode: "live",
      sub: "usr_owner",
      role: "owner",
      email: "o@x.test",
      tenantId: "ten_acme",
      outletIds: ["out_a"],
      dataScope: "PRODUCTION",
      iat: 1,
      exp: 9999999999,
    };
    const runtime = runtimeFor(session);
    expect(runtime?.scope).toBe("PRODUCTION");
    expect(runtime?.reservations).toBeInstanceOf(PrismaReservations);
  });

  it("demo sessions still use MemoryReservations", () => {
    const demo = createDemoSession({ userId: "usr_demo", role: "owner", email: "d@x.test" });
    const runtime = runtimeFor(demo);
    expect(runtime?.scope).toBe("DEMO");
  });
});