#!/usr/bin/env bash
# Overnight backstop: resume Lexi question-bank enrichment for any words that
# still have no bank. Runs at its scheduled time; deletes its own crontab line
# ONLY once the bank is complete (pending == 0), so if a run is cut short by the
# usage limit it simply retries at the next scheduled run and converges.
#
# Idempotent + cheap when idle: if nothing is pending it exits having spent almost
# nothing. Installed by request on 2026-08-02 as a safety net because the
# interactive session hit its usage limit (resets 3am ICT) before finishing.
set -uo pipefail

PROJ="/home/toan999/coding/vocab-app"
BASE="http://localhost:3001"
CLAUDE="/home/toan999/.local/bin/claude"
LOG="$PROJ/.data/overnight-resume.log"
MARK="lexi-overnight-resume"   # tag used to find/remove our own crontab line

exec >>"$LOG" 2>&1
echo "===== $(date) : overnight resume starting ====="

cd "$PROJ" || { echo "cd failed"; exit 1; }

# 2. Make sure the dev server is up (the interactive session's one may be gone).
if ! curl -sf "$BASE/api/config" >/dev/null 2>&1; then
  echo "dev server down -> starting 'npm run dev'"
  nohup npm run dev >>"$PROJ/.data/overnight-dev.log" 2>&1 &
  for _ in $(seq 1 30); do
    sleep 2
    curl -sf "$BASE/api/config" >/dev/null 2>&1 && break
  done
fi
if ! curl -sf "$BASE/api/config" >/dev/null 2>&1; then
  echo "dev server never came up; aborting"; exit 1
fi
echo "dev server is up"

# 3. Anything still pending?
PENDING=$(curl -s "$BASE/api/questions/pending" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['count'])" 2>/dev/null || echo "?")
echo "pending words: $PENDING"
if [ "$PENDING" = "0" ]; then
  echo "nothing to enrich; exiting cheaply."; exit 0
fi

# 4. Resume via a headless Claude session following the enrich-questions-bank skill.
#    Claude subagents author the questions (the user only trusts Claude for this) —
#    no external LLM. --dangerously-skip-permissions is required for unattended runs.
echo "launching headless claude to resume enrichment"
"$CLAUDE" -p "Resume the Lexi question-bank enrichment. The dev server is already running at $BASE. Use the enrich-questions-bank skill: for every word still returned by $BASE/api/questions/pending, generate its bank with Claude subagents (NO external LLM), 15 words per chunk, in rounds of ~10 subagents; apply each finished chunk with 'node scripts/apply-questions.mjs <file>'; repeat until the pending count is 0. Then stop." \
  --dangerously-skip-permissions

FINAL=$(curl -s "$BASE/api/questions/pending" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['count'])" 2>/dev/null || echo "?")
echo "pending now: $FINAL"

# Self-remove ONLY when the bank is complete; otherwise leave the cron in place so
# it retries at the next scheduled run (e.g. if the usage limit was hit again mid-run).
if [ "$FINAL" = "0" ]; then
  crontab -l 2>/dev/null | grep -v "$MARK" | crontab - && echo "complete -> crontab entry removed"
else
  echo "still $FINAL pending -> leaving crontab entry to retry next scheduled run"
fi
echo "===== $(date) : run finished ====="
