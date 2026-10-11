// unit テストの観察（入力 → 実際の結果の実測表）。import するだけで各テストの終了時に書き出される。
import { observeEachTest } from "../../test-support/observe-node-test.js";
import { describeText, describeValidation } from "../../test-support/observe.js";

export const observations = observeEachTest({ layer: "unit", component: "backend" });
/** 入力と、検証関数が実際に返した結果を 1 行残す。 */
export const observeValidation = (input, result) =>
  observations.row(describeText(input), describeValidation(result));
export const observe = (label, value) => observations.note(label, value);
