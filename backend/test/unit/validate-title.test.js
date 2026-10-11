// TC-021〜TC-029: タイトル検証関数（backend）。frontend の検証関数にも同じ入力表を流す（テスト名は同じ TC-ID）。
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateTitle } from "../../src/domain/title.js";
import { observeValidation } from "../helpers/unit-observer.js";

const REQUIRED = { code: "TITLE_REQUIRED", message: "タスク名を入力してください" };
const TOO_LONG = { code: "TITLE_TOO_LONG", message: "タスク名は100文字以内で入力してください" };
const MULTILINE = { code: "TITLE_MULTILINE", message: "タスク名は1行で入力してください" };

function assertAccepted(input, expectedTitle) {
  const result = validateTitle(input);
  observeValidation(input, result);
  assert.deepEqual(result, { ok: true, title: expectedTitle });
}

function assertRejected(input, expected) {
  const result = validateTitle(input);
  observeValidation(input, result);
  assert.deepEqual(result, { ok: false, ...expected });
}

describe("validateTitle", () => {
  it("[TC-021] 0 文字・空白のみは TITLE_REQUIRED（保存用の title は返らない）", () => {
    for (const input of ["", "   ", "\t"]) {
      const result = validateTitle(input);
      observeValidation(input, result);
      assert.equal(result.ok, false, JSON.stringify(input));
      assert.equal(result.code, REQUIRED.code, JSON.stringify(input));
      assert.equal(result.message, REQUIRED.message, JSON.stringify(input));
      assert.equal("title" in result, false, JSON.stringify(input));
    }
  });

  it("[TC-022] 下限の 1 文字と 2 文字は合格し、入力と同一の title を返す", () => {
    for (const input of ["a", "あ", "ab"]) assertAccepted(input, input);
  });

  it("[TC-023] 上限ちょうど前の 99 文字と、ちょうどの 100 文字は合格する", () => {
    for (const length of [99, 100]) assertAccepted("a".repeat(length), "a".repeat(length));
  });

  it("[TC-024] 上限の 1 つ先（101・102 文字）は TITLE_TOO_LONG", () => {
    for (const length of [101, 102]) assertRejected("a".repeat(length), TOO_LONG);
  });

  it("[TC-025] 文字数は UTF-16 の長さでも書記素でもなくコードポイントで数える", () => {
    const emoji100 = "😀".repeat(100);
    assert.equal(emoji100.length, 200);
    assertAccepted(emoji100, emoji100);
    assertRejected("😀".repeat(101), TOO_LONG);
    assertAccepted("é".repeat(50), "é".repeat(50));
    assertRejected("é".repeat(51), TOO_LONG);
  });

  it("[TC-026] 長さは前後の空白を除去した後で判定し、title は除去後の値を返す", () => {
    assertAccepted("  買い物  ", "買い物");
    assertAccepted(` ${"a".repeat(100)} `, "a".repeat(100));
    assertRejected(`  ${"a".repeat(101)}  `, TOO_LONG);
  });

  it("[TC-027] 改行（LF・CRLF）を含むと TITLE_MULTILINE", () => {
    for (const input of ["a\nb", "a\r\nb"]) assertRejected(input, MULTILINE);
  });

  it("[TC-028] 前後の空白の範囲は暫定で String.prototype.trim() と同じ（未決 UNK-006）", () => {
    assertRejected("　", REQUIRED);
    assertAccepted(" a ", "a");
    assertAccepted("\na\n", "a");
  });

  it("[TC-029] 検証順は 必須 → 長さ → 改行で、返るエラーは 1 つだけ", () => {
    assertRejected("   \n  ", REQUIRED);
    assertRejected(`${"a".repeat(50)}\n${"a".repeat(60)}`, TOO_LONG);
    assertRejected("a\nb", MULTILINE);
  });

  it("[補助] 文字列以外が渡されても例外にならず、入力なしとして TITLE_REQUIRED にする", () => {
    for (const input of [undefined, null, 123, {}]) assertRejected(input, REQUIRED);
  });
});
