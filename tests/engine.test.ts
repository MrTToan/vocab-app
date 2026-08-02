import { describe, it, expect } from "vitest";
import {
  recentAccuracy,
  exerciseForStage,
  applyResult,
  weightFor,
  pickNext,
  stageCounts,
  TARGET_ACTIVE,
} from "../lib/engine";
import { mkWord } from "./factory";

const NOW = 1_000_000_000_000;

describe("recentAccuracy", () => {
  it("is 0 with no history", () => {
    expect(recentAccuracy({ recent_results: [] })).toBe(0);
  });
  it("weights correct=1, partial=0.5, incorrect=0", () => {
    expect(recentAccuracy({ recent_results: ["correct", "correct"] })).toBe(1);
    expect(recentAccuracy({ recent_results: ["correct", "incorrect"] })).toBe(0.5);
    expect(recentAccuracy({ recent_results: ["partial", "partial"] })).toBe(0.5);
    expect(
      recentAccuracy({ recent_results: ["correct", "partial", "incorrect"] }),
    ).toBeCloseTo(0.5);
  });
});

describe("exerciseForStage", () => {
  it("maps early stages to fixed exercises", () => {
    expect(exerciseForStage("new")).toBe("flashcard");
    expect(exerciseForStage("recognition")).toBe("cloze");
    expect(exerciseForStage("recall")).toBe("type_from_definition");
  });
  it("maps production/known to a production exercise", () => {
    const prod = ["write_sentence", "translate", "scenario"];
    expect(prod).toContain(exerciseForStage("production"));
    expect(prod).toContain(exerciseForStage("known"));
  });
});

describe("applyResult", () => {
  const base = {
    stage: "new" as const,
    times_seen: 0,
    recent_results: [],
    last_seen_at: null,
  };

  it("advances one stage on correct", () => {
    expect(applyResult({ ...base, stage: "new" }, "correct", NOW).stage).toBe(
      "recognition",
    );
    expect(
      applyResult({ ...base, stage: "recognition" }, "correct", NOW).stage,
    ).toBe("recall");
    expect(applyResult({ ...base, stage: "recall" }, "correct", NOW).stage).toBe(
      "production",
    );
  });

  it("masters after 4 non-incorrect answers in a row, from any stage", () => {
    let w = applyResult(
      { stage: "new", times_seen: 0, recent_results: [], last_seen_at: null },
      "correct",
      NOW,
    ); // -> recognition
    w = applyResult(w, "correct", NOW); // -> recall
    w = applyResult(w, "correct", NOW); // -> production
    expect(w.stage).toBe("production"); // 3 in a row: reaches production, not yet known
    w = applyResult(w, "correct", NOW); // 4 in a row -> known
    expect(w.stage).toBe("known");
  });

  it("counts a near-miss (partial) toward the mastery streak", () => {
    let w = applyResult(
      { stage: "new", times_seen: 0, recent_results: [], last_seen_at: null },
      "correct",
      NOW,
    );
    w = applyResult(w, "correct", NOW);
    w = applyResult(w, "correct", NOW);
    w = applyResult(w, "partial", NOW); // partial still counts -> known
    expect(w.stage).toBe("known");
  });

  it("does not master when the last 4 include an incorrect; climb caps at production", () => {
    const w = applyResult(
      {
        stage: "production",
        times_seen: 10,
        recent_results: ["correct", "incorrect", "correct"],
        last_seen_at: null,
      },
      "correct",
      NOW,
    );
    expect(w.stage).toBe("production"); // no streak, and a plain climb never exceeds production
  });

  it("keeps known on correct", () => {
    expect(
      applyResult({ ...base, stage: "known", times_seen: 20 }, "correct", NOW).stage,
    ).toBe("known");
  });

  it("drops one stage on incorrect, floored at new", () => {
    expect(applyResult({ ...base, stage: "recall" }, "incorrect", NOW).stage).toBe(
      "recognition",
    );
    expect(applyResult({ ...base, stage: "new" }, "incorrect", NOW).stage).toBe(
      "new",
    );
  });

  it("advances on a partial (a near-miss is progress, not a stall)", () => {
    const r = applyResult(
      { stage: "recall", times_seen: 3, recent_results: [], last_seen_at: null },
      "partial",
      NOW,
    );
    expect(r.stage).toBe("production"); // recall -> production; partial is no longer a no-op
    expect(r.times_seen).toBe(4);
    expect(r.last_seen_at).toBe(NOW);
  });

  it("caps recent_results at 5", () => {
    const r = applyResult(
      {
        stage: "new",
        times_seen: 5,
        recent_results: ["correct", "correct", "correct", "correct", "correct"],
        last_seen_at: null,
      },
      "incorrect",
      NOW,
    );
    expect(r.recent_results).toHaveLength(5);
    expect(r.recent_results[4]).toBe("incorrect");
  });
});

describe("weightFor", () => {
  it("weights a recently-wrong word above a recently-right one", () => {
    const wrong = mkWord({ stage: "recognition", recent_results: ["incorrect"], last_seen_at: NOW });
    const right = mkWord({ stage: "recognition", recent_results: ["correct"], last_seen_at: NOW });
    expect(weightFor(wrong, NOW)).toBeGreaterThan(weightFor(right, NOW));
  });
  it("fades known words to the floor weight", () => {
    const known = mkWord({ stage: "known", recent_results: ["correct"], last_seen_at: NOW });
    expect(weightFor(known, NOW)).toBe(0.1);
  });
});

describe("pickNext", () => {
  it("returns null when there are no words", () => {
    expect(pickNext([], NOW, new Set())).toBeNull();
  });
  it("skips words in the cooldown set", () => {
    const a = mkWord({ id: "a" });
    const b = mkWord({ id: "b" });
    const picked = pickNext([a, b], NOW, new Set(["a"]), () => 0);
    expect(picked?.id).toBe("b");
  });
  it("still returns a word when every candidate is in cooldown", () => {
    const a = mkWord({ id: "a" });
    const picked = pickNext([a], NOW, new Set(["a"]), () => 0);
    expect(picked?.id).toBe("a");
  });

  it("keeps drilling the active set when it is full (>= TARGET_ACTIVE)", () => {
    const active = Array.from({ length: TARGET_ACTIVE }, (_, i) =>
      mkWord({ id: `a${i}`, times_seen: 3, stage: "recognition" }),
    );
    const fresh = mkWord({ id: "f1", times_seen: 0 });
    const picked = pickNext([...active, fresh], NOW, new Set(), () => 0);
    expect(picked?.times_seen).toBeGreaterThan(0); // a started word, not the fresh one
  });

  it("explore mode returns a fresh word even when the active set is full", () => {
    const active = Array.from({ length: 6 }, (_, i) =>
      mkWord({ id: `a${i}`, times_seen: 3, stage: "recognition" }),
    );
    const fresh = [
      mkWord({ id: "f1", times_seen: 0 }),
      mkWord({ id: "f2", times_seen: 0 }),
    ];
    const picked = pickNext([...active, ...fresh], NOW, new Set(), () => 0, {
      explore: true,
    });
    expect(picked?.times_seen).toBe(0);
  });

  it("explore mode falls back to any word once all have been started", () => {
    const started = [
      mkWord({ id: "a", times_seen: 2, stage: "recall" }),
      mkWord({ id: "b", times_seen: 5, stage: "production" }),
    ];
    const picked = pickNext(started, NOW, new Set(), () => 0, { explore: true });
    expect(picked).not.toBeNull();
  });
});

describe("stageCounts", () => {
  it("counts words per stage and zero-fills empty stages", () => {
    const counts = stageCounts([
      mkWord({ id: "1", stage: "new" }),
      mkWord({ id: "2", stage: "new" }),
      mkWord({ id: "3", stage: "known" }),
    ]);
    expect(counts).toEqual({
      new: 2,
      recognition: 0,
      recall: 0,
      production: 0,
      known: 1,
    });
  });
});
