// 引数の読み取り（--key value / --flag）。副作用なし。
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      out._.push(a);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      out[a.slice(2)] = argv[i + 1];
      i += 1;
    } else {
      out[a.slice(2)] = true;
    }
  }
  return out;
}

export function requireArg(args, name) {
  if (args[name] === undefined || args[name] === true) throw new Error(`--${name} が必要です`);
  return args[name];
}
