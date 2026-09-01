import Link from "next/link";
import { currentUserId, isOwner } from "@/lib/auth/user";
import AdminDashboard from "@/components/admin/AdminDashboard";

// Resolve the owner gate per request (never prerender a static owner view that
// could ship to non-owners once auth is configured).
export const dynamic = "force-dynamic";

/*
 * Owner-only admin portal. Gated server-side so a non-owner never receives the
 * dashboard markup (defence in depth — the /api/admin/stats endpoint is the real
 * boundary and is owner-gated too). Reuses the app's identity choke point
 * (currentUserId) and the existing owner check (isOwner); no new auth scheme.
 */
export default async function AdminPage() {
  const userId = await currentUserId();
  if (!userId || !isOwner(userId)) return <Forbidden />;
  return <AdminDashboard />;
}

function Forbidden() {
  return (
    <div className="card p-6 space-y-2">
      <div className="text-2xl font-extrabold">403 — Not authorised</div>
      <p className="muted text-sm">
        The admin portal is restricted to the site owner.
      </p>
      <Link href="/vocab" className="btn btn-primary inline-flex mt-2 w-fit">
        Back to app
      </Link>
    </div>
  );
}
