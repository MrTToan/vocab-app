import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    // Mirror tsconfig's `@/*` so route handlers (which import `@/lib/...`) can
    // be exercised directly in tests.
    alias: { "@": path.resolve(__dirname) },
  },
  test: { environment: "node" },
});
