// 再試行。monitors.yaml の retries は「最初の失敗の後に追加で行う回数」（retries: 2 なら最大 3 回試す）。
export async function runWithRetries(attemptFn, opts, deps) {
  const attempts = [];
  for (let i = 0; i <= opts.retries; i += 1) {
    const result = await attemptFn(i + 1);
    attempts.push(result);
    if (result.ok) break;
    if (i < opts.retries) await deps.sleep(opts.delayMs);
  }
  const last = attempts[attempts.length - 1];
  return {
    ok: last.ok,
    attempts: attempts.length,
    last,
    failures: attempts.filter((a) => !a.ok).map((a, i) => `試行 ${i + 1}: ${a.failure}`),
  };
}
