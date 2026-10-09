import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearRecentCrs,
  loadRecentCrs,
  rememberCrs,
  saveDrawing,
} from "../src/storage/browser";

const RECENT_CRS_KEY = "fieldbee-lines:recent-crs";

describe("recent CRS storage", () => {
  let values: Map<string, string>;
  let storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;

  beforeEach(() => {
    values = new Map();
    storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        values.delete(key);
      }),
    };
    vi.stubGlobal("localStorage", storage);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("loads an empty history when nothing is stored", () => {
    expect(loadRecentCrs()).toEqual([]);
  });

  it.each(["broken JSON", "null", "{}", '"EPSG:4326"', "42"])(
    "safely ignores corrupt metadata: %s",
    (value) => {
      values.set(RECENT_CRS_KEY, value);
      expect(loadRecentCrs()).toEqual([]);
    },
  );

  it("sanitizes types, malformed codes, and duplicate stored entries", () => {
    values.set(
      RECENT_CRS_KEY,
      JSON.stringify([
        "EPSG:4326",
        null,
        4326,
        {},
        "epsg:4326",
        " EPSG:27700",
        "EPSG:27700 ",
        "EPSG:",
        "EPSG:1.5",
        "EPSG:4326",
        "EPSG:27700",
      ]),
    );
    expect(loadRecentCrs()).toEqual(["EPSG:4326", "EPSG:27700"]);
  });

  it("caps stored history at eight valid unique entries in stored order", () => {
    const codes = Array.from({ length: 12 }, (_, index) => `EPSG:${index + 1}`);
    values.set(RECENT_CRS_KEY, JSON.stringify([null, codes[0], ...codes]));
    expect(loadRecentCrs()).toEqual(codes.slice(0, 8));
  });

  it("moves a remembered code to the front and persists deduplicated history", () => {
    rememberCrs("EPSG:4326");
    rememberCrs("EPSG:27700");
    expect(rememberCrs("EPSG:4326")).toEqual(["EPSG:4326", "EPSG:27700"]);
    expect(JSON.parse(values.get(RECENT_CRS_KEY)!)).toEqual(loadRecentCrs());
  });

  it("keeps only the eight most recently remembered codes", () => {
    for (let index = 1; index <= 10; index += 1) rememberCrs(`EPSG:${index}`);
    expect(loadRecentCrs()).toEqual([
      "EPSG:10",
      "EPSG:9",
      "EPSG:8",
      "EPSG:7",
      "EPSG:6",
      "EPSG:5",
      "EPSG:4",
      "EPSG:3",
    ]);
  });

  it("repairs corrupted stored history when remembering a valid code", () => {
    values.set(RECENT_CRS_KEY, "not JSON");
    expect(rememberCrs("EPSG:4326")).toEqual(["EPSG:4326"]);
    expect(loadRecentCrs()).toEqual(["EPSG:4326"]);
  });

  it.each(["", "4326", "epsg:4326", "EPSG:-1", "EPSG:4326\n"])(
    "rejects invalid input without modifying storage: %s",
    (code) => {
      expect(() => rememberCrs(code)).toThrow(TypeError);
      expect(storage.setItem).not.toHaveBeenCalled();
    },
  );

  it("loads safely when localStorage is unavailable", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(loadRecentCrs()).toEqual([]);
    expect(() => rememberCrs("EPSG:4326")).toThrow();
  });

  it("loads safely when reading storage throws", () => {
    vi.mocked(storage.getItem).mockImplementation(() => {
      throw new Error("denied");
    });
    expect(loadRecentCrs()).toEqual([]);
  });

  it("propagates write and removal failures", () => {
    const error = new Error("quota exceeded");
    vi.mocked(storage.setItem).mockImplementation(() => {
      throw error;
    });
    vi.mocked(storage.removeItem).mockImplementation(() => {
      throw error;
    });
    expect(() => rememberCrs("EPSG:4326")).toThrow(error);
    expect(() => clearRecentCrs()).toThrow(error);
  });

  it("clears only CRS history", () => {
    rememberCrs("EPSG:4326");
    values.set("unrelated", "keep");
    clearRecentCrs();
    expect(loadRecentCrs()).toEqual([]);
    expect(values.get("unrelated")).toBe("keep");
  });
});

describe("drawing input validation", () => {
  it.each([
    { name: "", text: "DXF" },
    { name: "drawing.txt", text: "DXF" },
    { name: "drawing.dxf", text: "" },
    { name: "drawing.dxf", text: " \n " },
    { name: 42, text: "DXF" },
    { name: "drawing.dxf", text: null },
    {
      name: "drawing.dxf",
      text: "DXF",
      plot: { crsCode: "wrong", unitsConfirmed: true },
    },
    {
      name: "drawing.dxf",
      text: "DXF",
      plot: { crsCode: "EPSG:32754", unitsConfirmed: "true" },
    },
    { name: "drawing.dxf", text: "DXF", plot: null },
    null,
    [],
  ])(
    "rejects invalid drawing metadata before opening storage: %j",
    async (value) => {
      await expect(
        saveDrawing(value as Parameters<typeof saveDrawing>[0]),
      ).rejects.toThrow(TypeError);
    },
  );
});
