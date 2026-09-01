import { NextResponse } from "next/server";
import { currentUserId, isOwner } from "@/lib/auth/user";
import { adminStats } from "@/lib/admin/stats";

/*
 * Owner-only admin metrics. Reuses the app's single identity choke point
 * (currentUserId) and the existing owner check (isOwner) — no new auth scheme.
 * A non-owner (or unauthenticated caller) gets a flat 403 with no data, so the
 * endpoint can never leak another user's activity to a normal account.
 */
export async function GET() {
  const userId = await currentUserId();
  if (!userId || !isOwner(userId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const stats = await adminStats();
  return NextResponse.json(stats);
}
