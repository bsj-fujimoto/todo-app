#!/usr/bin/env bash
# セキュリティ検査の実行（CI とローカルで同じコマンド）。出力は機械可読（SARIF / JSON / CycloneDX）で security-results/<検査名>/ に保存し、
# 検査ごとに scan-run.json（対象リポジトリ・branch・commit・イメージ digest・実行日時・ツール名と版・コマンド・設定ファイル）を残す。
#
# 使い方: scripts/security/scan.sh <検査名> [引数...]
#   gitleaks                          秘密情報（履歴全体）
#   npm-audit                         npm audit（--omit=dev と全体の 2 本）
#   osv                               osv-scanner（package-lock.json）
#   sbom                              CycloneDX SBOM（実行時依存・全体）
#   trivy-fs                          trivy fs（vuln,misconfig,secret）
#   trivy-image <backend|frontend> <image-ref>   ビルド済みイメージ（docker save → trivy --input）+ イメージ SBOM
#   hadolint                          Dockerfile の lint
#   compose-check                     docker compose 構成の設定誤り
#   license                           ライセンス方針の評価（違反があれば非 0）
#   zap                               OWASP ZAP baseline + API 走査（compose を起動して実行）
#   actionlint                        ワークフローの静的検査（違反があれば非 0）
#   workflows                         ワークフロー統制 W1〜W10 と方針ファイルの検査（違反があれば非 0）
# 環境変数: SECURITY_RESULTS（既定 security-results）、TRIVY_CACHE_DIR（既定 .cache/trivy）、
#           ZAP_TARGET（既定 http://localhost:8080）、ZAP_NETWORK（既定 host。Docker Desktop の macOS では bridge + host.docker.internal を使う）
# 検出があっても検査自体は成功（exit 0）。ゲートは scripts/security/triage.mjs が担う。ツールが動かなかったときだけ失敗する。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 1
# shellcheck source=/dev/null
. security/tools.env
OUT_BASE="${SECURITY_RESULTS:-security-results}"
TRIVY_CACHE="${TRIVY_CACHE_DIR:-$ROOT/.cache/trivy}"
mkdir -p "$TRIVY_CACHE"

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
# git が「所有者が違う」と履歴を読めなくなる（macOS の Docker Desktop など）のを避けるため、/repo を safe.directory にする。
dk() {
  docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0=/repo \
    -v "$ROOT:/repo" -w /repo "$@"
}

# record <name> <kind> <tool> <version> <image> <config> <exit_code> <ok_codes> <started> <command> [scan-run.mjs の追加引数...]
record() {
  local name="$1" kind="$2" tool="$3" version="$4" image="$5" config="$6" code="$7" ok="$8" started="$9" cmd="${10}"
  shift 10
  node scripts/security/scan-run.mjs --scan "$name" --kind "$kind" --tool "$tool" --tool-version "$version" \
    ${image:+--image "$image"} ${config:+--config "$config"} --exit-code "$code" --ok-codes "$ok" --started "$started" \
    --command "$cmd" --out-dir "$OUT_BASE/$name" "$@"
}

in_ok() { case ",$2," in *",$1,"*) return 0 ;; *) return 1 ;; esac; }

scan_gitleaks() {
  local out="$OUT_BASE/gitleaks" started cmd code
  mkdir -p "$out"; started="$(now)"
  cmd="git --config security/gitleaks.toml --report-format sarif --report-path $out/gitleaks.sarif --redact --exit-code 2 --no-banner --no-color /repo"
  # shellcheck disable=SC2086
  dk "$GITLEAKS_IMAGE" $cmd 2>&1 | tee "$out/gitleaks.log"; code=${PIPESTATUS[0]}
  # 履歴を 1 commit も読めていないのに「漏れなし」と報告しないよう、走査した commit 数を確認する
  scanned="$(sed -n 's/.*[^0-9]\([0-9][0-9]*\) commits scanned.*/\1/p' "$out/gitleaks.log" | tail -n 1)"
  if [ "${scanned:-0}" -eq 0 ]; then echo "gitleaks は commit を 1 件も走査していない（履歴を読めていない）" >&2; code=3; fi
  record gitleaks secret gitleaks "$GITLEAKS_VERSION" "$GITLEAKS_IMAGE" security/gitleaks.toml "$code" 0,2 "$started" \
    "docker run $GITLEAKS_IMAGE gitleaks $cmd" --coverage-path "git 履歴全体（全 branch の全 commit）" --threshold "検出は triage.mjs で判定。critical/high の未解決は失敗" \
    --exclusion "security/gitleaks.toml の allowlist（理由はファイル内）"
}

scan_npm_audit() {
  local out="$OUT_BASE/npm-audit-prod" started code
  mkdir -p "$out" "$OUT_BASE/npm-audit-all"
  started="$(now)"; npm audit --omit=dev --json > "$out/npm-audit-prod.json"; code=$?
  record npm-audit-prod sca npm-audit "$(npm --version)" "" package-lock.json "$code" 0,1 "$started" "npm audit --omit=dev --json" \
    --coverage-path "package-lock.json（実行時依存。backend / frontend / e2e の workspaces）" --threshold "high 以上は triage.mjs で失敗"
  started="$(now)"; npm audit --json > "$OUT_BASE/npm-audit-all/npm-audit-all.json"; code=$?
  record npm-audit-all sca npm-audit "$(npm --version)" "" package-lock.json "$code" 0,1 "$started" "npm audit --json" \
    --coverage-path "package-lock.json（開発依存を含む全体）" --threshold "high 以上は triage.mjs で失敗"
}

scan_osv() {
  local out="$OUT_BASE/osv-scanner" started code1 code2
  mkdir -p "$out"; started="$(now)"
  dk "$OSV_IMAGE" scan source -L package-lock.json --format sarif --output-file "$out/osv-scanner.sarif"; code1=$?
  dk "$OSV_IMAGE" scan source -L package-lock.json --format json --output-file "$out/osv-scanner.json"; code2=$?
  record osv-scanner sca osv-scanner "$OSV_VERSION" "$OSV_IMAGE" "" "$((code1 > code2 ? code1 : code2))" 0,1 "$started" \
    "docker run $OSV_IMAGE scan source -L package-lock.json --format sarif|json" --coverage-path "package-lock.json（直接・推移依存。OSV / deps.dev）" \
    --threshold "high 以上は triage.mjs で失敗"
}

scan_sbom() {
  local out="$OUT_BASE/sbom" started code
  mkdir -p "$out"; started="$(now)"
  # npm 組み込みの sbom（外部パッケージを増やさない）。CycloneDX の JSON。実行時依存のみ / 開発依存を含む全体の 2 本
  npm sbom --sbom-format cyclonedx --package-lock-only --omit dev > "$out/sbom-runtime.cdx.json"; code=$?
  if [ "$code" -eq 0 ]; then npm sbom --sbom-format cyclonedx --package-lock-only > "$out/sbom.cdx.json"; code=$?; fi
  record sbom sca npm-sbom "$(npm --version)" "" package-lock.json "$code" 0 "$started" \
    "npm sbom --sbom-format cyclonedx --package-lock-only [--omit dev]" --coverage-path "package-lock.json（直接・推移依存の全体 / 実行時依存のみの 2 本）"
}

scan_trivy_fs() {
  local out="$OUT_BASE/trivy-fs" started code cmd
  mkdir -p "$out"; started="$(now)"
  cmd="fs --scanners vuln,misconfig,secret --include-dev-deps --severity UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL --skip-dirs node_modules,.cache,security-results,.git --exit-code 0 --no-progress --format json --output $out/trivy-fs.json ."
  # shellcheck disable=SC2086
  dk -e TRIVY_CACHE_DIR=/cache -e TRIVY_SKIP_VERSION_CHECK=true -v "$TRIVY_CACHE:/cache" "$TRIVY_IMAGE" $cmd; code=$?
  if [ "$code" -eq 0 ]; then
    dk -e TRIVY_CACHE_DIR=/cache -e TRIVY_SKIP_VERSION_CHECK=true -v "$TRIVY_CACHE:/cache" "$TRIVY_IMAGE" convert --format sarif --output "$out/trivy-fs.sarif" "$out/trivy-fs.json"; code=$?
  fi
  record trivy-fs sca trivy "$TRIVY_VERSION" "$TRIVY_IMAGE" "" "$code" 0 "$started" "docker run $TRIVY_IMAGE trivy $cmd" \
    --coverage-path "リポジトリ全体（package-lock.json・Dockerfile・workflow・設定ファイル）" --exclusion "node_modules, .cache, security-results, .git" \
    --threshold "high 以上は triage.mjs で失敗"
}

image_id() { docker image inspect --format '{{.Id}}' "$1" 2>/dev/null; }

scan_trivy_image() {
  local which="${1:?backend|frontend}" ref="${2:?image-ref}" name out started code tar id
  name="trivy-image-$which"; out="$OUT_BASE/$name"; mkdir -p "$out"; started="$(now)"
  id="$(image_id "$ref")"; tar="$out/$which-image.tar"
  docker save -o "$tar" "$ref" || return 1
  dk -e TRIVY_CACHE_DIR=/cache -e TRIVY_SKIP_VERSION_CHECK=true -v "$TRIVY_CACHE:/cache" "$TRIVY_IMAGE" image --input "$tar" \
    --severity UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL --exit-code 0 --no-progress --format json --output "$out/$name.json"; code=$?
  if [ "$code" -eq 0 ]; then
    dk -e TRIVY_CACHE_DIR=/cache -e TRIVY_SKIP_VERSION_CHECK=true -v "$TRIVY_CACHE:/cache" "$TRIVY_IMAGE" convert --format sarif --output "$out/$name.sarif" "$out/$name.json"; code=$?
  fi
  if [ "$code" -eq 0 ]; then
    dk -e TRIVY_CACHE_DIR=/cache -e TRIVY_SKIP_VERSION_CHECK=true -v "$TRIVY_CACHE:/cache" "$TRIVY_IMAGE" convert --format cyclonedx --output "$out/sbom-image-$which.cdx.json" "$out/$name.json"; code=$?
  fi
  rm -f "$tar"
  record "$name" container trivy "$TRIVY_VERSION" "$TRIVY_IMAGE" "" "$code" 0 "$started" \
    "docker save $ref; docker run $TRIVY_IMAGE trivy image --input <tar> --format json → convert sarif|cyclonedx" \
    --image-digest "$id" --image-digest-kind "ローカルイメージ ID（config digest。レジストリ digest は release.yml で push 後に記録）" \
    --coverage-image "$ref" --threshold "high 以上は triage.mjs で失敗"
}

scan_hadolint() {
  local out="$OUT_BASE/hadolint" started code files
  mkdir -p "$out"; started="$(now)"
  files="$(find . -name 'Dockerfile*' -not -path './node_modules/*' -not -path './.cache/*' | sed 's|^\./||' | sort | tr '\n' ' ')"
  # shellcheck disable=SC2086
  dk "$HADOLINT_IMAGE" hadolint --config security/hadolint.yaml --format sarif $files > "$out/hadolint.sarif"; code=$?
  record hadolint container hadolint "$HADOLINT_VERSION" "$HADOLINT_IMAGE" security/hadolint.yaml "$code" 0,1 "$started" \
    "docker run $HADOLINT_IMAGE hadolint --config security/hadolint.yaml --format sarif $files" --coverage-path "$files"
}

scan_compose_check() {
  local out="$OUT_BASE/compose-check" started code
  mkdir -p "$out"; started="$(now)"
  if [ ! -f docker-compose.yml ]; then
    record compose-check config compose-check 1.0.0 "" "" 0 0 "$started" "scripts/security/check-compose.mjs" --skipped --note "docker-compose.yml がまだ無い"
    return 0
  fi
  docker compose -f docker-compose.yml config --format json | node scripts/security/check-compose.mjs --file docker-compose.yml --out "$out/compose-check.sarif"; code=${PIPESTATUS[1]}
  record compose-check config compose-check 1.0.0 "" "" "$code" 0 "$started" \
    "docker compose -f docker-compose.yml config --format json | node scripts/security/check-compose.mjs" --coverage-path docker-compose.yml
}

scan_license() {
  local out="$OUT_BASE/license" started code
  mkdir -p "$out"; started="$(now)"
  node scripts/security/license-check.mjs --out "$out"; code=$?
  record license license license-check.mjs 1.0.0 "" security/license-policy.yaml "$code" 0,1 "$started" \
    "node scripts/security/license-check.mjs（package-lock.json と node_modules/*/package.json の license を、自前の SPDX 式評価で方針と突き合わせる）" --rules security/license-policy.yaml \
    --coverage-path "package-lock.json（開発依存を含む全体）" --threshold "許可リスト外は違反（deny by default）"
  return "$code"
}

scan_actionlint() {
  local out="$OUT_BASE/actionlint" started code
  mkdir -p "$out"; started="$(now)"
  dk "$ACTIONLINT_IMAGE" -format '{{json .}}' > "$out/actionlint.json"; code=$?
  record actionlint config actionlint "$ACTIONLINT_VERSION" "$ACTIONLINT_IMAGE" "" "$code" 0,1 "$started" \
    "docker run $ACTIONLINT_IMAGE actionlint -format '{{json .}}'" --coverage-path ".github/workflows/*.yml"
  return "$code"
}

# ワークフロー統制（W1〜W10）と、方針ファイル（zap-rules・triage・accepted-risks・license-policy・dependency-selection）の期限・形式。
scan_workflows() {
  local out="$OUT_BASE/workflow-governance" started code1 code2
  mkdir -p "$out"; started="$(now)"
  node scripts/security/check-workflows.mjs --out "$out/workflow-check-report.json"; code1=$?
  node scripts/security/check-policy.mjs | tee "$out/policy-check.txt"; code2=${PIPESTATUS[0]}
  record workflow-governance config check-workflows 1.0.0 "" "" "$((code1 > code2 ? code1 : code2))" 0,1 "$started" \
    "node scripts/security/check-workflows.mjs; node scripts/security/check-policy.mjs" --rules security/workflow-policy.yaml \
    --coverage-path ".github/workflows/*.yml, .github/actions/*/action.yml, security/*（方針ファイル）" --note "逸脱があれば失敗（ゲートとは別に、このジョブ自体が落ちる）"
  [ "$code1" -eq 0 ] && [ "$code2" -eq 0 ]
}

# ZAP: 公式イメージで baseline（受動）と API 走査（openapi.yaml）を実行する。認証の無いアプリなので認証なしの走査（authenticated=false）。
scan_zap() {
  local out="$OUT_BASE/zap" started code=0 target="${ZAP_TARGET:-http://localhost:8080}" net="${ZAP_NETWORK:-host}"
  mkdir -p "$out"; started="$(now)"
  if [ ! -f docker-compose.yml ]; then
    record zap dast zap "$ZAP_VERSION" "$ZAP_IMAGE" security/zap-rules.tsv 0 0 "$started" "zap-baseline.py / zap-api-scan.py" --skipped --note "docker-compose.yml がまだ無い（起動する対象が無い）"
    return 0
  fi
  cp security/zap-rules.tsv "$out/zap-rules.tsv"; cp backend/openapi.yaml "$out/openapi.yaml"; chmod -R a+rwX "$out"
  docker compose up -d --build --wait || { echo "compose の起動に失敗" >&2; return 1; }
  local c1 c2
  docker run --rm --network "$net" -v "$ROOT/$out:/zap/wrk:rw" "$ZAP_IMAGE" zap-baseline.py -t "$target" -c zap-rules.tsv -J zap-baseline.json -r zap-baseline.html -w zap-baseline.md; c1=$?
  docker run --rm --network "$net" -v "$ROOT/$out:/zap/wrk:rw" "$ZAP_IMAGE" zap-api-scan.py -t openapi.yaml -f openapi -O "$target" -c zap-rules.tsv -J zap-api.json -r zap-api.html -w zap-api.md; c2=$?
  docker compose logs --no-color > "$out/compose.log" 2>&1
  docker compose down -v
  for f in zap-baseline zap-api; do
    [ -f "$out/$f.json" ] && node scripts/security/zap-to-sarif.mjs --in "$out/$f.json" --out "$out/$f.sarif" --rules security/zap-rules.tsv || code=1
  done
  # ZAP の終了コード: 0 = 警告なし / 1 = FAIL あり / 2 = WARN あり / 3 以上 = 実行エラー。1・2 は検出であって実行失敗ではない
  [ "$c1" -le 2 ] && [ "$c2" -le 2 ] || code=1
  record zap dast zap "$ZAP_VERSION" "$ZAP_IMAGE" security/zap-rules.tsv "$code" 0 "$started" \
    "docker run $ZAP_IMAGE zap-baseline.py -t $target -c zap-rules.tsv; zap-api-scan.py -t openapi.yaml -f openapi -O $target -c zap-rules.tsv (exit $c1 / $c2)" \
    --rules security/zap-rules.tsv --coverage-url "$target" --coverage-url "openapi.yaml の全 operation（backend/openapi.yaml）" \
    --authenticated false --note "本アプリは認証・認可を持たない（REQ-015）ため、認証なしの走査が全攻撃面。ZAP exit: baseline=$c1 api=$c2" \
    --threshold "security/zap-rules.tsv（IGNORE は理由・期限つき、FAIL は high 扱い）。critical/high の未解決は triage.mjs で失敗"
  return "$code"
}

cmd="${1:-}"
[ -n "$cmd" ] && shift
case "$cmd" in
  gitleaks) scan_gitleaks ;;
  npm-audit) scan_npm_audit ;;
  osv) scan_osv ;;
  sbom) scan_sbom ;;
  trivy-fs) scan_trivy_fs ;;
  trivy-image) scan_trivy_image "$@" ;;
  hadolint) scan_hadolint ;;
  compose-check) scan_compose_check ;;
  license) scan_license ;;
  zap) scan_zap ;;
  actionlint) scan_actionlint ;;
  workflows) scan_workflows ;;
  *) sed -n '2,22p' "${BASH_SOURCE[0]}"; exit 2 ;;
esac
