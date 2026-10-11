// 依存ゼロの引数パーサ。`--key value` と `--flag`、同じキーの繰り返し（配列）に対応する。
const push = (out, key, value) => {
  out[key] = key in out ? [].concat(out[key], value) : value;
};

export function parseArgs(argv, { flags = [] } = {}) {
  const out = { _: [] };
  let i = 0;
  while (i < argv.length) {
    const a = argv[i++];
    if (!a.startsWith("--")) out._.push(a);
    else if (flags.includes(a.slice(2))) out[a.slice(2)] = true;
    else if (i >= argv.length) throw new Error(`${a} に値が無い`);
    else push(out, a.slice(2), argv[i++]);
  }
  return out;
}

export const asList = (v) => (v === undefined ? [] : [].concat(v));
