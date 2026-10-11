// 応答を「保留して解放する」ための門（DS-012 の遅延を、固定の待ち時間ではなく条件で再現する）。
export function createGate() {
  let release;
  const opened = new Promise((resolve) => {
    release = resolve;
  });
  return { wait: () => opened, release };
}
