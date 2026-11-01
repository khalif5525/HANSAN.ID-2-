/**
 * OA21 — PG guard negative checks (connection-free).
 * OA33 — sandbox port 5433 allowlist checks (connection-free).
 *
 * Every test below injects env values through a fake reader, so NO real
 * environment variable is read and NO database connection is attempted.
 * These prove the harness fails closed; they are HARNESS-ONLY evidence,
 * not LOCAL-PG evidence.
 */
import { describe, expect, it } from "vitest";
import {
  PG_TEST_ALLOW_SENTINEL,
  checkPgTestGuard,
} from "./helpers/pg-test-guard";

function reader(env: Record<string, string | undefined>) {
  return (name: string) => env[name];
}

const GOOD_URL = "postgresql://tester@localhost:5432/hansan_test_oa21";

describe("pg-test-guard fail-closed behavior", () => {
  it("fails when the opt-in flag is missing", () => {
    const d = checkPgTestGuard(reader({ HANSAN_PG_TEST_URL: GOOD_URL }));
    expect(d.ok).toBe(false);
  });

  it("fails when the dedicated test URL is missing", () => {
    const d = checkPgTestGuard(
      reader({ HANSAN_PG_TEST_ALLOW: PG_TEST_ALLOW_SENTINEL }),
    );
    expect(d.ok).toBe(false);
  });

  it("fails on an invalid opt-in value", () => {
    const d = checkPgTestGuard(
      reader({ HANSAN_PG_TEST_ALLOW: "yes", HANSAN_PG_TEST_URL: GOOD_URL }),
    );
    expect(d.ok).toBe(false);
  });

  it("never falls back to DATABASE_URL or DIRECT_URL", () => {
    // Both app DB vars present, but the dedicated opt-in pair absent/wrong:
    // the guard must still refuse (it only reads its own two variables).
    const d = checkPgTestGuard(
      reader({
        DATABASE_URL: GOOD_URL,
        DIRECT_URL: GOOD_URL,
        HANSAN_PG_TEST_ALLOW: PG_TEST_ALLOW_SENTINEL,
      }),
    );
    expect(d.ok).toBe(false);
  });

  it("rejects remote/production-like targets", () => {
    const d = checkPgTestGuard(
      reader({
        HANSAN_PG_TEST_ALLOW: PG_TEST_ALLOW_SENTINEL,
        HANSAN_PG_TEST_URL:
          "postgresql://user@db.example-supabase.co:5432/hansan_test_x",
      }),
    );
    expect(d.ok).toBe(false);
  });

  it("rejects non-loopback hosts and non-test db names", () => {
    expect(
      checkPgTestGuard(
        reader({
          HANSAN_PG_TEST_ALLOW: PG_TEST_ALLOW_SENTINEL,
          HANSAN_PG_TEST_URL: "postgresql://u@192.168.1.10:5432/hansan_test_x",
        }),
      ).ok,
    ).toBe(false);
    expect(
      checkPgTestGuard(
        reader({
          HANSAN_PG_TEST_ALLOW: PG_TEST_ALLOW_SENTINEL,
          HANSAN_PG_TEST_URL: "postgresql://u@localhost:5432/hansan",
        }),
      ).ok,
    ).toBe(false);
  });

  it("accepts a valid loopback disposable target (guard-only, no connection)", () => {
    const d = checkPgTestGuard(
      reader({
        HANSAN_PG_TEST_ALLOW: PG_TEST_ALLOW_SENTINEL,
        HANSAN_PG_TEST_URL: GOOD_URL,
      }),
    );
    expect(d.ok).toBe(true);
  });

  it("never leaks the URL in failure reasons", () => {
    const secretLike = "postgresql://tester:s3cr3t@localhost:5432/wrongname";
    const d = checkPgTestGuard(
      reader({
        HANSAN_PG_TEST_ALLOW: PG_TEST_ALLOW_SENTINEL,
        HANSAN_PG_TEST_URL: secretLike,
      }),
    );
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.reason).not.toContain("s3cr3t");
      expect(d.reason).not.toContain(secretLike);
    }
  });
});

describe("pg-test-guard sandbox port 5433 (OA33, connection-free)", () => {
  const SANDBOX_URL = "postgresql://hansan_test@127.0.0.1:5433/hansan_test_oa21";

  it("accepts loopback + port 5433 + disposable db name (guard decision only)", () => {
    const d = checkPgTestGuard(
      reader({
        HANSAN_PG_TEST_ALLOW: PG_TEST_ALLOW_SENTINEL,
        HANSAN_PG_TEST_URL: SANDBOX_URL,
      }),
    );
    expect(d.ok).toBe(true);
  });

  it("accepts each loopback host variant on port 5433", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      const d = checkPgTestGuard(
        reader({
          HANSAN_PG_TEST_ALLOW: PG_TEST_ALLOW_SENTINEL,
          HANSAN_PG_TEST_URL: `postgresql://hansan_test@${host}:5433/hansan_test_oa21`,
        }),
      );
      expect(d.ok, `expected accept for ${host}:5433`).toBe(true);
    }
  });

  it("refuses non-loopback hosts on port 5433", () => {
    for (const url of [
      "postgresql://u@192.168.1.10:5433/hansan_test_oa21",
      "postgresql://u@example.com:5433/hansan_test_oa21",
    ]) {
      expect(
        checkPgTestGuard(
          reader({
            HANSAN_PG_TEST_ALLOW: PG_TEST_ALLOW_SENTINEL,
            HANSAN_PG_TEST_URL: url,
          }),
        ).ok,
        `expected refuse for ${url}`,
      ).toBe(false);
    }
  });

  it("refuses loopback + port 5433 with a non-test database name", () => {
    const d = checkPgTestGuard(
      reader({
        HANSAN_PG_TEST_ALLOW: PG_TEST_ALLOW_SENTINEL,
        HANSAN_PG_TEST_URL: "postgresql://u@127.0.0.1:5433/hansan",
      }),
    );
    expect(d.ok).toBe(false);
  });

  it("refuses unexpected loopback ports (e.g. 5437, 5439)", () => {
    for (const url of [
      "postgresql://u@127.0.0.1:5437/hansan_test_oa21",
      "postgresql://u@localhost:5439/hansan_test_oa21",
    ]) {
      expect(
        checkPgTestGuard(
          reader({
            HANSAN_PG_TEST_ALLOW: PG_TEST_ALLOW_SENTINEL,
            HANSAN_PG_TEST_URL: url,
          }),
        ).ok,
        `expected refuse for ${url}`,
      ).toBe(false);
    }
  });

  it("refuses sandbox URL when the sentinel is missing or wrong", () => {
    expect(
      checkPgTestGuard(reader({ HANSAN_PG_TEST_URL: SANDBOX_URL })).ok,
    ).toBe(false);
    expect(
      checkPgTestGuard(
        reader({
          HANSAN_PG_TEST_ALLOW: "yes",
          HANSAN_PG_TEST_URL: SANDBOX_URL,
        }),
      ).ok,
    ).toBe(false);
  });

  it("never enables the harness from DATABASE_URL/DIRECT_URL alone", () => {
    const d = checkPgTestGuard(
      reader({
        DATABASE_URL: SANDBOX_URL,
        DIRECT_URL: SANDBOX_URL,
        HANSAN_PG_TEST_ALLOW: PG_TEST_ALLOW_SENTINEL,
      }),
    );
    expect(d.ok).toBe(false);
  });

  it("never reveals URL, username, or password in failure reasons", () => {
    const user = "hansan_test_probe";
    const pw = "s3cr3t-pw-probe";
    const secretLike = `postgresql://${user}:${pw}@127.0.0.1:5433/wrongname`;
    const d = checkPgTestGuard(
      reader({
        HANSAN_PG_TEST_ALLOW: PG_TEST_ALLOW_SENTINEL,
        HANSAN_PG_TEST_URL: secretLike,
      }),
    );
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.reason).not.toContain(secretLike);
      expect(d.reason).not.toContain(pw);
      expect(d.reason).not.toContain(user);
    }
  });
});

describe("pg-test-guard pooler sandbox port 5434 (OA41, connection-free)", () => {
  const POOLER_URL = "postgresql://hansan_test@127.0.0.1:5434/hansan_test_oa21";

  it("accepts loopback + port 5434 + disposable db name (guard decision only)", () => {
    const d = checkPgTestGuard(
      reader({
        HANSAN_PG_TEST_ALLOW: PG_TEST_ALLOW_SENTINEL,
        HANSAN_PG_TEST_URL: POOLER_URL,
      }),
    );
    expect(d.ok).toBe(true);
  });

  it("accepts each loopback host variant on port 5434", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      const d = checkPgTestGuard(
        reader({
          HANSAN_PG_TEST_ALLOW: PG_TEST_ALLOW_SENTINEL,
          HANSAN_PG_TEST_URL: `postgresql://hansan_test@${host}:5434/hansan_test_oa21`,
        }),
      );
      expect(d.ok, `expected accept for ${host}:5434`).toBe(true);
    }
  });

  it("refuses non-loopback hosts on port 5434", () => {
    for (const url of [
      "postgresql://u@192.168.1.10:5434/hansan_test_oa21",
      "postgresql://u@example.com:5434/hansan_test_oa21",
    ]) {
      expect(
        checkPgTestGuard(
          reader({
            HANSAN_PG_TEST_ALLOW: PG_TEST_ALLOW_SENTINEL,
            HANSAN_PG_TEST_URL: url,
          }),
        ).ok,
        `expected refuse for ${url}`,
      ).toBe(false);
    }
  });

  it("refuses loopback + port 5434 with a non-test database name", () => {
    const d = checkPgTestGuard(
      reader({
        HANSAN_PG_TEST_ALLOW: PG_TEST_ALLOW_SENTINEL,
        HANSAN_PG_TEST_URL: "postgresql://u@127.0.0.1:5434/hansan",
      }),
    );
    expect(d.ok).toBe(false);
  });

  it("refuses pooler URL when the sentinel is missing or wrong", () => {
    expect(
      checkPgTestGuard(reader({ HANSAN_PG_TEST_URL: POOLER_URL })).ok,
    ).toBe(false);
    expect(
      checkPgTestGuard(
        reader({
          HANSAN_PG_TEST_ALLOW: "yes",
          HANSAN_PG_TEST_URL: POOLER_URL,
        }),
      ).ok,
    ).toBe(false);
  });

  it("never enables the harness from DATABASE_URL/DIRECT_URL alone", () => {
    const d = checkPgTestGuard(
      reader({
        DATABASE_URL: POOLER_URL,
        DIRECT_URL: POOLER_URL,
        HANSAN_PG_TEST_ALLOW: PG_TEST_ALLOW_SENTINEL,
      }),
    );
    expect(d.ok).toBe(false);
  });

  it("never reveals URL, username, or password in failure reasons", () => {
    const user = "hansan_test_probe";
    const pw = "s3cr3t-pw-probe";
    const secretLike = `postgresql://${user}:${pw}@127.0.0.1:5434/wrongname`;
    const d = checkPgTestGuard(
      reader({
        HANSAN_PG_TEST_ALLOW: PG_TEST_ALLOW_SENTINEL,
        HANSAN_PG_TEST_URL: secretLike,
      }),
    );
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.reason).not.toContain(secretLike);
      expect(d.reason).not.toContain(pw);
      expect(d.reason).not.toContain(user);
    }
  });
});
describe("pg-test-guard disposable Phase H ports 5435/5436 (connection-free)", () => {
  it("accepts loopback port 5435 with a disposable database name", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      const d = checkPgTestGuard(
        reader({
          HANSAN_PG_TEST_ALLOW: PG_TEST_ALLOW_SENTINEL,
          HANSAN_PG_TEST_URL: `postgresql://hansan_test@${host}:5435/hansan_test_phaseh`,
        }),
      );
      expect(d.ok, `expected accept for ${host}:5435`).toBe(true);
    }
  });

  it("accepts loopback port 5436 with a disposable database name", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      const d = checkPgTestGuard(
        reader({
          HANSAN_PG_TEST_ALLOW: PG_TEST_ALLOW_SENTINEL,
          HANSAN_PG_TEST_URL: `postgresql://hansan_test@${host}:5436/hansan_test_phaseh`,
        }),
      );
      expect(d.ok, `expected accept for ${host}:5436`).toBe(true);
    }
  });

  it("rejects non-loopback hosts on ports 5435 and 5436", () => {
    for (const port of ["5435", "5436"]) {
      for (const url of [
        `postgresql://u@192.168.1.10:${port}/hansan_test_phaseh`,
        `postgresql://u@example.com:${port}/hansan_test_phaseh`,
      ]) {
        expect(
          checkPgTestGuard(
            reader({
              HANSAN_PG_TEST_ALLOW: PG_TEST_ALLOW_SENTINEL,
              HANSAN_PG_TEST_URL: url,
            }),
          ).ok,
          `expected refuse for ${url}`,
        ).toBe(false);
      }
    }
  });

  it("rejects ports 5435 and 5436 with a non-disposable database name", () => {
    for (const port of ["5435", "5436"]) {
      const d = checkPgTestGuard(
        reader({
          HANSAN_PG_TEST_ALLOW: PG_TEST_ALLOW_SENTINEL,
          HANSAN_PG_TEST_URL: `postgresql://u@127.0.0.1:${port}/hansan`,
        }),
      );
      expect(d.ok).toBe(false);
    }
  });

  it("rejects ports 5435 and 5436 without the sentinel", () => {
    for (const port of ["5435", "5436"]) {
      const url = `postgresql://u@127.0.0.1:${port}/hansan_test_phaseh`;
      expect(checkPgTestGuard(reader({ HANSAN_PG_TEST_URL: url })).ok).toBe(false);
      expect(
        checkPgTestGuard(
          reader({ HANSAN_PG_TEST_ALLOW: "yes", HANSAN_PG_TEST_URL: url }),
        ).ok,
      ).toBe(false);
    }
  });
});

