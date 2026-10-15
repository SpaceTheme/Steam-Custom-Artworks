#!/usr/bin/env bash
# Commits artworks/ (including artworks/manifest.json) and pushes to main, retrying when other
# workflows pushed in between.
#
# Usage: scripts/push-changes.sh "<commit message>"
#
# artworks/manifest.json is derived from the artwork folders, so a rebase conflict in it (two
# requests processed at the same time) is solved by rebuilding it instead of failing the push.
set -uo pipefail

message="$1"

git config user.name "GitHub Action"
git config user.email "action@github.com"
git add -A artworks
if git diff --staged --quiet; then
  echo "No changes to commit"
  exit 0
fi
git commit -q -m "$message"

for attempt in $(seq 1 10); do
  if git pull -q --rebase --autostash origin main; then
    git push -q origin HEAD:main && { echo "Pushed on attempt $attempt"; exit 0; }
  else
    conflicts=$(git diff --name-only --diff-filter=U)
    if [ "$conflicts" = "artworks/manifest.json" ]; then
      echo "Rebuilding artworks/manifest.json after a merge conflict"
      node scripts/build-manifest.js && git add artworks/manifest.json \
        && GIT_EDITOR=true git rebase --continue \
        && git push -q origin HEAD:main && { echo "Pushed on attempt $attempt"; exit 0; }
    fi
    git rebase --abort 2>/dev/null || true
  fi
  sleep $((attempt * 5))
done

echo "::error::Failed to push after 10 attempts"
exit 1
