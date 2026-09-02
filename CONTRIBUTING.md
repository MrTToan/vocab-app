# Contributing

## Local gate

Before opening a PR, run the same checks CI does:

```bash
npm test          # both vitest projects (node + jsdom)
npm run typecheck # tsc --noEmit
npm run build     # next build
```

`npm run lint` is intentionally **non-blocking** in CI (a wall of pre-existing
`no-explicit-any` errors); `next build` does not gate on it either.

## Test layers

Tests live under `tests/` and run through **two vitest projects** (configured in
`vitest.config.mts`, both under one `npm test`). Put a new test in the project
whose environment matches the layer it exercises:

| Project | `environment` | Covers | Lives in |
|---|---|---|---|
| **node** | `node` | The deterministic **server half**: pure `lib/*` logic, DB/store integration (real temp SQLite), and route-handler integration (exported Next handlers driven by plain `Request`s). | `tests/**/*.test.ts` (all `.ts`) |
| **jsdom** | `jsdom` | The stateful **client half**: React component render + interaction + SWR cache coherence. `@vitejs/plugin-react` + `@testing-library/react`; `/api/*` is stubbed with a `vi` fetch mock (see `tests/components/harness.tsx`). | `tests/components/**/*.test.tsx` |

Why two projects: the suite used to run entirely in `environment: "node"`, so it
was deep on the server half and **blind on the client half** — several
user-facing regressions (the practice "Check my answer" render, the Library
"+ Add" cache desync) shipped green because no test could render a component or
exercise the SWR cache. The `jsdom` project closes that blind spot.

**Per-layer intent — pick the cheapest layer that can see the bug:**

- **Pure logic / reducers** (`tests/*.test.ts`, node) — a function's input→output.
  The Library SWR cache reducers are pure and hook-free in `lib/swr-cache.ts` so
  they're unit-tested here (`tests/swr-cache.test.ts`) without a browser.
- **DB / query-plan** (`tests/db.test.ts`, node) — schema, cascades, and an
  `EXPLAIN QUERY PLAN` sweep asserting hot/cascade queries never full-`SCAN` a
  user-growth table (the class behind the ~5s delete).
- **Route integration** (`tests/routes/*.test.ts`, node) — the HTTP envelope:
  auth/validation boundaries + server correctness against temp SQLite.
- **Component** (`tests/components/*.test.tsx`, jsdom) — render → interact →
  assert the DOM/state, and SWR cache coherence end-to-end. This is the only
  layer that sees client render/state/cache-wiring bugs.

`jsdom` is not a real browser: it catches state/render/cache-wiring regressions,
**not** CSS/layout or true network/deploy behaviour.

## Coverage

CI runs `npm run test:coverage` (v8) and prints a **per-directory** table so the
client layer (`components/`, `lib/swr*.ts`) is a visible signal rather than a
silent 0%. Coverage is reported, not yet gated.

## Regression discipline

A **bug-fix PR must ship a failing-first regression test.** CI enforces this: a
PR labelled `bug` must include a `tests/**` change (`bug-fix-needs-test` job).
Add the test at the cheapest layer that reproduces the bug (see the table above).
