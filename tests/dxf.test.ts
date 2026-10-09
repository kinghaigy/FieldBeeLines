import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { parseDrawing } from "../src/dxf/parse";
import type { ImportRequest } from "../src/workers/import.worker";

const wrap = (body: string, units: string = "9\n$INSUNITS\n70\n6\n"): string =>
  `0\nSECTION\n2\nHEADER\n${units}0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${body}0\nENDSEC\n0\nEOF\n`;
const line =
  "0\nLINE\n8\nRows\n10\n500000\n20\n6200000\n11\n500100\n21\n6200000\n";
const point = "0\nPOINT\n10\n500000\n20\n6200000\n";

describe("ASCII DXF import", () => {
  it("imports a fixture with three lines and three points", () => {
    const fixture = readFileSync(
      new URL("./fixtures/demo.dxf", import.meta.url),
      "utf8",
    );
    const drawing = parseDrawing(fixture);
    expect(drawing.units).toBe(6);
    expect(
      drawing.entities.filter((entity) => entity.type === "LINE"),
    ).toHaveLength(3);
    expect(
      drawing.entities.filter((entity) => entity.type === "POINT"),
    ).toHaveLength(3);
    expect(new Set(drawing.entities.map((entity) => entity.id)).size).toBe(6);
    expect(drawing.warnings).toEqual([]);
  });

  it("imports WCS lines and points and records units without converting them", () => {
    const drawing = parseDrawing(wrap(line + point));
    expect(drawing.units).toBe(6);
    expect(drawing.entities.map((entity) => entity.type)).toEqual([
      "LINE",
      "POINT",
    ]);
    expect(drawing.entities[0].coordinates).toEqual([
      [500000, 6200000],
      [500100, 6200000],
    ]);
    expect(drawing.skipped).toEqual({});
    for (const unit of [0, 1, 2, 4, 6]) {
      expect(
        parseDrawing(wrap(point, `9\n$INSUNITS\n70\n${unit}\n`)).units,
      ).toBe(unit);
    }
    expect(parseDrawing(wrap(point, "")).units).toBeUndefined();
    expect(parseDrawing(wrap(point, "")).warnings.join(" ")).toMatch(/confirm/);
    expect(
      parseDrawing(wrap(point, "9\n$INSUNITS\n70\n2\n")).warnings.join(" "),
    ).toMatch(/not metres/);
    expect(parseDrawing(wrap(point, "9\n$INSUNITS\n70\n4\n")).warnings.join(" ")).toMatch(/not metres/);
    expect(parseDrawing(wrap(point, "9\n$INSUNITS\n70\n6\n")).warnings).toEqual([]);
  });

  it("rejects binary, truncated, malformed, and structurally incomplete files", () => {
    for (const text of [
      "",
      "AutoCAD Binary DXF\r\n\x1a\0",
      wrap(point).replace("0\nEOF\n", ""),
      wrap(point).replace("2\nHEADER", "2\nTABLES"),
      wrap(point) + "0\nPOINT\n",
      wrap(point).replace("0\nENDSEC", "0\nEOF"),
      "bogus\nSECTION\n",
      wrap(point, "9\n$INSUNITS\n70\nNaN\n"),
    ]) {
      expect(() => parseDrawing(text)).toThrow();
    }
  });

  it("counts unsupported, paper, extrusion, nonplanar and invalid geometry", () => {
    const drawing = parseDrawing(
      wrap(
        line.replace("500100", "500000") +
          point +
          "67\n1\n" +
          point +
          "410\nLayout1\n" +
          point +
          "210\n0\n220\n1\n230\n0\n" +
          line +
          "30\n1\n31\n2\n" +
          point.replace("500000", "Infinity") +
          point.replace("500000", "123junk") +
          point.replace("20\n6200000\n", "") +
          "0\nCIRCLE\n10\n1\n20\n2\n40\n3\n" +
          "0\nUNKNOWN_THING\n8\nIgnored\n",
      ),
    );
    expect(drawing.entities).toHaveLength(0);
    expect(drawing.skipped).toEqual({
      "zero-length": 1,
      "paper-space": 2,
      "nondefault-extrusion": 1,
      "nonplanar-z": 1,
      "invalid-coordinates": 3,
      "unsupported:CIRCLE": 1,
      "unsupported:UNKNOWN_THING": 1,
    });
    expect(drawing.warnings.join(" ")).toMatch(/UNKNOWN_THING \(1\)/);
  });

  it("warns when dropping constant elevation and accepts explicitly default extrusion", () => {
    const drawing = parseDrawing(
      wrap(
        line.replace("20\n6200000\n", "20\n6200000\n30\n100\n") +
          "31\n100\n" +
          point +
          "30\n50\n210\n0\n220\n0\n230\n1\n",
      ),
    );
    expect(drawing.entities).toHaveLength(2);
    expect(drawing.warnings.join(" ")).toMatch(
      /Dropped constant elevation from 2/,
    );
  });

  it("does not import nested sequence or block-definition geometry", () => {
    const body = "0\nPOLYLINE\n66\n1\n" + line + "0\nSEQEND\n" + point;
    const text = wrap(body).replace(
      "0\nEOF\n",
      `0\nSECTION\n2\nBLOCKS\n0\nBLOCK\n2\nExample\n${line}0\nENDBLK\n0\nENDSEC\n0\nEOF\n`,
    );
    const drawing = parseDrawing(text);
    expect(drawing.entities).toHaveLength(1);
    expect(drawing.skipped).toMatchObject({
      "unsupported:POLYLINE": 1,
      "nested:LINE": 1,
      "block-content:LINE": 1,
    });
  });

  it("worker returns request IDs with parsed, transformed, or failed results", async () => {
    const postMessage = vi.fn();
    vi.stubGlobal("postMessage", postMessage);
    vi.stubGlobal("onmessage", null);
    try {
      await import("../src/workers/import.worker");
      const handler = (
        globalThis as unknown as {
          onmessage: (event: MessageEvent<ImportRequest>) => void;
        }
      ).onmessage;
      handler({
        data: { id: 10, text: wrap(point) },
      } as MessageEvent<ImportRequest>);
      expect(postMessage.mock.calls[0][0]).toMatchObject({
        id: 10,
        drawing: { units: 6 },
      });
      handler({
        data: {
          id: 11,
          text: wrap(point),
          crs: {
            code: "EPSG:28354",
            name: "GDA94 / MGA zone 54",
            area: "Australia",
            bounds: [138, -48.19, 144.01, -9.08],
            definition: "+proj=utm +zone=54 +south +ellps=GRS80 +units=m",
          },
        },
      } as MessageEvent<ImportRequest>);
      expect(postMessage.mock.calls[1][0].id).toBe(11);
      expect(
        postMessage.mock.calls[1][0].drawing.entities[0].coordinates[0][0],
      ).toBeCloseTo(141, 8);
      handler({
        data: { id: 12, text: "invalid" },
      } as MessageEvent<ImportRequest>);
      expect(postMessage.mock.calls[2][0]).toEqual({
        id: 12,
        error: expect.any(String),
      });
      handler({
        data: {
          id: 13,
          text: wrap(point),
          crs: {
            code: "BAD",
            name: "Bad",
            area: "",
            bounds: null,
            definition: "+proj=unknown +units=m",
          },
        },
      } as MessageEvent<ImportRequest>);
      expect(postMessage.mock.calls[3][0]).toEqual({
        id: 13,
        error: expect.stringMatching(/CRS/),
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
