#!/usr/bin/env bash
# リポジトリ設定・Ruleset（.github/settings/）を gh api で適用する。冪等。
#   scripts/ci/apply-settings.sh --dry-run   # 差分だけを表示（変更しない）。適用前に必ずこれで確認する
#   scripts/ci/apply-settings.sh             # 差分のある項目だけを適用する
# 要: gh（リポジトリ管理者の認証）、node 24（mise）。適用はリポジトリの管理者が行う。
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
exec node scripts/ci/apply-settings.mjs "$@"
