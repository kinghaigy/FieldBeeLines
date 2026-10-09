import DxfParser from "dxf-parser";
import type { ILineEntity } from "dxf-parser/dist/entities/line";
import type { IPointEntity } from "dxf-parser/dist/entities/point";
import type { Drawing, Position } from "../types";

type Group = { code: number; value: string };

function sectionsFrom(text: string): Map<string, Group[]> {
  if (
    /AutoCAD Binary DXF/i.test(text) ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)
  ) {
    throw new Error("Binary DXF is not supported; export an ASCII DXF.");
  }
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  if (!lines.length || lines.length % 2 !== 0)
    throw new Error("Malformed DXF group pairs.");
  const groups: Group[] = [];
  for (let index = 0; index < lines.length; index += 2) {
    const codeText = lines[index].trim();
    const code = Number(codeText);
    if (!/^\d+$/.test(codeText) || code > 1071)
      throw new Error("Malformed DXF group code.");
    groups.push({ code, value: lines[index + 1].trim() });
  }
  const sections = new Map<string, Group[]>();
  let current: Group[] | undefined;
  let ended = false;
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index];
    if (group.code === 0 && group.value === "SECTION") {
      const name = groups[++index];
      if (
        current ||
        ended ||
        name?.code !== 2 ||
        !name.value ||
        sections.has(name.value)
      ) {
        throw new Error("Malformed DXF SECTION structure.");
      }
      current = [];
      sections.set(name.value, current);
    } else if (group.code === 0 && group.value === "ENDSEC") {
      if (!current) throw new Error("Unexpected DXF ENDSEC.");
      current = undefined;
    } else if (group.code === 0 && group.value === "EOF") {
      if (current || ended || index !== groups.length - 1)
        throw new Error("Malformed DXF EOF.");
      ended = true;
    } else if (current) {
      current.push(group);
    } else {
      throw new Error("DXF data outside a SECTION.");
    }
  }
  if (
    !ended ||
    current ||
    !sections.has("HEADER") ||
    !sections.has("ENTITIES")
  ) {
    throw new Error(
      "DXF requires complete HEADER and ENTITIES sections and a final EOF.",
    );
  }
  return sections;
}

function recordsFrom(groups: Group[]): Group[][] {
  const records: Group[][] = [];
  for (const group of groups) {
    if (group.code === 0) records.push([]);
    if (!records.length) throw new Error("Malformed DXF entity record.");
    records[records.length - 1].push(group);
  }
  return records;
}

export function parseDrawing(text: string): Drawing {
  const sections = sectionsFrom(text);
  const drawing: Drawing = {
    entities: [],
    units: undefined,
    warnings: [],
    skipped: {},
  };
  const skip = (reason: string): void => {
    drawing.skipped[reason] = (drawing.skipped[reason] ?? 0) + 1;
  };
  const header = sections.get("HEADER")!;
  let foundUnits = false;
  for (let index = 0; index < header.length; index++) {
    if (header[index].code === 9 && header[index].value === "$INSUNITS") {
      const units = header[index + 1];
      if (foundUnits || units?.code !== 70 || !/^\d+$/.test(units.value)) {
        throw new Error("Malformed or conflicting DXF $INSUNITS.");
      }
      drawing.units = Number(units.value);
      foundUnits = true;
    }
  }
  if (drawing.units === undefined || drawing.units === 0) {
    drawing.warnings.push(
      "DXF units are unknown; confirm that coordinates are metres before use.",
    );
  } else if (drawing.units !== 6) {
    drawing.warnings.push(
      `DXF INSUNITS=${drawing.units} is not metres; reject this drawing in the UI.`,
    );
  }
  const parser = new DxfParser();
  let elevationDropped = 0;
  let sequence = false;
  for (const [index, record] of recordsFrom(
    sections.get("ENTITIES")!,
  ).entries()) {
    const type = record[0].value;
    if (type === "SEQEND") {
      if (!sequence) skip("unsupported:SEQEND");
      sequence = false;
      continue;
    }
    if (sequence) {
      skip(`nested:${type}`);
      continue;
    }
    if (
      type === "POLYLINE" ||
      (type === "INSERT" &&
        record.some((group) => group.code === 66 && group.value === "1"))
    ) {
      sequence = true;
    }
    if (type !== "LINE" && type !== "POINT") {
      skip(`unsupported:${type}`);
      continue;
    }
    const values = (code: number): string[] =>
      record.filter((group) => group.code === code).map((group) => group.value);
    const numericCodes = [10, 20, 30, 11, 21, 31, 39, 67, 210, 220, 230];
    if (
      numericCodes.some(
        (code) =>
          values(code).length > 1 ||
          values(code).some(
            (value) => !value || !Number.isFinite(Number(value)),
          ),
      )
    ) {
      skip("invalid-coordinates");
      continue;
    }
    const number = (code: number, fallback: number): number =>
      Number(values(code)[0] ?? fallback);
    if (
      number(67, 0) !== 0 ||
      values(410).some((layout) => layout.toLowerCase() !== "model")
    ) {
      skip("paper-space");
      continue;
    }
    if (number(210, 0) !== 0 || number(220, 0) !== 0 || number(230, 1) !== 1) {
      skip("nondefault-extrusion");
      continue;
    }
    if (
      number(39, 0) !== 0 ||
      (type === "LINE" && number(30, 0) !== number(31, 0))
    ) {
      skip("nonplanar-z");
      continue;
    }
    try {
      const body = record
        .filter((group) => ![210, 220, 230].includes(group.code))
        .map((group) => `${group.code}\n${group.value}`)
        .join("\n");
      const parsed = parser.parseSync(
        `0\nSECTION\n2\nENTITIES\n${body}\n0\nENDSEC\n0\nEOF\n`,
      );
      const entity = parsed?.entities[0] as
        ILineEntity | IPointEntity | undefined;
      const points =
        entity &&
        (entity.type === "LINE"
          ? (entity as ILineEntity).vertices
          : [(entity as IPointEntity).position]);
      if (
        !points ||
        points.length !== (type === "LINE" ? 2 : 1) ||
        points.some(
          (point) =>
            !point ||
            !Number.isFinite(point.x) ||
            !Number.isFinite(point.y) ||
            !Number.isFinite(point.z ?? 0),
        )
      ) {
        skip("invalid-coordinates");
        continue;
      }
      const coordinates: Position[] = points.map((point) => [point.x, point.y]);
      if (
        type === "LINE" &&
        coordinates[0][0] === coordinates[1][0] &&
        coordinates[0][1] === coordinates[1][1]
      ) {
        skip("zero-length");
        continue;
      }
      if (points.some((point) => (point.z ?? 0) !== 0)) elevationDropped++;
      drawing.entities.push({
        id: `${values(5)[0] ?? "entity"}-${index}`,
        layer: entity!.layer ?? "0",
        type,
        coordinates,
      });
    } catch {
      skip("invalid-coordinates");
    }
  }
  if (sequence) throw new Error("Unterminated DXF entity sequence.");
  const blocks = sections.get("BLOCKS");
  if (blocks) {
    for (const record of recordsFrom(blocks)) {
      if (record[0].value !== "BLOCK" && record[0].value !== "ENDBLK")
        skip(`block-content:${record[0].value}`);
    }
  }
  if (elevationDropped)
    drawing.warnings.push(
      `Dropped constant elevation from ${elevationDropped} planar entities; output is 2D.`,
    );
  if (Object.keys(drawing.skipped).length) {
    drawing.warnings.push(
      `Skipped DXF data: ${Object.entries(drawing.skipped)
        .map(([reason, count]) => `${reason} (${count})`)
        .join(", ")}.`,
    );
  }
  if (!drawing.entities.length)
    drawing.warnings.push(
      "No supported model-space WCS LINE or POINT entities remain.",
    );
  return drawing;
}
