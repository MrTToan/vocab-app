import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { currentUserId } from "@/lib/auth/user";
import { exerciseForStage, pickNext } from "@/lib/engine";
import { generateExercise, hasProvider } from "@/lib/llm";
import { toCloze } from "@/lib/cloze";
import {
  clozeRaw,
  clozeFromSentence,
  translateQuestion,
  scenarioQuestion,
  saveHarvest,
} from "@/lib/harvest";
import {
  LLM_SCORED,
  type ExerciseType,
  type GeneratedExercise,
  type Question,
  type Word,
} from "@/lib/types";

/**
 * POST { seenIds: string[] } -> the next thing to practise:
 * { word, exerciseType, generated }.
 * Degrades gracefully with no API key: cloze is built locally from a stored
 * example; LLM-scored exercises fall back to type-from-definition.
 */
export async function POST(req: Request) {
  const { seenIds, explore } = (await req.json()) as {
    seenIds?: string[];
    explore?: boolean;
  };
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const store = getStore().forUser(userId);
  const words = await store.all();
  if (words.length === 0) {
    return NextResponse.json({ word: null });
  }

  const word = pickNext(words, Date.now(), new Set(seenIds ?? []), Math.random, {
    explore,
  });
  if (!word) return NextResponse.json({ word: null });

  let type: ExerciseType = exerciseForStage(word.stage);
  let generated: GeneratedExercise = {};

  // No scorer -> can't grade production tasks; drop to a locally-graded recall task.
  if (LLM_SCORED.includes(type) && !hasProvider("score")) type = "type_from_definition";

  // 1) Prefer a pre-generated question from the bank (diverse, no LLM latency).
  if (type === "cloze" || type === "translate" || type === "scenario") {
    const q = await store.pickQuestion(word.id, type);
    if (q) {
      if (type === "cloze") generated = { cloze_sentence: q.payload, answer: q.answer };
      else if (type === "translate")
        generated = {
          translate_source: q.payload,
          translate_direction: q.direction === "vn_to_en" ? "vn_to_en" : "en_to_vn",
        };
      else generated = { scenario_prompt: q.payload };
      return NextResponse.json({ word, exerciseType: type, generated });
    }
  }

  // 2) No bank question -> live generation / local fallback.
  try {
    if (type === "cloze") {
      if (hasProvider("generate")) {
        generated = await generateExercise(word, "cloze");
      } else {
        const local = localCloze(word);
        if (local) generated = { cloze_sentence: local };
        else type = "type_from_definition";
      }
    } else if (type === "translate") {
      const direction = Math.random() < 0.5 ? "vn_to_en" : "en_to_vn";
      generated = await generateExercise(word, "translate", direction);
    } else if (type === "scenario") {
      generated = await generateExercise(word, "scenario");
    }
  } catch {
    // generation failed -> safest usable fallback
    if (type === "cloze") {
      const local = localCloze(word);
      if (local) generated = { cloze_sentence: local };
      else type = "type_from_definition";
    } else {
      // translate/scenario failed -> plain write-a-sentence (still LLM-scored)
      type = "write_sentence";
      generated = {};
    }
  }

  // Persist a freshly generated / locally-built exercise so the bank self-refills
  // and we don't pay to regenerate it next time (deduped by deterministic id).
  // Only reached on the live path — bank-served questions returned earlier.
  const harvested: (Question | null)[] = [];
  if (type === "cloze" && generated.cloze_sentence) {
    harvested.push(
      clozeRaw(word.id, generated.cloze_sentence, generated.answer ?? word.word),
    );
  } else if (type === "translate" && generated.translate_source) {
    const dir =
      generated.translate_direction === "vn_to_en" ? "vn_to_en" : "en_to_vn";
    harvested.push(translateQuestion(word.id, dir, generated.translate_source));
    if (dir === "en_to_vn")
      harvested.push(
        clozeFromSentence(word.id, word.word, generated.translate_source),
      );
  } else if (type === "scenario" && generated.scenario_prompt) {
    harvested.push(scenarioQuestion(word.id, generated.scenario_prompt));
  }
  saveHarvest(store, harvested);

  return NextResponse.json({ word, exerciseType: type, generated });
}

/** Build a cloze locally by blanking the target word in a stored example. */
function localCloze(word: Word): string | null {
  const c = toCloze(word.example_simple || word.example_complex || "", word.word);
  return c ? c.payload : null;
}
