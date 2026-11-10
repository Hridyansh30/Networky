#!/usr/bin/env bash
# Prints which apps a change touches, as the JSON matrix the CI jobs use:
#   apps=[{"name":"workspace","dir":"."},{"name":"landing","dir":"landing"}]
#
# Rules
#   landing/**            -> landing
#   .github/**            -> both (the pipeline itself changed)
#   anything else         -> workspace
#   *.md, docs/**, LICENSE are ignored (no build is affected)
# Unknown history (new branch, force push, manual run) -> both, to be safe.
#
# Inputs (env): EVENT, PR_BASE, PUSH_BEFORE. Optional CHANGED_FILES overrides
# the git diff (used by the self-test: .github/scripts/changed-apps.test.sh).
set -euo pipefail

all=1
files=""
if [ -n "${CHANGED_FILES+x}" ]; then
  files="$CHANGED_FILES"; all=0
elif [ "${EVENT:-}" = "pull_request" ] && [ -n "${PR_BASE:-}" ]; then
  # Three dots: only what the PR adds, not what main gained meanwhile.
  files="$(git diff --name-only "$PR_BASE"...HEAD)"; all=0
elif [ "${EVENT:-}" = "push" ] && [ -n "${PUSH_BEFORE:-}" ] \
     && [ "$PUSH_BEFORE" != "0000000000000000000000000000000000000000" ] \
     && git cat-file -e "$PUSH_BEFORE^{commit}" 2>/dev/null; then
  files="$(git diff --name-only "$PUSH_BEFORE" HEAD)"; all=0
fi

workspace=0
landing=0
if [ "$all" = 1 ]; then
  workspace=1; landing=1
else
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    case "$f" in
      .github/*)                      workspace=1; landing=1 ;;
      *.md|docs/*|LICENSE|LICENSE.*)  ;;
      landing/*)                      landing=1 ;;
      *)                              workspace=1 ;;
    esac
  done <<< "$files"
fi

# The landing app may not exist on every branch yet.
[ -f landing/package.json ] || landing=0

entries=()
[ "$workspace" = 1 ] && entries+=('{"name":"workspace","dir":"."}')
[ "$landing" = 1 ] && entries+=('{"name":"landing","dir":"landing"}')
apps="[$(IFS=,; echo "${entries[*]-}")]"

echo "Changed files:"; printf '%s\n' "$files" | sed 's/^/  /'
echo "apps=$apps"
if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "apps=$apps" >> "$GITHUB_OUTPUT"; fi
