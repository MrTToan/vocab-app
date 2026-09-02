#!/usr/bin/env bash
# Pre-deploy guard: the `deploy` shortcut rsyncs the WORKING TREE, so deploying
# with uncommitted changes or from a commit that isn't on origin/main ships
# code that no one can reproduce from git. Call this first; it exits non-zero
# (and prints why) unless the tree is clean and HEAD is on origin/main.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

dirty="$(git status --porcelain)"
if [ -n "$dirty" ]; then
  echo "deploy-check: refusing to deploy — working tree is not clean:" >&2
  echo "$dirty" >&2
  echo "Commit/push your changes, or set them aside with: git stash push --include-untracked -m predeploy" >&2
  exit 1
fi

git fetch -q origin main
if ! git merge-base --is-ancestor HEAD origin/main; then
  echo "deploy-check: refusing to deploy — HEAD ($(git rev-parse --short HEAD)) is not on origin/main." >&2
  echo "Push your branch and merge it (or check out main) before deploying." >&2
  exit 1
fi

echo "deploy-check: ok — clean tree at $(git rev-parse --short HEAD) on origin/main"
