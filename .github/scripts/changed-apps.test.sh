#!/usr/bin/env bash
# Self-test for changed-apps.sh. Run from the repo root:
#   bash .github/scripts/changed-apps.test.sh
set -euo pipefail
script="$(dirname "$0")/changed-apps.sh"
fail=0
W='{"name":"workspace","dir":"."}'
L='{"name":"landing","dir":"landing"}'

expect() { # $1 = description, $2 = files, $3 = expected apps
  local got
  got="$(CHANGED_FILES="$2" GITHUB_OUTPUT='' bash "$script" | sed -n 's/^apps=//p')"
  if [ "$got" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: got $got, want $3"; fail=1; fi
}

if [ -f landing/package.json ]; then
  expect "workspace source"     "src/ui/App.tsx"                  "[$W]"
  expect "landing source"       "landing/src/main.ts"             "[$L]"
  expect "both"                 $'src/a.ts\nlanding/index.html'   "[$W,$L]"
  expect "pipeline change"      ".github/workflows/ci.yml"        "[$W,$L]"
  expect "docs only"            $'README.md\ndocs/ci-cd.md'       "[]"
  expect "landing readme only"  "landing/README.md"               "[]"
  expect "root lockfile"        "package-lock.json"               "[$W]"
  expect "landing lockfile"     "landing/package-lock.json"       "[$L]"
else
  expect "workspace source"     "src/ui/App.tsx"                  "[$W]"
  expect "no landing app yet"   "landing/src/main.ts"             "[]"
  expect "pipeline change"      ".github/workflows/ci.yml"        "[$W]"
  expect "docs only"            "README.md"                       "[]"
fi
exit $fail
