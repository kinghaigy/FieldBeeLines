import { describe, expect, it } from "vitest";
import { selectPoint, selectionLine } from "../src/selection/selection";
import type { Position } from "../src/types";

describe("point selection", () => {
  it("keeps two distinct points, ignores duplicates, and clears on a third", () => {
    const first: Position = [1, 2];
    const second: Position = [3, 4];
    const selected = selectPoint(selectPoint([], first), second);
    expect(selected).toEqual([first, second]);
    expect(selectPoint(selected, [1, 2])).toBe(selected);
    expect(selectPoint(selected, [5, 6])).toEqual([]);
    expect(selected).toEqual([first, second]);
  });

  it("only returns a finite, distinct two-point line", () => {
    expect(selectionLine([])).toBeNull();
    expect(selectionLine([[1, 2]])).toBeNull();
    expect(
      selectionLine([
        [1, 2],
        [1, 2],
      ]),
    ).toBeNull();
    expect(
      selectionLine([
        [NaN, 2],
        [3, 4],
      ]),
    ).toBeNull();
    expect(
      selectionLine([
        [1, 2],
        [3, 4],
        [5, 6],
      ]),
    ).toBeNull();
    expect(
      selectionLine([
        [1, 2],
        [3, 4],
      ]),
    ).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });
});
