import type { Word, Stage, Result } from "../lib/types";

/** Build a Word with sensible defaults; override only what a test cares about. */
export function mkWord(over: Partial<Word> = {}): Word {
  return {
    id: over.id ?? "w1",
    word: "example",
    part_of_speech: "noun",
    ipa: "",
    vi_meaning: "ví dụ",
    definition_en: "",
    synonyms: [],
    collocations: [],
    example_simple: "",
    example_complex: "",
    false_friend_note: "",
    personal_note: "",
    tags: [],
    source: "manual",
    stage: "new" as Stage,
    times_seen: 0,
    recent_results: [] as Result[],
    last_seen_at: null,
    created_at: 0,
    ...over,
  };
}
