# Word progression — the stage ladder & smart picker

## The five-rung ladder
Every word climbs: **New → Recognition → Recall → Production → Known**.

- Answer a word **correctly** → it moves **up** one rung.
- A **near-miss** (a small typo) also counts as progress and moves it **up** — typos don't stall you.
- Answer **incorrectly** → it drops **down** one rung (never below New).

**Mastery is streak-based:** get a word right **4 times in a row** (near-misses count) and it jumps
straight to **Known** and retires from rotation. A wrong answer breaks the streak. So the way to make a
word "disappear" is simply to keep getting it right a few times running. (Plain climbing tops out at
Production; only a clean streak promotes to Known — so a word does at least one write/translate/scenario
rep before it graduates.)

## The exercise changes as a word climbs
Each stage asks for a harder kind of recall:

| Stage | What you do |
|---|---|
| New | Flashcard (recognise both directions) |
| Recognition | Cloze — fill the blank |
| Recall | Type the word from its meaning |
| Production / Known | Write / translate / use it in a scenario (AI-scored) |

## You don't choose — Lexi does
The picker keeps a working **"active set" of about 35 words** in rotation and drills them until they
graduate, topping the set up with new words as mastered ones leave. Priority goes to words you
**recently got wrong** or **haven't seen in a few days**; mastered words fade out. To jump straight to
random brand-new words on demand, use [Explore mode](explore-mode.md).

Your accuracy is measured over your **last five answers** per word (correct = 1, near-miss = ½,
wrong = 0).

---
*Under the hood: `lib/engine.ts` (`applyResult`, `pickNext`, `exerciseForStage`, `weightFor`), `lib/ui.ts` (`isWeak`).*
