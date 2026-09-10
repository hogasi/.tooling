#!/usr/bin/env bash
set -euo pipefail

endpoint="repos/${GITHUB_REPOSITORY}/${TARGET}/reactions"

case "$1" in
  start)
    echo "target=${TARGET}" >> "$GITHUB_OUTPUT"
    if id=$(gh api "$endpoint" --method POST -f content=eyes --jq '.id'); then
      echo "id=${id}" >> "$GITHUB_OUTPUT"
    else
      echo "::warning::Could not add the start reaction; continuing the agent run."
    fi
    ;;
  finish)
    if [ -n "${REACTION:-}" ]; then
      if ! gh api "${endpoint}/${REACTION}" --method DELETE; then
        echo "::warning::Could not remove the start reaction."
      fi
    fi
    if [ "$OUTCOME" = "success" ]; then
      content=rocket
    else
      content=confused
    fi
    if ! gh api "$endpoint" --method POST -f "content=${content}" >/dev/null; then
      echo "::warning::Could not add the outcome reaction; the agent result is unchanged."
    fi
    ;;
  *)
    echo "Usage: reaction.sh start|finish" >&2
    exit 1
    ;;
esac
