import { describe, expect, it } from "vitest";
import { convertQuantity, toBase, howManyFit, BASE_UNIT } from "@/domain/inventory/units";
import { unwrap } from "@/domain/shared/result";
import { applyStockChange, validateBatch, isLowStock, isExpired } from "@/domain/inventory/stock";
import { computableProducible, buildDeductionPlan, validateRecipe, type Recipe } from "@/domain/inventory/recipes";
import type { StockMaterialRecord } from "@/domain/inventory/ports";
import { ERROR_CODES } from "@/domain/shared/errors";

describe("units", () => {
  it("converts within dimension", () => {
    expect(unwrap(convertQuantity(1, "kg", "g"))).toBe(1000);
    expect(unwrap(convertQuantity(2.5, "l", "ml"))).toBe(2500);
    expect(unwrap(convertQuantity(500, "g", "kg"))).toBeCloseTo(0.5);
    expect(unwrap(convertQuantity(3, "pc", "pc"))).toBe(3);
  });

  it("rejects cross-dimension conversion", () => {
    const r = convertQuantity(1, "kg", "ml");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(ERROR_CODES.UNIT_CONVERSION_IMPOSSIBLE);
  });

  it("base units and fit calculation", () => {
    expect(toBase(2, "kg")).toBe(2000);
    expect(BASE_UNIT.mass).toBe("g");
    expect(BASE_UNIT.volume).toBe("ml");
    expect(howManyFit(2500, 1000)).toBe(2);
    expect(howManyFit(500, 1000)).toBe(0);
    expect(howManyFit(3, 1)).toBe(3);
  });
});

describe("stock rules", () => {
  it("rejects negative stock by default", () => {
    const r = applyStockChange(10, -20);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(ERROR_CODES.NEGATIVE_STOCK_FORBIDDEN);
    expect(unwrap(applyStockChange(10, -20, { allowNegative: true }))).toBe(-10);
  });

  it("batch validation fails fast", () => {
    const r = validateBatch([
      { currentQuantity: 100, delta: -50 },
      { currentQuantity: 10, delta: -20 },
      { currentQuantity: 0, delta: 999 },
    ]);
    expect(r.ok).toBe(false);
  });

  it("low stock + expiry", () => {
    expect(isLowStock(5, 10)).toBe(true);
    expect(isLowStock(11, 10)).toBe(false);
    expect(isExpired("2020-01-01", new Date("2026-01-01"))).toBe(true);
    expect(isExpired(null, new Date())).toBe(false);
  });
});

function material(overrides: Partial<StockMaterialRecord> = {}): StockMaterialRecord {
  return {
    id: "m1", tenantId: "ten_test", name: "Flour", unit: "g",
    quantity: 0, lowStockThreshold: 100, expiryDate: null,
    updatedAt: "2026-01-01T00:00:00.000Z", ...overrides,
  };
}

const recipe: Recipe = {
  id: "rec_1", tenantId: "ten_test", productId: "p1", yieldQuantity: 1,
  ingredients: [
    { materialId: "m1", quantity: 0.5, unit: "kg" },
    { materialId: "m2", quantity: 200, unit: "ml" },
  ],
};

describe("recipes", () => {
  const materials = [
    material({ id: "m1", unit: "g", quantity: 1200 }), // 1.2 kg → 2 × 0.5 kg
    material({ id: "m2", unit: "ml", quantity: 500 }), // 0.5 l → 2 × 200 ml
  ];

  it("computes producible quantity from limiting ingredient (positive stock)", () => {
    const p = computableProducible(recipe, materials);
    expect(p.units).toBe(2);
    expect(p.limitingMaterialId).toBeNull();
  });

  it("missing material ⇒ zero units (honest)", () => {
    const p = computableProducible({ ...recipe, ingredients: [recipe.ingredients[0]] }, [materials[1]]);
    expect(p.units).toBe(0);
    expect(p.limitingMaterialId).toBe("m1"); // the missing ingredient
  });

  it("builds deduction plan in material units (negative deltas)", () => {
    const plan = buildDeductionPlan(recipe, 2, materials);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value).toEqual([
      { materialId: "m1", delta: -1000, unit: "g" },
      { materialId: "m2", delta: -400, unit: "ml" },
    ]);
  });

  it("recipe validation rejects duplicates, bad yields, empty ingredients", () => {
    expect(validateRecipe(recipe).ok).toBe(true);
    expect(validateRecipe({ ...recipe, yieldQuantity: 0 }).ok).toBe(false);
    expect(validateRecipe({ ...recipe, ingredients: [] }).ok).toBe(false);
    expect(validateRecipe({
      ...recipe,
      ingredients: [recipe.ingredients[0], { ...recipe.ingredients[0] }],
    }).ok).toBe(false);
  });
});

