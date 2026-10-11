// 観測サンプラーの出力（docker stats の文字列・JSONL）を扱う純関数。
import { mean, percentile, round, slope } from "./stats.mjs";

const UNITS = {
  b: 1,
  kb: 1000,
  mb: 1e6,
  gb: 1e9,
  tb: 1e12,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  tib: 1024 ** 4,
};

// "20.5MiB" → バイト数
export function parseSize(text) {
  const m = /^\s*([0-9.]+)\s*([A-Za-z]+)\s*$/.exec(text || "");
  if (!m) return null;
  const unit = UNITS[m[2].toLowerCase()];
  return unit === undefined ? null : Math.round(parseFloat(m[1]) * unit);
}

export function parsePercent(text) {
  const m = /^\s*([0-9.]+)\s*%\s*$/.exec(text || "");
  return m ? parseFloat(m[1]) : null;
}

// docker stats --no-stream --format '{{json .}}' の 1 行（オブジェクト）を共通形式に直す
export function parseStatsRecord(rec, service) {
  const [used, limit] = (rec.MemUsage || "").split("/");
  const [netIn, netOut] = (rec.NetIO || "").split("/");
  return {
    service,
    cpu_pct: parsePercent(rec.CPUPerc),
    mem_bytes: parseSize(used),
    mem_limit_bytes: parseSize(limit),
    net_in_bytes: parseSize(netIn),
    net_out_bytes: parseSize(netOut),
    pids: rec.PIDs === undefined ? null : parseInt(rec.PIDs, 10),
  };
}

// "ls -l" ではなく "stat -c '%n %s'" の出力（1 行 1 ファイル）を { ファイル名: バイト } にする
export function parseDbFiles(text) {
  const files = {};
  for (const line of (text || "").split("\n")) {
    const m = /^(\S+)\s+(\d+)$/.exec(line.trim());
    if (m) files[m[1].split("/").pop()] = parseInt(m[2], 10);
  }
  return files;
}

export function parseJsonl(text) {
  return text
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function within(rec, win) {
  const ms = Date.parse(rec.ts);
  return ms >= win.startMs && ms <= win.endMs;
}

function describe(values) {
  if (values.length === 0) return null;
  return {
    n: values.length,
    mean: round(mean(values)),
    p95: round(percentile(values, 0.95)),
    max: round(Math.max(...values)),
  };
}

function seriesFor(records, service, field) {
  return records.filter((r) => r.kind === "docker_stats" && r.service === service && r[field] !== null);
}

function memSummary(recs) {
  if (recs.length === 0) return null;
  const mib = (r) => r.mem_bytes / 1024 ** 2;
  const t0 = Date.parse(recs[0].ts);
  const pts = recs.map((r) => [(Date.parse(r.ts) - t0) / 60000, mib(r)]);
  const edge = Math.max(1, Math.floor(recs.length * 0.1));
  const first = mean(recs.slice(0, edge).map(mib));
  const last = mean(recs.slice(-edge).map(mib));
  return {
    start_mib: round(first),
    end_mib: round(last),
    max_mib: round(Math.max(...recs.map(mib))),
    growth_ratio: first > 0 ? round(last / first, 4) : null,
    slope_mib_per_min: round(slope(pts), 4),
  };
}

function healthSummary(records) {
  const h = records.filter((r) => r.kind === "health" && r.ms !== null);
  const ok = h.filter((r) => r.status === 200 && r.body_ok === true);
  const ms = h.map((r) => r.ms);
  return {
    n: h.length,
    ok: ok.length,
    p50_ms: round(percentile(ms, 0.5)),
    p95_ms: round(percentile(ms, 0.95)),
    p99_ms: round(percentile(ms, 0.99)),
    max_ms: round(ms.length ? Math.max(...ms) : null),
  };
}

function dbSummary(records) {
  const d = records.filter((r) => r.kind === "db" && r.bytes !== null);
  if (d.length === 0) return null;
  const total = d.map((r) => r.bytes);
  return {
    start_bytes: total[0],
    end_bytes: total[total.length - 1],
    max_bytes: Math.max(...total),
    growth_bytes: total[total.length - 1] - total[0],
  };
}

// 窓（k6 の最初〜最後の要求）に入ったサンプルだけを要約する。窓の外は warm-up・後片付けとして除く
export function summarizeObserve(all, win, services) {
  const records = all.filter((r) => r.kind !== "meta" && within(r, win));
  const out = { window_samples: records.length, services: {} };
  for (const s of services) {
    const cpu = seriesFor(records, s, "cpu_pct");
    out.services[s] = {
      cpu_pct: describe(cpu.map((r) => r.cpu_pct)),
      memory: memSummary(seriesFor(records, s, "mem_bytes")),
    };
  }
  out.health = healthSummary(records);
  out.db = dbSummary(records);
  return out;
}

// 観測の時刻整合: サンプルが k6 の窓の前後を覆っているか（窓内のサンプル数と窓の秒数の比）
export function coverage(all, win) {
  const secs = (win.endMs - win.startMs) / 1000;
  const stats = all.filter((r) => r.kind === "docker_stats" && within(r, win));
  const services = new Set(stats.map((r) => r.service));
  const perService = services.size || 1;
  return {
    window_sec: round(secs, 1),
    docker_stats_samples: stats.length,
    samples_per_sec_per_service: round(stats.length / perService / (secs || 1), 3),
  };
}
