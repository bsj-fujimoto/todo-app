// 監視対象（最新リリースのイメージ / フォールバック）の決定に使う純関数。
export const stripV = (tag) => String(tag).replace(/^v/, "");

// タグが指すリリースのイメージを digest 固定で参照する（repo@sha256:…）
export function pinnedRef(image, digest) {
  return `${image}@${digest}`;
}

// compose の上書きファイル（YAML）。build は残るが --no-build で起動するので使われない
export function renderComposeOverride(images) {
  const lines = [
    "# resolve-target.mjs が生成（リリース済みイメージを digest 固定で使う）。手で編集しない。",
    "services:",
  ];
  for (const [service, ref] of Object.entries(images)) {
    lines.push(`  ${service}:`, `    image: ${ref}`, "    pull_policy: always");
  }
  return `${lines.join("\n")}\n`;
}

export function releaseTarget({ release, images, commit }) {
  return {
    mode: "release",
    reason: `最新リリース ${release.tag_name} のイメージを digest 固定で使う`,
    release_tag: release.tag_name,
    release_published_at: release.published_at,
    images,
    expected_version: stripV(release.tag_name),
    expected_commit: commit || "",
  };
}

export function fallbackTarget({ reason, commit }) {
  return {
    mode: "fallback",
    reason,
    release_tag: null,
    release_published_at: null,
    images: {},
    expected_version: "",
    expected_commit: commit || "",
  };
}
