// テストごとの専用ディレクトリ・専用 DB パス（DS-001: 空 DB。backend が初回起動時にスキーマを作る）。
import { chmod, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function restorePermissions(dir) {
  // 読取専用（DS-008）のまま削除に失敗しないよう、必ず権限を戻す（ディレクトリは実行ビットも）
  await chmod(dir, 0o755).catch(() => {});
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  await Promise.all(
    entries.map((entry) =>
      entry.isDirectory()
        ? restorePermissions(join(dir, entry.name))
        : chmod(join(dir, entry.name), 0o644).catch(() => {}),
    ),
  );
}

/**
 * 専用の一時ディレクトリを作る。afterEach で必ず cleanup() を呼ぶ。
 * @returns {Promise<{dir: string, dbPath: string, path: (name: string) => string, cleanup: () => Promise<void>}>}
 */
export async function createSandbox(prefix = "todo-app-") {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  return {
    dir,
    dbPath: join(dir, "todo.db"),
    path: (name) => join(dir, name),
    async cleanup() {
      await restorePermissions(dir);
      await rm(dir, { recursive: true, force: true });
    },
  };
}
