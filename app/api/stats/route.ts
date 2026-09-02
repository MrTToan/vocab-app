import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { currentUserId } from "@/lib/auth/user";

/**
 * GET /api/stats — the learner's aggregate numbers for Home + the report page.
 * The aggregates are computed inside the store (in SQL on the SQLite backend;
 * see wordStats/attemptStats in lib/store.ts and the pure reference in
 * lib/stats.ts), so this route never loads every word and attempt into JS.
 * The response shape is byte-compatible with the old in-route computation.
 */
export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const store = getStore().forUser(userId);
  const [w, attempts] = await Promise.all([
    store.wordStats(),
    store.attemptStats(Date.now()),
  ]);
  return NextResponse.json({
    words: {
      total: w.total,
      practiced: w.practiced,
      mastered: w.mastered,
      weak: w.weak,
      stageCounts: w.stageCounts,
    },
    attempts,
    topSeen: w.topSeen,
  });
}
