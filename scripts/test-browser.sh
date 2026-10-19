#!/bin/sh
set -eu
task_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$task_root"
task_runner=$(mktemp -d /tmp/runsuncos-e2e.XXXXXX)
printf '%s\n' '{"private":true,"type":"commonjs"}' > "$task_runner/package.json"
task_version=$(docker compose exec -T dev node -p 'require("@playwright/test/package.json").version')
npm install --prefix "$task_runner" --silent "@playwright/test@$task_version"
mkdir -p "$task_runner/tests/e2e"
cp playwright.config.ts "$task_runner/playwright.config.ts"
cp tests/e2e/*.ts "$task_runner/tests/e2e/"
task_browser=${PLAYWRIGHT_CHROMIUM_EXECUTABLE:-}
if [ -z "$task_browser" ]; then task_browser=$(find "$HOME/.cache/ms-playwright" -type f -name chrome 2>/dev/null | sort | tail -n 1); fi
if [ -n "$task_browser" ]; then export PLAYWRIGHT_CHROMIUM_EXECUTABLE="$task_browser"; fi
printf 'Browser test artifacts: %s\n' "$task_runner"
"$task_runner/node_modules/.bin/playwright" test -c "$task_runner/playwright.config.ts"
