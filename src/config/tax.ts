/**
 * POS tax configuration (Phase 4).
 *
 * Honest default: 0% until a rate is approved/configured (Phase 7 finance
 * rules). This NEVER invents a tax rate — totals compute with no tax until a
 * rate is explicitly provided via POS_TAX_PERCENT (0–100).
 */
export interface PosTaxConfig {
  percent: number;
  label: string;
}

export function getTaxConfig(): PosTaxConfig {
  const raw = process.env.POS_TAX_PERCENT;
  const parsed = raw !== undefined ? Number(raw) : NaN;
  const percent = Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 0;
  return { percent, label: percent > 0 ? `Tax (${percent}%)` : "Tax not configured" };
}
