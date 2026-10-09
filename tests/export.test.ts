import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { exportLine, uniqueFilename } from "../src/export/geojson";
import type { Line } from "../src/types";

describe("FieldBee export", () => {
  it("matches the user-provided accepted example exactly", () => {
    const text = readFileSync(
      new URL("../AB Line Row Center.geojson", import.meta.url),
      "utf8",
    );
    const sample = JSON.parse(text.slice(text.indexOf("{")));
    expect(
      exportLine(sample.name, sample.features[0].geometry.coordinates),
    ).toEqual(sample);
  });
  it("rejects degenerate and invalid coordinates", () => {
    expect(() =>
      exportLine("test", [
        [1, 2],
        [1, 2],
      ]),
    ).toThrow();
    expect(() =>
      exportLine("test", [
        [NaN, 2],
        [1, 3],
      ]),
    ).toThrow();
    expect(() =>
      exportLine("test", [
        [181, 2],
        [1, 3],
      ]),
    ).toThrow();
  });
  it("contains only the selected line and no extra features", () => {
    const coordinates: Line = [
      [140, -35],
      [140.1, -35.1],
    ];
    const result = exportLine("North paddock", coordinates);
    expect(result.features).toHaveLength(1);
    expect(result.features[0].geometry.coordinates).toHaveLength(2);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
  it("sanitizes names and avoids repeat filenames within a session", () => {
    expect(uniqueFilename("north/paddock.geojson.geojson", new Set())).toBe(
      "north-paddock.geojson",
    );
    expect(uniqueFilename("North", new Set(["north.geojson"]))).toBe(
      "North-2.geojson",
    );
    expect(() => uniqueFilename(" ", new Set())).toThrow();
  });
});
