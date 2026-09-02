/**
 * Conservative English lemmatizer for DEDUP KEYING only.
 *
 * The paste importer treats two words that share a base form as the same word
 * ("running" ≡ "run", "studies" ≡ "study") so the same lemma is never imported
 * twice and an existing word is tagged rather than duplicated. This is
 * deliberately a *lemma key* generator, not a linguistics-grade lemmatizer: the
 * exact base string matters far less than that inflections of one word map to
 * the SAME stable key while clearly-distinct words do NOT collide.
 *
 * Design bias — UNDER-merge, never over-merge. Per the feature brief, when a
 * rule is ambiguous we prefer the safer (less aggressive) behaviour: a missed
 * merge just lets a near-duplicate through occasionally; a false merge silently
 * drops a word the user wanted. So we:
 *   - only lemmatize single alphabetic tokens (phrases, hyphenated compounds and
 *     anything with digits/punctuation dedupe by their normalized form as-is);
 *   - handle ONLY inflectional endings (plural -s/-es/-ies, verb -ing/-ed and a
 *     curated irregular list) — never derivational ones (-ly, -ness, -tion,
 *     comparative -er/-est), so "quick"≠"quickly", "happy"≠"happiness",
 *     "run"≠"runner", "big"≠"bigger" all stay separate;
 *   - keep minimum-stem-length guards so short words ("us"≠"used", "is", "bus")
 *     are left alone;
 *   - keep a small stoplist of invariant -s words ("news", "series") that look
 *     plural but aren't.
 *
 * Known accepted limitations (documented, safe direction = under-merge):
 * "make"/"making", "go"/"going", "use"/"used" do NOT merge (short e-restoring
 * stems are too ambiguous to attempt without a dictionary).
 */

/** Inflected form → base form. Curated to avoid homographs (no "saw"→see,
 *  "left"→leave, "found"→find, "felt"→feel, "thought"→think, "rung"→ring …). */
const IRREGULAR: Record<string, string> = {
  // irregular plural nouns
  children: "child",
  men: "man",
  women: "woman",
  feet: "foot",
  teeth: "tooth",
  geese: "goose",
  mice: "mouse",
  oxen: "ox",
  // irregular verbs (past / participle → base); base forms map to themselves so
  // an already-base word next to its inflection keys identically.
  ran: "run",
  went: "go",
  gone: "go",
  made: "make",
  said: "say",
  took: "take",
  taken: "take",
  came: "come",
  gave: "give",
  given: "give",
  knew: "know",
  known: "know",
  wrote: "write",
  written: "write",
  spoke: "speak",
  spoken: "speak",
  broke: "break",
  broken: "break",
  chose: "choose",
  chosen: "choose",
  drove: "drive",
  driven: "drive",
  ate: "eat",
  eaten: "eat",
  flew: "fly",
  flown: "fly",
  grew: "grow",
  grown: "grow",
  threw: "throw",
  thrown: "throw",
  drew: "draw",
  drawn: "draw",
  began: "begin",
  begun: "begin",
  bought: "buy",
  brought: "bring",
  taught: "teach",
  caught: "catch",
  sent: "send",
  spent: "spend",
  told: "tell",
  paid: "pay",
  sat: "sit",
  stood: "stand",
  understood: "understand",
  met: "meet",
  kept: "keep",
  held: "hold",
  built: "build",
};

/** Words that end in "s" but are not plurals/3rd-person forms — never stem. */
const NEVER_STEM = new Set<string>([
  "news",
  "series",
  "species",
  "physics",
  "mathematics",
  "maths",
  "economics",
  "politics",
  "ethics",
  "statistics",
  "means",
  "series",
  "lens",
  "bias",
  "gas",
  "always",
  "perhaps",
  "sometimes",
  "analysis",
  "basis",
  "crisis",
  "focus",
  "status",
  "virus",
  "bonus",
  "campus",
]);

/** Lower/trim, NFC-normalize, collapse internal whitespace. */
export function normalizeText(raw: string): string {
  return (raw ?? "").normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Collapse a trailing doubled consonant (runn→run, stopp→stop). Vowels and a
 *  single trailing consonant are left alone. */
function undouble(base: string): string {
  const n = base.length;
  if (n >= 3) {
    const a = base[n - 1];
    const b = base[n - 2];
    if (a === b && !"aeiou".includes(a)) return base.slice(0, -1);
  }
  return base;
}

/** Apply the first matching inflectional rule; otherwise return `s` unchanged. */
function stem(s: string): string {
  const n = s.length;

  // -ing gerund/participle: require a ≥4-char stem so nouns that merely end in
  // "ing" (thing, king, wing) and very short gerunds are left alone.
  if (s.endsWith("ing")) {
    const base = s.slice(0, -3);
    if (base.length >= 4) return undouble(base);
    return s;
  }
  // -ied → y (studied→study, tried→try)
  if (n >= 5 && s.endsWith("ied")) return s.slice(0, -3) + "y";
  // -eed → drop only the d (agreed→agree, freed→free)
  if (n >= 5 && s.endsWith("eed")) return s.slice(0, -1);
  // -ed past tense: require a ≥4-char stem (used→"us" is blocked, stays "used").
  if (s.endsWith("ed")) {
    const base = s.slice(0, -2);
    if (base.length >= 4) return undouble(base);
    return s;
  }
  // -ies → y (studies→study, tries→try)
  if (n >= 5 && s.endsWith("ies")) return s.slice(0, -3) + "y";
  // sibilant + es → drop es (boxes→box, wishes→wish, matches→match, glasses→glass)
  if (n >= 5 && /(?:ss|sh|ch|x|z)es$/.test(s)) return s.slice(0, -2);
  // plural / 3rd-person -s → drop s, guarded: not -ss/-us/-is, ≥3-char result.
  if (
    n >= 4 &&
    s.endsWith("s") &&
    !s.endsWith("ss") &&
    !s.endsWith("us") &&
    !s.endsWith("is") &&
    s.length - 1 >= 3
  ) {
    return s.slice(0, -1);
  }
  return s;
}

/**
 * Reduce a word/phrase to its lemma key for dedup. Idempotent: lemma(lemma(x))
 * === lemma(x) for the words the rules touch, so a base form and its inflections
 * share one key.
 */
export function lemma(raw: string): string {
  const s = normalizeText(raw);
  if (!s) return "";
  // Only single alphabetic tokens are lemmatized — the conservative choice for
  // phrases ("get away with"), hyphenated compounds and anything non-alphabetic.
  if (!/^[a-z]+$/.test(s)) return s;
  if (NEVER_STEM.has(s)) return s;
  if (IRREGULAR[s]) return IRREGULAR[s];
  return stem(s);
}

export interface LemmaDedup {
  /** Unique entries by lemma, first-seen surface form kept, in order. */
  unique: string[];
  /** How many entries were dropped as lemma-repeats within the input. */
  duplicateCount: number;
}

/**
 * De-duplicate a list of words by lemma, keeping the first-seen surface form.
 * Blank entries are dropped. Used to collapse "run", "running", "runs" (and
 * repeats) within one pasted list before any library check or enrichment.
 */
export function dedupeByLemma(words: string[]): LemmaDedup {
  const unique: string[] = [];
  const seen = new Set<string>();
  let duplicateCount = 0;
  for (const w of words) {
    const surface = (w ?? "").trim();
    if (!surface) continue;
    const key = lemma(surface);
    if (!key) continue;
    if (seen.has(key)) {
      duplicateCount++;
      continue;
    }
    seen.add(key);
    unique.push(surface);
  }
  return { unique, duplicateCount };
}
