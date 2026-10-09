import { describe, expect, it, vi } from "vitest";
import proj4 from "proj4";
import { loadCatalogue, searchCatalogue } from "../src/crs/catalogue";
import { conversionDetails, transformDrawing } from "../src/crs/transform";
import type { Crs, Drawing, Position } from "../src/types";

vi.mock("proj4", async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof proj4 }>();
  return {
    ...actual,
    default: Object.assign(vi.fn(actual.default), actual.default),
  };
});

const drawingAt = (position: Position): Drawing => ({
  entities: [
    { id: "point", layer: "Controls", type: "POINT", coordinates: [position] },
  ],
  units: 6,
  warnings: ["Import warning"],
  skipped: { "unsupported:CIRCLE": 1 },
});
const customCrs = (definition: string): Crs => ({
  code: "CUSTOM",
  name: "Custom",
  definition,
  area: "",
  bounds: null,
});

describe("CRS catalogue and transformation", () => {
  it("loads recognised metre projected records and remaps metadata bounds", async () => {
    const catalogue = await loadCatalogue();
    expect(catalogue.length).toBeGreaterThan(3000);
    expect(catalogue.find((crs) => crs.code === "EPSG:28354")).toMatchObject({
      name: "GDA94 / MGA zone 54",
      bounds: [138, -48.19, 144.01, -9.08],
    });
    expect(
      catalogue.some((crs) => ["EPSG:4326", "EPSG:2277"].includes(crs.code)),
    ).toBe(false);
    expect(
      searchCatalogue(catalogue, "28354").map((crs) => crs.code),
    ).toContain("EPSG:28354");
    expect(searchCatalogue(catalogue, "MGA Australia").length).toBeGreaterThan(
      0,
    );
  });

  it.each([
    ["28355", [500000, 10000000], [147, 0]],
    ["26915", [500000, 0], [-93, 0]],
    ["25832", [500000, 0], [9, 0]],
  ] as [string, Position, Position][])(
    "matches independent UTM central-meridian anchor EPSG:%s",
    async (code, source, expected) => {
      const crs = (await loadCatalogue()).find(
        (candidate) => candidate.code === `EPSG:${code}`,
      )!;
      const drawing = drawingAt(source);
      const transformed = transformDrawing(drawing, crs);
      expect(transformed.entities[0].coordinates[0][0]).toBeCloseTo(
        expected[0],
        8,
      );
      expect(transformed.entities[0].coordinates[0][1]).toBeCloseTo(
        expected[1],
        8,
      );
      expect(transformed.units).toBe(6);
      expect(transformed.skipped).toEqual(drawing.skipped);
      expect(conversionDetails(crs).limitations.join(" ")).toMatch(
        /epoch.*not verified.*RTK/,
      );
      expect(transformed.warnings.join(" ")).toMatch(/outside.*area of use/);
      expect(drawing.entities[0].coordinates[0]).toEqual(source);
      expect(drawing.warnings).toEqual(["Import warning"]);
    },
  );

  it("retains longitude-latitude order in Australia and warns only for out-of-area positions", async () => {
    const crs = (await loadCatalogue()).find(
      (candidate) => candidate.code === "EPSG:28354",
    )!;
    const result = transformDrawing(drawingAt([500000, 6200000]), crs);
    const [longitude, latitude] = result.entities[0].coordinates[0];
    expect(longitude).toBeCloseTo(141, 8);
    expect(latitude).toBeGreaterThan(-35);
    expect(latitude).toBeLessThan(-34);
    expect(result.warnings.join(" ")).not.toMatch(/outside/);
  });

  it("describes the real EPSG:32754 definition as an inverse WGS84 projection without a universal datum warning", async () => {
    const crs = (await loadCatalogue()).find(
      (candidate) => candidate.code === "EPSG:32754",
    )!;
    expect(conversionDetails(crs)).toMatchObject({
      kind: "projection-only",
      summary: expect.stringMatching(/Inverse map projection.*WGS84/),
      operation: expect.stringMatching(/Inverse utm map projection/),
      limitations: ["No datum or coordinate-epoch adjustment is applied."],
    });
    const result = transformDrawing(drawingAt([500000, 6200000]), crs);
    expect(result.warnings).toEqual(["Import warning"]);
  });

  it("does not claim precise WGS84 equivalence for the zero-shift GDA2020 definition", async () => {
    const crs = (await loadCatalogue()).find(
      (candidate) => candidate.code === "EPSG:7854",
    )!;
    const details = conversionDetails(crs);
    expect(details.kind).toBe("datum-operation");
    expect(details.operation).toContain("towgs84=0,0,0,0,0,0,0");
    expect(details.limitations).toContain(
      "No nonzero datum shift is specified in the bundled definition; this does not establish equivalence to precise WGS84.",
    );
    expect(details.summary).toContain(
      "precise reference-frame equivalence is not established",
    );
  });

  it.each([
    ["+datum=WGS84 +towgs84=1,2,3", "3-parameter", "1,2,3"],
    ["+ellps=GRS80 +towgs84=1,2,3,4,5,6,7", "7-parameter", "1,2,3,4,5,6,7"],
  ])(
    "describes actual nonzero Helmert parameters for %s",
    (datum, count, parameters) => {
      const details = conversionDetails(
        customCrs(`+proj=utm +zone=15 +units=m ${datum}`),
      );
      expect(details.kind).toBe("datum-operation");
      expect(details.operation).toContain(`${count} Helmert`);
      expect(details.operation).toContain(`towgs84=${parameters}`);
      expect(details.operation).toContain("translations in metres");
      if (count === "7-parameter") {
        expect(details.operation).toContain(
          "rotations in arcseconds, scale in ppm",
        );
      }
    },
  );

  it("uses the parsed definition rather than the source code or name", () => {
    const crs = {
      ...customCrs("+proj=utm +zone=54 +south +ellps=GRS80 +units=m"),
      code: "EPSG:32754",
      name: "WGS 84 / UTM zone 54S",
    };
    const details = conversionDetails(crs);
    expect(details.kind).toBe("datum-operation");
    expect(details.operation).toContain("no explicit datum correction");
    expect(details.limitations.join(" ")).toMatch(/not established.*RTK/);
  });

  it.each(["+towgs84=0,0,0", "+nadgrids=@null"])(
    "describes zero or null shifts conservatively for %s",
    (shift) => {
      const details = conversionDetails(
        customCrs(`+proj=utm +zone=15 +ellps=GRS80 +units=m ${shift}`),
      );
      expect(details.kind).toBe("datum-operation");
      expect(details.limitations).toContain(
        "No nonzero datum shift is specified in the bundled definition; this does not establish equivalence to precise WGS84.",
      );
    },
  );

  it.each([
    ["", /Invalid/],
    ["+proj=unknown +units=m", /Invalid/],
    ["+proj=longlat +datum=WGS84", /projected/],
    ["+proj=geocent +datum=WGS84 +units=m", /projected/],
    ["+proj=utm +zone=15 +datum=WGS84 +units=ft", /metre/],
    ["+proj=utm +zone=15 +datum=WGS84", /metre/],
    [
      "+proj=utm +zone=15 +datum=WGS84 +units=m +nadgrids=missing.gsb",
      /Missing required.*missing.gsb/,
    ],
    [
      "+proj=utm +zone=15 +datum=WGS84 +units=m +geoidgrids=missing.gtx",
      /vertical grids/,
    ],
  ])(
    "blocks invalid, nonmetre or unavailable-grid definition %s",
    (definition, message) => {
      expect(() =>
        transformDrawing(drawingAt([500000, 0]), customCrs(definition)),
      ).toThrow(message);
    },
  );

  it("warns about optional-grid fallback and missing bounds", () => {
    const crs = customCrs(
      "+proj=utm +zone=15 +datum=WGS84 +units=m +nadgrids=@missing.gsb,@null",
    );
    expect(conversionDetails(crs)).toMatchObject({
      kind: "datum-operation",
      operation: expect.stringMatching(
        /missing.gsb \(optional\).*null \(null shift\)/,
      ),
    });
    const result = transformDrawing(drawingAt([500000, 0]), crs);
    expect(result.warnings.join(" ")).toMatch(
      /Optional datum grids unavailable.*fallback/,
    );
    expect(result.warnings.join(" ")).toMatch(/bounds are unavailable/);
  });

  it("rejects nonfinite source and nonfinite or out-of-range results without losing entities", () => {
    const crs = customCrs("+proj=utm +zone=15 +datum=WGS84 +units=m");
    expect(() => transformDrawing(drawingAt([Infinity, 0]), crs)).toThrow(
      /Nonfinite source/,
    );
    for (const result of [
      [NaN, 0],
      [-93, Infinity],
      [181, 0],
      [0, 91],
    ]) {
      vi.mocked(proj4).mockReturnValueOnce({
        forward: () => result,
      } as unknown as ReturnType<typeof proj4>);
      expect(() => transformDrawing(drawingAt([500000, 0]), crs)).toThrow(
        /out-of-range/,
      );
    }
  });
});
