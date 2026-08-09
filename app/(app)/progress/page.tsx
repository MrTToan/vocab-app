import { redirect } from "next/navigation";

// The progress dashboard moved into the standalone cross-skill /report.
// Kept as a redirect so old links/bookmarks still work.
export default function ProgressRedirect() {
  redirect("/report");
}
