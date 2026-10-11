#!/usr/bin/env bash
# base ブランチの backend/openapi.yaml と、いまの backend/openapi.yaml を oasdiff で比べ、
# 破壊的変更（レベル ERR）があれば非 0 で終わる。結果は contract-report/ に保存する（CI の artifact）。
#
# 環境変数（どれも任意）:
#   PR_BASE_SHA  pull_request の base の SHA
#   PUSH_BEFORE  push の直前の SHA（github.event.before）
#   SPEC         比較対象のパス（既定 backend/openapi.yaml）
#
# oasdiff は Docker イメージを digest で固定して使う（版: v1.33.0）。更新は Dependabot（docker）か手動で、digest ごと差し替える。
set -euo pipefail

OASDIFF_IMAGE="tufin/oasdiff@sha256:6263a96dd2ef0726c54e21fea9b8e1607eac4841add0079324b424c1f52b819c"
SPEC="${SPEC:-backend/openapi.yaml}"
OUT="contract-report"
ZERO="0000000000000000000000000000000000000000"
mkdir -p "$OUT"

base="${PR_BASE_SHA:-${PUSH_BEFORE:-}}"
if [ -z "$base" ] || [ "$base" = "$ZERO" ]; then
  base="$(git rev-parse origin/main 2>/dev/null || true)"
  if [ "$base" = "$(git rev-parse HEAD)" ]; then base="$(git rev-parse HEAD~1 2>/dev/null || true)"; fi
fi
head_sha="$(git rev-parse HEAD)"

write_result() { # $1=result $2=reason
  printf '{"schema_version":1,"base_sha":"%s","head_sha":"%s","spec":"%s","oasdiff_image":"%s","result":"%s","reason":"%s"}\n' \
    "$base" "$head_sha" "$SPEC" "$OASDIFF_IMAGE" "$1" "$2" > "$OUT/result.json"
}

if [ -z "$base" ] || ! git cat-file -e "$base:$SPEC" 2>/dev/null; then
  write_result "skipped" "base に $SPEC が無い（新規追加）ため比較できない"
  echo "base ($base) に $SPEC が無いので比較をスキップする（新規追加）" | tee "$OUT/oasdiff-breaking.txt"
  exit 0
fi

git show "$base:$SPEC" > "$OUT/base-openapi.yaml"
cp "$SPEC" "$OUT/head-openapi.yaml"
oasdiff() { docker run --rm -v "$PWD:/work" -w /work "$OASDIFF_IMAGE" "$@"; }

echo "比較: base=$base → head=$head_sha ($SPEC)"
oasdiff changelog "$OUT/base-openapi.yaml" "$OUT/head-openapi.yaml" > "$OUT/oasdiff-changelog.txt" || true
oasdiff breaking "$OUT/base-openapi.yaml" "$OUT/head-openapi.yaml" --format json > "$OUT/oasdiff-breaking.json" || true

status=0
oasdiff breaking "$OUT/base-openapi.yaml" "$OUT/head-openapi.yaml" --fail-on ERR | tee "$OUT/oasdiff-breaking.txt" || status=$?
if [ "$status" -ne 0 ]; then
  write_result "fail" "破壊的変更（ERR）を検出（oasdiff exit ${status}）"
  echo "::error::backend/openapi.yaml に破壊的変更がある。互換性方針に従い v2 を切るか、変更を戻す（contract-report/oasdiff-breaking.txt）"
  exit "$status"
fi
write_result "pass" "破壊的変更なし"
