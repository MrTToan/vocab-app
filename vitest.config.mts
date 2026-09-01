import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Route-module tests (tests/routes/*) import app code that uses the `@/` alias
// from tsconfig; vitest needs the same mapping.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: { environment: "node" },
});
