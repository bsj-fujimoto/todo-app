#!/usr/bin/env bash
# GitHub 上の統制の実態を read-only の gh api で JSON 保存する（qc-analyzer の `ingest-github` が読む形式）。
#   scripts/ci/snapshot-github.sh [出力ディレクトリ（既定 github-snapshot）] [--repo owner/name] [--sha <commit>]
# 保存するもの:
#   repo.json  rulesets.json  rulesets/<id>.json  branch-protection.json  check-runs.json  workflows.json  runs.json
#   dependabot-alerts.json  code-scanning-alerts.json  secret-scanning-alerts.json  audit-workflow.json  manifests.json
#   dependabot.yml  CODEOWNERS  workflows/*.yml  snapshot-meta.json
# 取得に失敗した API（403 / 404 など）は、握りつぶさず {"__error__":{"http_status":..,"message":..}} をそのファイルに保存する。
#   403 は「権限か契約か分からない」、404 は「機能が無効・未設定」。どちらも「問題なし」ではない。
# 書き込み系の API は一切呼ばない（GET と list のみ）。
set -uo pipefail

OUT="github-snapshot"
REPO=""
SHA=""
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --sha) SHA="$2"; shift 2 ;;
    -*) echo "不明なオプション: $1" >&2; exit 2 ;;
    *) OUT="$1"; shift ;;
  esac
done

cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 1
[ -n "$REPO" ] || REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
mkdir -p "$OUT/rulesets" "$OUT/workflows"

# gh の失敗（HTTP ステータス）を __error__ として保存する。成功なら出力をそのまま保存する。
save() { # $1=出力ファイル名 $2..=gh の引数
  local file="$OUT/$1" tmp err code status msg
  shift
  tmp="$(mktemp)"; err="$(mktemp)"
  if gh "$@" > "$tmp" 2> "$err"; then
    mv "$tmp" "$file"
  else
    code=$?
    status="$(cat "$err" "$tmp" | grep -Eo 'HTTP [0-9]{3}' | head -n 1 | grep -Eo '[0-9]{3}' || true)"
    msg="$(head -c 400 "$err" | tr '\n"' ' ')"
    printf '{"__error__":{"http_status":%s,"message":"%s (exit %s)"}}\n' "${status:-null}" "${msg:-gh の実行に失敗}" "$code" > "$file"
    rm -f "$tmp"
  fi
  rm -f "$err"
}

save repo.json repo view "$REPO" --json nameWithOwner,defaultBranchRef,visibility,isPrivate
DEFAULT_BRANCH="$(node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write((r.defaultBranchRef&&r.defaultBranchRef.name)||"main")' "$OUT/repo.json")"

save rulesets.json api "repos/$REPO/rulesets" --paginate
for id in $(node -e 'try{const l=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(Array.isArray(l))console.log(l.map(r=>r.id).join(" "))}catch{}' "$OUT/rulesets.json"); do
  save "rulesets/$id.json" api "repos/$REPO/rulesets/$id"
done
save branch-protection.json api "repos/$REPO/branches/$DEFAULT_BRANCH/protection"

[ -n "$SHA" ] || SHA="$(gh api "repos/$REPO/commits/$DEFAULT_BRANCH" --jq .sha 2> /dev/null || true)"
save check-runs.json api "repos/$REPO/commits/${SHA:-$DEFAULT_BRANCH}/check-runs?per_page=100"
save workflows.json workflow list -R "$REPO" --all --json name,path,state,id
save runs.json run list -R "$REPO" --limit 100 --json databaseId,name,event,status,conclusion,headSha,createdAt,startedAt,updatedAt,workflowName
save dependabot-alerts.json api "repos/$REPO/dependabot/alerts?per_page=100&state=open"
save code-scanning-alerts.json api "repos/$REPO/code-scanning/alerts?per_page=100&state=open"
save secret-scanning-alerts.json api "repos/$REPO/secret-scanning/alerts?per_page=100&state=open"

# リポジトリ内のファイル（作業ツリーの内容）
[ -f .github/dependabot.yml ] && cp .github/dependabot.yml "$OUT/dependabot.yml"
[ -f .github/CODEOWNERS ] && cp .github/CODEOWNERS "$OUT/CODEOWNERS"
for f in .github/workflows/*.yml .github/workflows/*.yaml; do [ -f "$f" ] && cp "$f" "$OUT/workflows/"; done
git ls-files '*package.json' '*package-lock.json' '*Dockerfile*' 'docker-compose*.yml' | node -e '
const l=require("fs").readFileSync(0,"utf8").split("\n").filter(Boolean);process.stdout.write(JSON.stringify(l,null,1)+"\n")' > "$OUT/manifests.json"

# 定期監査（security.yml）の実績: スケジュール・直近の成功・成果物の名前
node scripts/ci/audit-workflow.mjs "$OUT" "$REPO" > "$OUT/audit-workflow.json" 2> /dev/null || echo '{"__error__":{"http_status":null,"message":"audit-workflow を作れなかった"}}' > "$OUT/audit-workflow.json"

printf '{"repo":"%s","default_branch":"%s","checked_sha":"%s","captured_at":"%s","tool":"scripts/ci/snapshot-github.sh","gh_version":"%s"}\n' \
  "$REPO" "$DEFAULT_BRANCH" "${SHA:-}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(gh --version | head -n 1 | tr -d '"')" > "$OUT/snapshot-meta.json"
echo "GitHub の統制スナップショットを ${OUT}/ に保存した（repo: ${REPO}、既定 branch: ${DEFAULT_BRANCH}、check-runs の commit: ${SHA:-なし}）"
