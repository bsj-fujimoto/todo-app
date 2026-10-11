#!/usr/bin/env bash
# 通知試験（drill）のローカル実行。synthetic.yml の drill=true と同じ流れを手元の compose で通す。
#   backend を意図的に停止 → 監視（MON-002 = sev1、MON-003 = sev2）が失敗 → drill ラベル付きの incident Issue を作成（assignee を確認）
#   → backend を復旧 → 監視が成功 → Issue にコメントして close → 記録（alert-test.json / alert-test.md）。
# Issue は実際のリポジトリ（monitoring/alert-routes.yaml の notification.repository）に作られる。gh の認証と issues: write が必要。
# 使い方（リポジトリのルートで。Node は mise 経由）:
#   scripts/monitoring/drill.sh [--project todo-mon] [--out monitoring/out/drill-<UTC>] [--keep-stack]
#                               [--fault backend|frontend] [--only MON-002,MON-003] [--no-issue]
#   --fault frontend: frontend（nginx）を停止する（RB-001 の訓練）。--no-issue: Issue を作らず、監視の失敗と復旧の確認だけ行う（runbook 訓練）。
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

PROJECT=todo-mon
OUT=""
KEEP=0
FAULT=backend
ONLY="MON-002,MON-003"
ISSUE=1
BASE_URL="${BASE_URL:-http://localhost:8080}"
NODE=(mise x -- node)

while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJECT="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --keep-stack) KEEP=1; shift ;;
    --fault) FAULT="$2"; shift 2 ;;
    --only) ONLY="$2"; shift 2 ;;
    --no-issue) ISSUE=0; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${OUT:-monitoring/out/drill-$STAMP}"
mkdir -p "$OUT"
COMMIT_SHA="$(git rev-parse HEAD)"
export COMMIT_SHA

log() { printf '[drill %s] %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }
compose() { docker compose -p "$PROJECT" "$@"; }

wait_health() {
  local _
  for _ in $(seq 1 60); do
    if curl -fsS "$BASE_URL/api/v1/health" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  echo "health が 120 秒以内に 200 にならない" >&2
  return 1
}

cleanup() {
  compose start backend frontend >/dev/null 2>&1 || true
  if [ "$KEEP" = 0 ]; then compose down -v --remove-orphans >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

log "対象を決める（リリースが無ければフォールバック = 手元の HEAD をビルド）"
"${NODE[@]}" scripts/monitoring/resolve-target.mjs --out "$OUT" --force-fallback
log "起動: docker compose up --build（commit ${COMMIT_SHA})"
compose up -d --build --wait >/dev/null 2>&1
wait_health
"${NODE[@]}" scripts/monitoring/marker.mjs --base-url "$BASE_URL" --out "$OUT"

log "1/3 $FAULT を停止して障害を注入する"
compose stop "$FAULT" >/dev/null 2>&1
"${NODE[@]}" scripts/monitoring/run-monitors.mjs --base-url "$BASE_URL" --out "$OUT/drill-fail" --phase drill-fail \
  --only "$ONLY" --retry-delay-sec 2 --target "$OUT/target.json"
if [ "$ISSUE" = 1 ]; then
  "${NODE[@]}" scripts/monitoring/alert.mjs --results "$OUT/drill-fail/results.json" --out "$OUT" --drill --drill-phase fail \
    --run-url "local-drill:$STAMP"
fi

log "2/3 $FAULT を復旧する（runbook の一次対応: docker compose up -d ${FAULT}）"
compose up -d "$FAULT" >/dev/null 2>&1
wait_health

log "3/3 復旧を監視で確認する"
"${NODE[@]}" scripts/monitoring/run-monitors.mjs --base-url "$BASE_URL" --out "$OUT/drill-recover" --phase drill-recover \
  --only "$ONLY" --target "$OUT/target.json"
if [ "$ISSUE" = 1 ]; then
  "${NODE[@]}" scripts/monitoring/alert.mjs --results "$OUT/drill-recover/results.json" --out "$OUT" --drill --drill-phase recover \
    --run-url "local-drill:$STAMP"
  log "完了。記録: $OUT/alert-test.json  $OUT/alert-test.md"
  cat "$OUT/alert-test.md"
else
  log "完了（Issue なし）。記録: $OUT/drill-fail  $OUT/drill-recover"
fi
