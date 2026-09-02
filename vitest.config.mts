import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// App code uses the `@/` alias from tsconfig; vitest needs the same mapping.
const alias = { "@": fileURLToPath(new URL(".", import.meta.url)) };

/**
 * Two vitest projects (see CONTRIBUTING.md → "Test layers"):
 *   - "node"  — the deterministic server half: pure logic, DB/store integration
 *     and route-handler integration (real temp SQLite). environment: "node".
 *   - "jsdom" — the stateful CLIENT half: React component render + interaction +
 *     SWR cache coherence (the layer where the practice check-answer and Library
 *     "+ Add" regressions lived). environment: "jsdom" + @vitejs/plugin-react.
 * `npm test` runs both. Coverage (v8) is printed per-directory so the client
 * half (`components/`, `lib/swr*.ts`) is a visible signal, not a silent void.
 */
export default defineConfig({
  resolve: { alias },
  test: {
    coverage: {
      provider: "v8",
      // Per-directory rollup so `components/` and `lib/swr*` at low coverage are
      // visible. `text-summary` prints the one-line totals; `text` the table.
      reporter: ["text", "text-summary"],
      include: ["lib/**", "components/**", "app/**"],
      // Config/entry files carry no assertable logic.
      exclude: ["**/*.d.ts", "**/layout.tsx", "**/loading.tsx", "instrumentation.ts"],
    },
    projects: [
      {
        resolve: { alias },
        test: {
          name: "node",
          environment: "node",
          // Every server-side test. Component tests are .tsx under tests/components.
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/components/**"],
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: ["tests/components/**/*.test.tsx"],
          setupFiles: ["tests/components/setup.ts"],
        },
      },
    ],
  },
});
