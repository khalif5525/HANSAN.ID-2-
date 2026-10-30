import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    // Live-PostgreSQL suites are intentionally excluded from the default
    // no-database lane. They are fail-closed and require an explicitly
    // authorized disposable local database; run them via `npm run test:live-pg`.
    exclude: [...configDefaults.exclude, "tests/pg-live-*.test.ts"],
    environment: "node",
    passWithNoTests: false,
  },
});
