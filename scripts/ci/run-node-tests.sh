#!/usr/bin/env bash
# workspace（backend / frontend）の node:test を実行し、JUnit・標準出力・カバレッジ表を <workspace>/test-results/ に残す。
#   使い方: scripts/ci/run-node-tests.sh <workspace> <full|selected> [name-pattern]
#   full     : `npm run test`（全層。カバレッジのしきい値もここで強制される）
#   selected : 変更影響で選んだケースだけ。テスト名の正規表現を NODE_OPTIONS=--test-name-pattern で渡す
#              （backend/scripts/run-tests.js は追加引数を取らないため）。しきい値は全層のときだけ意味があるので test:unit / test:api を使う。
# 途中で失敗しても残りを回し、最後にまとめて終了コードを返す（「落ちたので他が見えない」を避ける）。
set -uo pipefail

ws="${1:?workspace}"
mode="${2:?full|selected}"
pattern="${3:-}"
out="$ws/test-results"
mkdir -p "$out"
status=0

has_script() { node -p "Boolean(require('./$ws/package.json').scripts['$1'])"; }

run() { # $1=ログ名 $2..=npm の引数
  local log="$out/test-output-$1.txt"
  shift
  npm run "$@" 2>&1 | tee "$log"
  [ "${PIPESTATUS[0]}" -eq 0 ] || status=1
}

if [ "$mode" = "selected" ]; then
  export NODE_OPTIONS="--test-name-pattern=$pattern"
  ran=0
  for layer in unit api; do
    if [ "$(has_script "test:$layer")" = "true" ]; then
      run "$layer" "test:$layer" -w "$ws"
      ran=1
    fi
  done
  if [ "$ran" -eq 0 ]; then run all test -w "$ws"; fi
else
  run all test -w "$ws"
  node scripts/ci/coverage-summary.mjs --in "$out/test-output-all.txt" --out "$out/coverage-summary.json" || status=1
fi
exit "$status"
