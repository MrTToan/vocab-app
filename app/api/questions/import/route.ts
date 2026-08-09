import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getStore } from "@/lib/store";
import { currentUserId } from "@/lib/auth/user";
import type { Question } from "@/lib/types";

/** POST { questions: Partial<Question>[] } -> inserts into the question bank. */
export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { questions } = (await req.json()) as { questions: Partial<Question>[] };
  if (!Array.isArray(questions) || questions.length === 0) {
    return NextResponse.json({ error: "questions required" }, { status: 400 });
  }
  const rows: Question[] = questions
    .filter((q) => q.word_id && q.type && q.payload)
    .map((q) => ({
      id: q.id || randomUUID(),
      word_id: q.word_id!,
      type: q.type as Question["type"],
      direction: q.direction || "",
      payload: q.payload!,
      answer: q.answer || "",
    }));
  await getStore().forUser(userId).addQuestions(rows);
  return NextResponse.json({ added: rows.length });
}
