// docker compose の構成（`docker compose config --format json` の出力）の設定誤りを検査し、SARIF にする。
// trivy の misconfig は compose を扱わないため、ここで最小限のルールを持つ。ルールは CKV/AVD の名前と衝突しないよう COMPOSE- で始める。
const RULES = {
  "COMPOSE-001": {
    name: "privileged コンテナ",
    score: 8.5,
    help: "privileged: true はホストの全デバイスと権限をコンテナに渡す。",
  },
  "COMPOSE-002": {
    name: "ホストのネットワークを共有",
    score: 7.5,
    help: "network_mode: host はコンテナをホストのネットワーク名前空間に置く。",
  },
  "COMPOSE-003": {
    name: "Docker ソケットのマウント",
    score: 9.5,
    help: "/var/run/docker.sock のマウントはホストの root 権限と同等。",
  },
  "COMPOSE-004": {
    name: "秘密情報らしい値を environment に直書き",
    score: 8.0,
    help: "パスワード・トークンらしいキーに値が直書きされている。secrets か実行時の注入にする。",
  },
  "COMPOSE-005": {
    name: "内部用サービスのポートをホストに公開",
    score: 5.0,
    help: "backend など内部専用のサービスは ports で公開せず、ネットワーク内の到達に限る。",
  },
  "COMPOSE-006": {
    name: "公開ポートを全インターフェースに bind",
    score: 3.0,
    help: "ローカル専用なら 127.0.0.1 に bind する。",
  },
  "COMPOSE-007": {
    name: "権限の絞り込みが無い（cap_drop / no-new-privileges）",
    score: 3.0,
    help: "cap_drop: [ALL] と security_opt: [no-new-privileges:true] で権限を最小にする。",
  },
  "COMPOSE-008": {
    name: "サードパーティのイメージが digest 固定でない",
    score: 3.0,
    help: "image: は tag@sha256:… で固定する（ビルドする自作イメージは対象外）。",
  },
};
const SECRET_KEY = /(PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|PRIVATE_?KEY)/i;
const SOCK = /docker\.sock/;
const INTERNAL = new Set(["backend", "api", "db", "database"]);

const hit = (rule, service, detail) => ({ rule, service, detail });

function portHits(name, svc) {
  return (svc.ports ?? []).flatMap((p) => {
    const out = INTERNAL.has(name) ? [hit("COMPOSE-005", name, `${p.published}:${p.target}`)] : [];
    const ip = p.host_ip;
    return !ip || ip === "0.0.0.0"
      ? [...out, hit("COMPOSE-006", name, `${p.published}:${p.target} が全インターフェース`)]
      : out;
  });
}

function envHits(name, svc) {
  const env = svc.environment ?? {};
  return Object.entries(env)
    .filter(([k, val]) => SECRET_KEY.test(k) && val && !String(val).startsWith("$"))
    .map(([k]) => hit("COMPOSE-004", name, k));
}

const hardening = (svc) =>
  (svc.cap_drop ?? []).map(String).some((c) => c.toUpperCase() === "ALL") &&
  (svc.security_opt ?? []).some((o) => String(o).includes("no-new-privileges"));

const flagHits = (name, svc) =>
  [
    svc.privileged && hit("COMPOSE-001", name, "privileged: true"),
    svc.network_mode === "host" && hit("COMPOSE-002", name, "network_mode: host"),
    (svc.volumes ?? []).some((v) => SOCK.test(v.source ?? "")) && hit("COMPOSE-003", name, "docker.sock"),
    !hardening(svc) && hit("COMPOSE-007", name, "cap_drop: [ALL] と no-new-privileges が無い"),
  ].filter(Boolean);

const unpinned = (svc) => svc.image && !svc.build && !String(svc.image).includes("@sha256:");

function serviceHits(name, svc) {
  const pin = unpinned(svc) ? [hit("COMPOSE-008", name, svc.image)] : [];
  return [...flagHits(name, svc), ...pin, ...portHits(name, svc), ...envHits(name, svc)];
}

export function checkCompose(config) {
  return Object.entries(config.services ?? {}).flatMap(([name, svc]) => serviceHits(name, svc));
}

const levelOf = (score) => (score >= 7 ? "error" : score >= 4 ? "warning" : "note");

export function composeToSarif(hits, file, nowIso) {
  const used = [...new Set(hits.map((h) => h.rule))];
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "compose-check",
            semanticVersion: "1.0.0",
            informationUri: "scripts/security/check-compose.mjs",
            rules: used.map((id) => ({
              id,
              name: RULES[id].name,
              shortDescription: { text: RULES[id].name },
              help: { text: RULES[id].help },
              properties: {
                tags: ["misconfiguration", "compose"],
                "security-severity": String(RULES[id].score),
              },
            })),
          },
        },
        results: hits.map((h) => ({
          ruleId: h.rule,
          level: levelOf(RULES[h.rule].score),
          message: { text: `${RULES[h.rule].name}: services.${h.service}（${h.detail}）` },
          locations: [{ physicalLocation: { artifactLocation: { uri: file }, region: { startLine: 1 } } }],
          properties: {
            "security-severity": String(RULES[h.rule].score),
            component: `services.${h.service}`,
          },
        })),
        invocations: [{ executionSuccessful: true, endTimeUtc: nowIso }],
      },
    ],
  };
}
