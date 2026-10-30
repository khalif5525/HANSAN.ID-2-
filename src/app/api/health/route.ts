import { NextResponse } from "next/server";
import { hasDatabase, hasSupabaseAuth } from "@/config/environment";

/**
 * Health endpoint — reports honest runtime configuration state (no secrets).
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    app: "hansan",
    phase: "Phase 0 — Project Foundation",
    status: "ok",
    integrations: {
      database: hasDatabase() ? "configured" : "not-configured",
      auth: hasSupabaseAuth() ? "configured" : "development-only-planned",
      payments: "not-configured",
    },
    timestamp: new Date().toISOString(),
  });
}
