import { redirect } from "next/navigation";

// Collections management moved into the Home page (/vocab). Kept as a redirect
// so old links/bookmarks still work: land on Home and jump to the collections
// section, carrying any ?collection=<id> deep-link through so it highlights the
// right set.
export default async function CollectionsRedirect({
  searchParams,
}: {
  searchParams: Promise<{ collection?: string }>;
}) {
  const { collection } = await searchParams;
  const query = collection ? `?collection=${encodeURIComponent(collection)}` : "";
  redirect(`/vocab${query}#collections`);
}
