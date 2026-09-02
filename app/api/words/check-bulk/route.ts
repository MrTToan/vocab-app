import { withUser } from "@/lib/api";
import { checkBulkSchema } from "@/lib/api-schemas";
import { getStore, normalizeWord } from "@/lib/store";

/**
 * POST /api/words/check-bulk  { words: string[] }
 * -> { existing: string[] }  (the subset already in the user's library)
 *
 * The cheap, no-LLM cost-control gate for the paste importer: the client shows
 * "N new · M already in your list" before spending any enrichment quota.
 * Case-insensitive, trimmed. Returns the words (as sent) that already exist.
 */
export const POST = withUser(checkBulkSchema, async ({ userId, input }) => {
  const store = getStore().forUser(userId);
  // One indexed IN(...) query over the pasted words — never loads the library.
  const have = await store.existingWords(input.words);

  const existing = input.words.filter((w) => w?.trim() && have.has(normalizeWord(w)));
  return { existing };
});
