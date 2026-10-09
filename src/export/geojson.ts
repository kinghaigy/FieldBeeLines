import type { Line } from "../types";

export function exportLine(name: string, coordinates: Line) {
  if (!name.trim())
    throw new Error("Give your line a name before downloading.");
  if (
    coordinates.some(
      (position) =>
        !Number.isFinite(position[0]) ||
        !Number.isFinite(position[1]) ||
        Math.abs(position[0]) > 180 ||
        Math.abs(position[1]) > 90,
    )
  ) {
    throw new Error("The selected line has invalid longitude or latitude.");
  }
  if (
    coordinates[0][0] === coordinates[1][0] &&
    coordinates[0][1] === coordinates[1][1]
  ) {
    throw new Error("A and B must be different positions.");
  }
  return {
    type: "FeatureCollection",
    name: name.trim(),
    crs: {
      type: "name",
      properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" },
    },
    features: [
      {
        type: "Feature",
        properties: { begin: "1", end: "2" },
        geometry: { type: "LineString", coordinates },
      },
    ],
  };
}

export function uniqueFilename(input: string, used: Set<string>): string {
  const base = input
    .trim()
    .replace(/(?:\.geojson)+$/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "-")
    .replace(/[. ]+$/, "")
    .slice(0, 120);
  if (!base || /^[-. ]+$/.test(base))
    throw new Error("Enter a valid filename.");
  let candidate = `${base}.geojson`;
  let suffix = 2;
  while (used.has(candidate.toLowerCase()))
    candidate = `${base}-${suffix++}.geojson`;
  return candidate;
}
