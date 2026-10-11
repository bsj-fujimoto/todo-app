#!/usr/bin/env bash
# 負荷・性能試験の一括実行。compose を起動し、warm-up（30 秒、判定から除外）→ 各シナリオを 3 反復で k6 実行 →
# 観測サンプラーを並走 → 画面計測 → 判定（verdict）→ 記録（record）→ ベースライン比較（compare）。
# 結果は perf/results/<run_id>/ に保存する（run_id = UTC 日時-commit SHA7桁）。
#
# 使い方（リポジトリのルートで。Node は mise 経由、k6 / Lighthouse は Docker）:
#   scripts/perf/run.sh [--profile full|ci|quick] [--scenarios load,stress,spike,soak,capacity,screen]
#                       [--iterations 3] [--project todo-perf] [--run-id ID] [--no-teardown] [--no-compare]
# 長時間 soak: SOAK_DURATION_SEC=7200 scripts/perf/run.sh --scenarios soak
# 終了コード: 0 = 全 pass かつ退行なし、1 = fail または退行、2 = 実行の失敗（環境・スクリプトの不具合）
set -euo pipefail

# 実行中にこのファイルが書き換わると bash が壊れた行を読むため、一時コピーから実行し直す（長時間の試験を守る）
if [ -z "${PERF_RUN_SELF_COPY:-}" ]; then
  self_copy="$(mktemp "${TMPDIR:-/tmp}/perf-run.XXXXXX")"
  cp "$0" "$self_copy"
  PERF_RUN_SELF_COPY=1 exec bash "$self_copy" "$@"
fi

cd "$(git rev-parse --show-toplevel)"

PROFILE=full
SCENARIOS="load,stress,spike,soak,capacity,screen"
ITERATIONS=""
PROJECT=todo-perf
RUN_ID=""
TEARDOWN=1
COMPARE=1
OUT_ROOT=perf/results
HOST_URL="${PERF_HOST_URL:-http://localhost:8080}"
# k6 は digest 固定（grafana/k6 の マルチアーキ index。v2.3.0）。更新は意図的に digest を取り直す
K6_IMAGE="${K6_IMAGE:-grafana/k6@sha256:e66db15b860113878fa74670e31f5e274830b7b6e42c8bff28b2f2d86a257603}"
SCREEN_IMAGE="${SCREEN_IMAGE:-todo-perf-screen:local}"
NODE=(mise x -- node)
COMPOSE_BASE="${COMPOSE_BASE:-docker-compose.yml}"
export K6_IMAGE
export COMPOSE_BASE
# health の commit に出る（compose のビルド引数）。run_id・記録と同じ commit にそろえる
COMMIT_SHA="${COMMIT_SHA:-$(git rev-parse HEAD)}"
export COMMIT_SHA

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    --scenarios) SCENARIOS="$2"; shift 2 ;;
    --iterations) ITERATIONS="$2"; shift 2 ;;
    --project) PROJECT="$2"; shift 2 ;;
    --run-id) RUN_ID="$2"; shift 2 ;;
    --out) OUT_ROOT="$2"; shift 2 ;;
    --no-teardown) TEARDOWN=0; shift ;;
    --no-compare) COMPARE=0; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

USER_ITERATIONS="$ITERATIONS"
eval "$("${NODE[@]}" scripts/perf/params.mjs profile "$PROFILE")"
ITERATIONS="${USER_ITERATIONS:-$ITERATIONS}"
SLO_JSON="$("${NODE[@]}" scripts/perf/params.mjs slo)"
if [ -z "$RUN_ID" ]; then
  RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short=7 HEAD)"
fi
RUN_DIR="$OUT_ROOT/$RUN_ID"
mkdir -p "$RUN_DIR"
RUN_DIR_ABS="$(cd "$RUN_DIR" && pwd)"
NETWORK="${PROJECT}_default"
K6_NAME="${PROJECT}-k6"
OBSERVER_PID=""

log() { printf '[perf %s] %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }

# COMPOSE_EXTRA: 実験用の上書き（例 perf/experiments/log-silent.yml）。通常の試験では使わない
compose() {
  local files=(-f "$COMPOSE_BASE" -f perf/compose.perf.yml)
  if [ -n "${COMPOSE_EXTRA:-}" ]; then files+=(-f "$COMPOSE_EXTRA"); fi
  docker compose -p "$PROJECT" "${files[@]}" "$@"
}

cleanup() {
  if [ -n "$OBSERVER_PID" ]; then kill -TERM "$OBSERVER_PID" 2>/dev/null || true; fi
  if [ "$TEARDOWN" = 1 ]; then compose down -v --remove-orphans >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

# 毎回 DB ボリュームを作り直し、同じ初期条件で始める
reset_stack() {
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  compose up -d --build --wait >/dev/null 2>&1
  local i
  for i in $(seq 1 60); do
    if curl -fsS "$HOST_URL/api/v1/health" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "health が 60 秒以内に 200 にならない" >&2
  return 2
}

# run_k6 <出力ディレクトリ> <名前> <スクリプト> [KEY=VALUE ...]  →  <名前>.summary.json / <名前>.raw.json.gz
# k6 の終了コード 99（threshold 超過）は試験結果なので失敗扱いにしない。判定は verdict.mjs が行う
run_k6() {
  local dir="$1" name="$2" script="$3"; shift 3
  local envs=(-e "BASE_URL=http://frontend:8080" -e "SLO_JSON=$SLO_JSON" -e "OUT_DIR=/out" -e "SUMMARY_NAME=$name")
  local kv
  for kv in "$@"; do envs+=(-e "$kv"); done
  local out_opts=()
  if [ "$name" != "warmup" ] && [ "$name" != "seed" ]; then out_opts=(--out "json=/out/$name.raw.json.gz"); fi
  local rc=0
  docker run --rm --name "$K6_NAME" --network "$NETWORK" \
    -v "$PWD/perf/k6:/scripts:ro" -v "$dir:/out" "${envs[@]}" \
    "$K6_IMAGE" run --quiet ${out_opts[@]+"${out_opts[@]}"} "/scripts/$script" >"$dir/$name.k6.log" 2>&1 || rc=$?
  echo "$rc" >"$dir/$name.exit"
  if [ "$rc" != 0 ] && [ "$rc" != 99 ]; then
    echo "k6 $script が異常終了（exit $rc）。$dir/$name.k6.log を参照" >&2
    tail -n 20 "$dir/$name.k6.log" >&2
    return 2
  fi
}

seed() { run_k6 "$1" seed seed.js "TARGET=$2"; }

start_observer() {
  "${NODE[@]}" scripts/perf/observe.mjs --out "$1/observe.jsonl" --project "$PROJECT" --base-url "$HOST_URL" --k6-container "$K6_NAME" &
  OBSERVER_PID=$!
  sleep 3
}

stop_observer() {
  sleep 3
  kill -TERM "$OBSERVER_PID" 2>/dev/null || true
  wait "$OBSERVER_PID" 2>/dev/null || true
  OBSERVER_PID=""
}

measure() {
  local sc="$1" dir="$2"
  case "$sc" in
    load) run_k6 "$dir" main load.js "RATE=$LOAD_RPS" "DURATION_SEC=$LOAD_DURATION_SEC" "MIN_TASKS=$NORMAL_TASKS" ;;
    stress) run_k6 "$dir" main stress.js "STAGES=$STRESS_STAGES" "STAGE_SEC=$STRESS_STAGE_SEC" ;;
    spike) run_k6 "$dir" main spike.js "DURATION_SEC=$SPIKE_DURATION_SEC" "BASE_RPS=$LOAD_RPS" ;;
    soak) run_k6 "$dir" main soak.js "RATE=$LOAD_RPS" "DURATION_SEC=$SOAK_DURATION_SEC" "MIN_TASKS=$NORMAL_TASKS" ;;
    capacity)
      local n
      for n in $CAPACITY_STEPS; do
        seed "$dir" "$n"
        run_k6 "$dir" "step-$n" capacity-step.js "RATE=$CAPACITY_RPS" "STEP_SEC=$CAPACITY_STEP_SEC" "TASKS=$n"
      done
      ;;
  esac
}

run_iteration() {
  local sc="$1" i="$2"
  local dir="$RUN_DIR_ABS/$sc/iter-$i"
  mkdir -p "$dir"
  log "$sc iteration $i/$ITERATIONS: stack をリセット"
  reset_stack
  seed "$dir" "$NORMAL_TASKS"
  log "$sc iteration $i: warm-up ${WARMUP_SEC}s（判定から除外）"
  run_k6 "$dir" warmup warmup.js "RATE=$WARMUP_RPS" "DURATION_SEC=$WARMUP_SEC"
  date -u +%Y-%m-%dT%H:%M:%SZ >"$dir/measure-start.txt"
  start_observer "$dir"
  log "$sc iteration $i: 計測開始"
  measure "$sc" "$dir"
  stop_observer
  date -u +%Y-%m-%dT%H:%M:%SZ >"$dir/measure-end.txt"
  compose logs --no-color --tail 200 backend >"$dir/backend.log" 2>&1 || true
}

run_screen() {
  local dir="$RUN_DIR_ABS/screen"
  mkdir -p "$dir"
  docker build -q -t "$SCREEN_IMAGE" perf/screen >/dev/null
  local tasks
  for tasks in "$NORMAL_TASKS" 10000; do
    log "screen: ${tasks} 件で表示完了時間 + Lighthouse"
    reset_stack
    seed "$dir" "$tasks"
    local out="$dir/tmp-$tasks"
    mkdir -p "$out"
    docker run --rm --network "$NETWORK" -v "$out:/out" -e "BASE_URL=http://frontend:8080" \
      -e "EXPECTED_ROWS=$tasks" -e "ROW_SELECTOR=${ROW_SELECTOR:-li.task}" -e "OUT_DIR=/out" "$SCREEN_IMAGE"
    if [ "$tasks" = "$NORMAL_TASKS" ]; then
      mv "$out/screen.json" "$dir/screen.json"
      mv "$out/lighthouse-report-1.json" "$dir/lighthouse-report-1.json"
    else
      mv "$out/screen.json" "$dir/screen-$tasks.json"
    fi
    rm -rf "$out"
  done
}

log "run_id=$RUN_ID profile=$PROFILE scenarios=$SCENARIOS iterations=$ITERATIONS"
reset_stack
"${NODE[@]}" scripts/perf/env.mjs --run-dir "$RUN_DIR_ABS" --run-id "$RUN_ID" --profile "$PROFILE" --project "$PROJECT"

IFS=',' read -ra SC_LIST <<<"$SCENARIOS"
for sc in "${SC_LIST[@]}"; do
  if [ "$sc" = screen ]; then run_screen; continue; fi
  for i in $(seq 1 "$ITERATIONS"); do run_iteration "$sc" "$i"; done
done

STATUS=0
"${NODE[@]}" scripts/perf/verdict.mjs --run-dir "$RUN_DIR_ABS" || STATUS=$?
if [ "$STATUS" = 2 ]; then exit 2; fi
"${NODE[@]}" scripts/perf/record.mjs --run-dir "$RUN_DIR_ABS"
if [ "$COMPARE" = 1 ] && [ -s perf/baseline.json ]; then
  "${NODE[@]}" scripts/perf/compare.mjs --run-dir "$RUN_DIR_ABS" || STATUS=1
else
  log "perf/baseline.json が無い（または --no-compare）。比較は行わない"
fi
log "完了: $RUN_DIR (exit $STATUS)"
exit "$STATUS"
