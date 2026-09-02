import { redirect } from "next/navigation";
import { currentUserId, resolveIsOwner } from "@/lib/auth/user";

// The self-serve "Add a question" flow has been retired: writing questions are
// now an ADMIN-managed bank. Admins manage them from the admin portal's
// "Writing Questions" subtab; everyone else is sent back to the writing home.
// Kept as a redirect so old bookmarks/links don't 404.
export const dynamic = "force-dynamic";

export default async function AddWritingPromptRedirect() {
  const userId = await currentUserId();
  if (userId && (await resolveIsOwner(userId))) redirect("/admin?tab=writing");
  redirect("/writing");
}
