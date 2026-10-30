/**
 * Phase 2 artifact guards — static checks over prisma/ files.
 * No database needed: these enforce the non-negotiables structurally so a
 * future schema edit that violates them fails CI before it reaches a DB.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const rawSchema = readFileSync(path.join(ROOT, "prisma", "schema.prisma"), "utf8");
/** Schema with // and /// comment lines removed (comments may mention banned words). */
const schema = rawSchema
  .split("\n")
  .filter((l) => !l.trim().startsWith("//"))
  .join("\n");

describe("prisma schema — tenant & money invariants", () => {
  it("never uses floating-point storage for money", () => {
    // Float/Double/Decimal-with-scale are banned for financial columns.
    expect(schema).not.toMatch(/Float/);
    expect(schema).not.toMatch(/Double/);
    // Every *Idr column must be BigInt (whole rupiah, integer arithmetic).
    const idrLines = schema.split("\n").filter((l) => /\w+Idr\s+\w/.test(l) && !l.trim().startsWith("///"));
    expect(idrLines.length).toBeGreaterThan(0);
    for (const line of idrLines) {
      expect(line, `money column must be BigInt: ${line.trim()}`).toMatch(/BigInt/);
    }
  });

  it("scopes every business table to an organization", () => {
    const businessModels = ["Order", "Payment", "Refund", "SettlementBatch", "InventoryMovement", "MenuItem", "Ingredient"];
    for (const model of businessModels) {
      const match = schema.match(new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`));
      expect(match, `model ${model} missing`).toBeTruthy();
      expect(match![1], `${model} must carry organizationId`).toMatch(/organizationId\s+String/);
    }
  });

  it("keeps demo/production separation columns", () => {
    expect(schema).toMatch(/enum DataScope \{\s*PRODUCTION\s*DEMO\s*\}/);
    for (const model of ["Order", "Payment", "Refund", "SettlementBatch"]) {
      const match = schema.match(new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`));
      expect(match![1], `${model} must carry dataScope`).toMatch(/dataScope\s+DataScope/);
    }
  });

  it("declares explicit units for quantities", () => {
    expect(schema).toMatch(/enum UnitCode \{[^}]*\bg\b[^}]*\bml\b/);
    expect(schema).toMatch(/quantity\s+Decimal\s+@db\.Decimal\(14, 3\)/);
  });

  it("keeps station routing explicit (KITCHEN/BAR) on menu and order lines", () => {
    expect(schema).toMatch(/station\s+Station/);
    expect(schema).toMatch(/enum Station \{\s*KITCHEN\s*BAR\s*\}/);
  });

  it("seeds nothing: no INSERT statements anywhere in migrations", () => {
    const migrationsDir = path.join(ROOT, "prisma", "migrations");
    const dirs = readdirSync(migrationsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
    expect(dirs.length).toBeGreaterThan(0);
    for (const dir of dirs) {
      const sql = readFileSync(path.join(migrationsDir, dir.name, "migration.sql"), "utf8");
      expect(sql, `${dir.name} must not insert seed data`).not.toMatch(/INSERT\s+INTO/i);
    }
  });

  it("initial migration is non-destructive (no DROP/TRUNCATE/ALTER COLUMN)", () => {
    const migrationsDir = path.join(ROOT, "prisma", "migrations");
    for (const dir of readdirSync(migrationsDir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
      const sql = readFileSync(path.join(migrationsDir, dir.name, "migration.sql"), "utf8");
      expect(sql).not.toMatch(/\bDROP\s+(TABLE|TYPE|COLUMN|INDEX)\b/i);
      expect(sql).not.toMatch(/\bTRUNCATE\b/i);
      expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
      expect(sql).not.toMatch(/\bALTER\s+TABLE\b[^;]*\bDROP\s+COLUMN\b/i);
    }
  });

  it("RLS artifact isolates demo scope and keeps audit/movements append-only", () => {
    const rls = readFileSync(path.join(ROOT, "prisma", "rls-demo-isolation.sql"), "utf8");
    expect(rls).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(rls).toMatch(/FORCE ROW LEVEL SECURITY/);
    expect(rls).toMatch(/app\.data_scope/);
    // append-only tables must NOT declare UPDATE/DELETE policies
    const auditPolicies = rls.split("\n").filter((l) => l.includes('ON "AuditEvent"'));
    expect(auditPolicies.join("\n")).not.toMatch(/FOR\s+(UPDATE|DELETE)/i);
    const movementPolicies = rls.split("\n").filter((l) => l.includes('ON "InventoryMovement"'));
    expect(movementPolicies.join("\n")).not.toMatch(/FOR\s+(UPDATE|DELETE)/i);
    // every policy creation has a documented rollback line
    const creates = rls.match(/CREATE POLICY (\w+)/g) ?? [];
    const drops = rls.match(/DROP POLICY (\w+)/g) ?? [];
    expect(drops.length).toBe(creates.length);
  });

  it("Phase 8 tenant artifact is fail-closed and additive (never applied here)", () => {
    const tenant = readFileSync(path.join(ROOT, "prisma", "rls-tenant-isolation.sql"), "utf8");
    // every tenant-owned table has a policy; org predicate on each
    for (const table of [
      "Order", "OrderItem", "Payment", "Refund", "SettlementBatch",
      "MenuCategory", "MenuItem", "Ingredient", "Recipe", "RecipeItem",
      "InventoryMovement", "SequenceCounter", "IdempotencyRecord", "Approval", "AuditEvent",
    ]) {
      expect(tenant, `missing policy for ${table}`).toMatch(new RegExp(`ON "${table}"`));
    }
    expect(tenant).toMatch(/current_setting\('app\.organization_id', false\)/);
    // absent context must THROW (missing_ok=false), never fail open
    expect(tenant).not.toMatch(/current_setting\('app\.[^']+', true\)/);
    // FORCE on every RLS table including audit (owner also gated)
    expect(tenant).toMatch(/"AuditEvent" FORCE ROW LEVEL SECURITY/);
    // no destructive DDL, no seed data
    expect(tenant).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX)\b/i);
    expect(tenant).not.toMatch(/INSERT\s+INTO/i);
    // bootstrap identity tables deliberately excluded (documented)
    expect(tenant).toContain("Organization/Outlet/User/Membership");
  });
});
