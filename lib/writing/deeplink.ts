/**
 * Deep-linking to a specific writing question. Each prompt already has a stable
 * `id`; the writing page reflects the selected one in the URL as `?q=<id>` so a
 * question can be referred to / shared by copying its link. Pure helpers here;
 * the `window`-touching read/write live in the client component.
 */

/** The question id to select on load: the `?q=<id>` deep-link target when it's
 *  in the visible list, else the first question (or null when the list is empty). */
export function pickInitialId(prompts: { id: string }[], q: string | null): string | null {
  if (q && prompts.some((p) => p.id === q)) return q;
  return prompts[0]?.id ?? null;
}
