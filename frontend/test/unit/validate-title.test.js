// TC-021〜TC-029: タイトル検証の境界値（backend の検証関数にも同じ入力表を流す）。DS-003。
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { countCodePoints, validateTitle } from "../../src/validation.js";
import { MESSAGES } from "../../src/messages.js";
import { validateTitle as validateTitleOnBackend } from "../../../backend/src/domain/title.js";

const a = (n) => "a".repeat(n);
const accepted = (input, title) => ({ input, expected: { ok: true, title } });
const rejected = (input, code) => ({ input, expected: { ok: false, code } });

function run(label, rows) {
  for (const { input, expected } of rows) {
    const name = `${label} ${JSON.stringify(input.length > 30 ? `${input.slice(0, 12)}…(${[...input].length}cp)` : input)}`;
    it(name, () => assert.deepEqual(validateTitle(input), expected));
  }
}

describe("validateTitle", () => {
  describe("[TC-021] 0 文字・空白のみは必須エラー", () => {
    run("[TC-021]", [
      rejected("", "TITLE_REQUIRED"),
      rejected("   ", "TITLE_REQUIRED"),
      rejected("\t", "TITLE_REQUIRED"),
    ]);
  });

  describe("[TC-022] 下限（1 文字・2 文字）は受け付ける", () => {
    run("[TC-022]", [accepted("a", "a"), accepted("あ", "あ"), accepted("ab", "ab")]);
  });

  describe("[TC-023] 上限の手前（99・100）は受け付ける", () => {
    run("[TC-023]", [accepted(a(99), a(99)), accepted(a(100), a(100))]);
  });

  describe("[TC-024] 上限超過（101・102）は長さエラー", () => {
    run("[TC-024]", [rejected(a(101), "TITLE_TOO_LONG"), rejected(a(102), "TITLE_TOO_LONG")]);
  });

  describe("[TC-025] コードポイントで数える（サロゲートペア・結合文字）", () => {
    run("[TC-025]", [
      accepted("😀".repeat(100), "😀".repeat(100)),
      rejected("😀".repeat(101), "TITLE_TOO_LONG"),
      accepted("e\u0301".repeat(50), "e\u0301".repeat(50)),
      rejected("e\u0301".repeat(51), "TITLE_TOO_LONG"),
    ]);
    it("[TC-025] 😀×100 は UTF-16 長 200 だがコードポイントは 100", () => {
      assert.equal("😀".repeat(100).length, 200);
      assert.equal(countCodePoints("😀".repeat(100)), 100);
    });
  });

  describe("[TC-026] 前後の空白を除去してから長さを判定する", () => {
    run("[TC-026]", [
      accepted("  買い物  ", "買い物"),
      accepted(` ${a(100)} `, a(100)),
      rejected(`  ${a(101)}  `, "TITLE_TOO_LONG"),
    ]);
  });

  describe("[TC-027] 改行を含むと改行エラー", () => {
    run("[TC-027]", [rejected("a\nb", "TITLE_MULTILINE"), rejected("a\r\nb", "TITLE_MULTILINE")]);
  });

  describe("[TC-028] 空白の範囲は String.prototype.trim() と同じ（UNK-006）", () => {
    run("[TC-028]", [
      rejected("\u3000", "TITLE_REQUIRED"),
      accepted("\u00a0a\u00a0", "a"),
      accepted("\na\n", "a"),
    ]);
  });

  describe("[TC-029] 検証順は 必須 → 長さ → 改行（UNK-001）", () => {
    run("[TC-029]", [
      rejected("   \n  ", "TITLE_REQUIRED"),
      rejected(`${a(50)}\n${a(60)}`, "TITLE_TOO_LONG"),
      rejected("a\nb", "TITLE_MULTILINE"),
    ]);
  });

  describe("入力が文字列でない場合は必須エラー", () => {
    for (const value of [undefined, null, 123, {}]) {
      it(`${JSON.stringify(value)}`, () =>
        assert.deepEqual(validateTitle(value), { ok: false, code: "TITLE_REQUIRED" }));
    }
  });
});

describe("messages", () => {
  it("[TC-021] [TC-024] [TC-027] エラー文言は仕様書と完全一致", () => {
    assert.equal(MESSAGES.TITLE_REQUIRED, "タスク名を入力してください");
    assert.equal(MESSAGES.TITLE_TOO_LONG, "タスク名は100文字以内で入力してください");
    assert.equal(MESSAGES.TITLE_MULTILINE, "タスク名は1行で入力してください");
    assert.equal(MESSAGES.STORAGE_FAILURE, "保存できませんでした。もう一度お試しください");
    assert.equal(MESSAGES.DATA_CORRUPT, "保存データを読み込めませんでした");
  });
});

// 「backend と同一規則」の担保: 同じ入力を両方の検証関数へ流し、合否・コード・保存用の title が一致することを確かめる。
describe("frontend と backend の検証関数が一致する", () => {
  const inputs = [
    "",
    " ",
    "   ",
    "\t",
    "\u3000",
    "\u00a0a\u00a0",
    "\na\n",
    "   \n  ",
    "a\nb",
    "a\r\nb",
    "a",
    "あ",
    "  買い物  ",
    "a".repeat(99),
    "a".repeat(100),
    "a".repeat(101),
    ` ${"a".repeat(100)} `,
    `  ${"a".repeat(101)}  `,
    `${"a".repeat(50)}\n${"a".repeat(60)}`,
    "😀".repeat(100),
    "😀".repeat(101),
    "e\u0301".repeat(50),
    "e\u0301".repeat(51),
    "<img src=x onerror=alert(1)>",
    "a".repeat(100_000),
  ];
  for (const input of inputs) {
    it(`[TC-029] ${JSON.stringify(input.length > 24 ? `${input.slice(0, 12)}…(${[...input].length}cp)` : input)}`, () => {
      const front = validateTitle(input);
      const back = validateTitleOnBackend(input);
      assert.equal(front.ok, back.ok);
      if (front.ok) assert.equal(front.title, back.title);
      else assert.equal(front.code, back.code);
    });
  }
});
