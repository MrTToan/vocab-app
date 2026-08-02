# Explore mode — the 🔀 "new words" toggle

## What it does
On the practice screen there's a **🔀 Explore new words** button (top-right). Press it and the whole
session switches to serving **random words you haven't started yet**. Press it again
(**✓ Exploring — back to review**) to return to normal spaced review.

## Why it exists
Normally Lexi keeps a working set of ~35 words and drills them until they're mastered (see
[Word progression](word-progression.md)). That's great for retention but means you can feel "stuck" on
the same handful — especially with a large vocabulary. Explore mode is the escape hatch: it ignores the
active set and pulls fresh words on demand, so you can browse breadth whenever you like.

## Good to know
- It's **off by default** — your normal spaced-repetition behaviour is unchanged unless you turn it on.
- Once you've *started* every word at least once, Explore falls back to any word not shown very recently.
- Words you meet in Explore mode enter normal rotation afterwards, just like any other word you've seen.

---
*Under the hood: `lib/engine.ts` (`pickNext(..., { explore })`), `app/practice/page.tsx` (the toggle), `app/api/practice/next` (the `explore` flag).*
