/**
 * Next.js server-boot hook (see node_modules/next/dist/docs/01-app/03-api-reference/
 * 03-file-conventions/instrumentation.md): `register()` runs ONCE when a server
 * instance starts, before it serves requests. We open the single shared libSQL
 * client here (lib/db.ts), which also runs migrate() — so the schema work and
 * the connection cost are paid at deploy time, not by the first user request.
 * Node runtime only: the libSQL client (and fs/path) don't exist on Edge.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getDb } = await import("./lib/db");
    await getDb();
  }
}
