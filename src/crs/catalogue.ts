import type { Crs } from "../types";
import { metreProjection } from "./transform";

type EpsgRecord = {
  code?: string;
  kind?: string;
  name?: string;
  proj4?: string;
  unit?: string;
  area?: string;
  bbox?: number[];
};

let catalogue: Promise<Crs[]> | undefined;

export function loadCatalogue(): Promise<Crs[]> {
  catalogue ??= import("epsg-index/all.json").then((module) => {
    const records = module.default as unknown as Record<string, EpsgRecord>;
    const result: Crs[] = [];
    for (const [code, record] of Object.entries(records)) {
      if (
        record.kind !== "CRS-PROJCRS" ||
        record.unit !== "metre" ||
        !record.proj4 ||
        !record.name
      )
        continue;
      try {
        metreProjection(record.proj4);
      } catch {
        continue;
      }
      const bbox = record.bbox;
      const bounds: Crs["bounds"] =
        bbox?.length === 4 &&
        bbox.every(Number.isFinite) &&
        Math.abs(bbox[0]) <= 90 &&
        Math.abs(bbox[2]) <= 90 &&
        Math.abs(bbox[1]) <= 180 &&
        Math.abs(bbox[3]) <= 180 &&
        bbox[2] <= bbox[0]
          ? [bbox[1], bbox[2], bbox[3], bbox[0]]
          : null;
      result.push({
        code: `EPSG:${record.code ?? code}`,
        name: record.name,
        definition: record.proj4,
        area: record.area ?? "",
        bounds,
      });
    }
    return result.sort(
      (first, second) =>
        Number(first.code.slice(5)) - Number(second.code.slice(5)),
    );
  });
  return catalogue;
}

export function searchCatalogue(records: Crs[], query: string): Crs[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return records.filter((record) => {
    const text = `${record.code} ${record.name} ${record.area}`.toLowerCase();
    return terms.every((term) => text.includes(term));
  });
}
