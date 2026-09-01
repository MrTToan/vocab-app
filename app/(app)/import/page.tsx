import { redirect } from "next/navigation";

// Import was merged into the combined Add page. Kept as a redirect so old
// links/bookmarks land straight on the importer tab.
export default function ImportRedirect() {
  redirect("/add?tab=import");
}
