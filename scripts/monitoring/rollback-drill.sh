#!/usr/bin/env bash
# runbook 訓練: RB-002 の「一次対応 → 切り分け → rollback（前のイメージへ戻す）」を手元の compose で実際に通す。
#   1. 「良い版」を起動してイメージを固定（タグ付け）→ 全監視が成功することを確認
#   2. 「悪い版」（別の commit のビルド）に入れ替え、デプロイマーカー（期待する commit との不一致）を監視が検知することを確認
#   3. runbook の rollback の手順どおり、上書きファイル（rollback.yml）で前のイメージへ戻す（--no-build）
#   4. health の版が戻り、全監視が成功することを確認 → 経過時間を記録
# GHCR のリリースが無いため、前のイメージはローカルでタグ固定したもの（本番では digest 固定。手順の機構と判断の流れの検証であり、
# GHCR からの digest 解決は検証していない）。記録: <out>/rollback-drill.json
# 使い方: scripts/monitoring/rollback-drill.sh [--project todo-mon] [--out monitoring/out/rollback-<UTC>]
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

PROJECT=todo-mon
OUT=""
BASE_URL="${BASE_URL:-http://localhost:8080}"
NODE=(mise x -- node)

while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJECT="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${OUT:-monitoring/out/rollback-$STAMP}"
mkdir -p "$OUT"
GOOD_COMMIT="$(git rev-parse HEAD)"
BAD_COMMIT="drill-bad-release-0000000000000000000000000"
TS_FILE="$OUT/timeline.jsonl"
: >"$TS_FILE"

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
mark() { local q="'"; local d="${2//\"/$q}"; printf '{"at":"%s","step":"%s","detail":"%s"}\n' "$(now)" "$1" "$d" >>"$TS_FILE"; printf '[rollback-drill %s] %s %s\n' "$(date -u +%H:%M:%SZ)" "$1" "$2"; }
compose() { docker compose -p "$PROJECT" "$@"; }

wait_health() {
  local _
  for _ in $(seq 1 60); do
    if curl -fsS "$BASE_URL/api/v1/health" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

monitors() { # monitors <名前> <期待する commit> → 終了コードを返す（失敗してもスクリプトは止めない）
  local rc=0
  "${NODE[@]}" scripts/monitoring/run-monitors.mjs --base-url "$BASE_URL" --out "$OUT/$1" --phase normal \
    --expected-commit "$2" --retry-delay-sec 2 --only MON-001,MON-002,MON-003,MON-004,MON-005,MON-006 >"$OUT/$1.log" 2>&1 || rc=$?
  echo "$rc"
}

trap 'rm -f "$OUT/rollback.yml"; compose down -v --remove-orphans >/dev/null 2>&1 || true' EXIT

mark "1-good-deploy" "良い版（commit ${GOOD_COMMIT}）を起動"
COMMIT_SHA="$GOOD_COMMIT" compose up -d --build --wait >/dev/null 2>&1
wait_health
docker tag "$(docker inspect --format '{{.Image}}' "$(compose ps -q backend)")" todo-drill/backend:good
docker tag "$(docker inspect --format '{{.Image}}' "$(compose ps -q frontend)")" todo-drill/frontend:good
mark "1-good-verified" "固定したイメージ: $(docker image inspect --format '{{.Id}}' todo-drill/backend:good) / $(docker image inspect --format '{{.Id}}' todo-drill/frontend:good)"
rc_good="$(monitors good-before "$GOOD_COMMIT")"
mark "1-monitors" "良い版の監視 exit=$rc_good"

mark "2-bad-deploy" "悪い版（commit ${BAD_COMMIT}）に入れ替える"
COMMIT_SHA="$BAD_COMMIT" compose up -d --build --wait backend >/dev/null 2>&1
wait_health
DETECT_AT="$(now)"
rc_bad="$(monitors bad "$GOOD_COMMIT")"
mark "2-detected" "期待する commit との不一致を監視が検知 exit=${rc_bad}（1 なら検知）"
curl -s "$BASE_URL/api/v1/health" >"$OUT/health-bad.json"

mark "3-triage" "一次対応: health の commit と docker compose ps / logs で稼働中の版を確認（runbook RB-002）"
compose ps --format '{{.Name}} {{.Status}}' >"$OUT/compose-ps-bad.txt"
compose logs --no-color --tail 20 backend >"$OUT/backend-log-bad.txt" 2>&1 || true

mark "3-rollback" "rollback.yml（前のイメージ）で入れ替える"
cat >"$OUT/rollback.yml" <<'YAML'
services:
  backend:
    image: todo-drill/backend:good
  frontend:
    image: todo-drill/frontend:good
YAML
cp "$OUT/rollback.yml" "$OUT/rollback.used.yml"
# 戻すときは COMMIT_SHA を渡さない（焼き込み済みのイメージの commit が health に出ることの確認。#16 の修正後）
compose -f docker-compose.yml -f "$OUT/rollback.yml" up -d --no-build --pull never --wait >/dev/null 2>&1
wait_health
RECOVER_AT="$(now)"
mark "4-rolled-back" "health: $(curl -s "$BASE_URL/api/v1/health")"
rc_after="$(monitors good-after "$GOOD_COMMIT")"
mark "4-verified" "rollback 後の監視 exit=${rc_after}（0 なら成功）"

"${NODE[@]}" -e '
  const fs = require("fs");
  const [out, detect, recover, rcGood, rcBad, rcAfter] = process.argv.slice(1);
  const secs = Math.round((Date.parse(recover) - Date.parse(detect)) / 1000);
  const record = {
    kind: "runbook-drill", runbook: "RB-002", scenario: "悪いリリースの検知と前のイメージへの rollback",
    detected_at: detect, rolled_back_at: recover, detect_to_rollback_sec: secs,
    monitors_exit: { good_before: Number(rcGood), bad: Number(rcBad), after_rollback: Number(rcAfter) },
    result: Number(rcGood) === 0 && Number(rcBad) === 1 && Number(rcAfter) === 0 ? "pass" : "fail",
    note: "前のイメージはローカルでタグ固定したもの。GHCR の digest 解決は未検証（リリースが無い）",
    timeline: fs.readFileSync(out + "/timeline.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l)),
  };
  fs.writeFileSync(out + "/rollback-drill.json", JSON.stringify(record, null, 2) + "\n");
  console.log("[rollback-drill] result=" + record.result + " detect->rollback=" + secs + "s");
  if (record.result !== "pass") process.exitCode = 1;
' "$OUT" "$DETECT_AT" "$RECOVER_AT" "$rc_good" "$rc_bad" "$rc_after"
