import proj4 from "proj4";
import type { Crs, Drawing, Position } from "../types";

type Grid = {
  name: string;
  mandatory: boolean;
  grid: unknown;
  isNull: boolean;
};
type ParsedProjection = InstanceType<typeof proj4.Proj> & {
  projName?: string;
  units?: string;
  to_meter?: number;
  datumCode?: string;
  datum_params?: (number | string)[];
  datum: {
    grids?: Grid[];
    datum_type: number;
    a: number;
    b: number;
  };
};

export function metreProjection(definition: string): ParsedProjection {
  let projection: ParsedProjection;
  try {
    if (!definition.trim()) throw new Error("Empty definition");
    projection = new proj4.Proj(definition) as ParsedProjection;
  } catch {
    throw new Error("Invalid or unsupported CRS definition.");
  }
  if (
    !projection.projName ||
    ["longlat", "latlong", "identity", "geocent"].includes(
      projection.projName.toLowerCase(),
    )
  ) {
    throw new Error(
      "A projected CRS is required; geographic or geocentric coordinates are not supported.",
    );
  }
  const metreUnits =
    projection.units === undefined ||
    ["m", "metre", "meter"].includes(projection.units.toLowerCase());
  if (
    !metreUnits ||
    (projection.to_meter !== undefined && projection.to_meter !== 1) ||
    (projection.units === undefined && projection.to_meter !== 1)
  ) {
    throw new Error("The source CRS must explicitly use metre units.");
  }
  return projection;
}

export function conversionDetails(crs: Crs): {
  kind: "projection-only" | "datum-operation";
  summary: string;
  operation: string;
  limitations: string[];
} {
  const projection = metreProjection(crs.definition);
  const target = new proj4.Proj("EPSG:4326") as ParsedProjection;
  const grids = projection.datum.grids ?? [];
  const nonnullGrids = grids.filter((grid) => !grid.isNull);
  const nullShift =
    grids.some((grid) => grid.isNull) ||
    (projection.datumCode === "none" &&
      /(?:^|\s)\+nadgrids=@null(?:\s|$)/i.test(crs.definition));
  const parameters = projection.datum_params?.map(Number) ?? [];
  const nonzeroParameters = parameters.some((value) => value !== 0);
  const inverse = `Inverse ${projection.projName} map projection`;
  const wgs84 =
    projection.datumCode?.toUpperCase() === "WGS84" &&
    projection.datum.a === target.datum.a &&
    projection.datum.b === target.datum.b;
  if (wgs84 && !nonzeroParameters && !nonnullGrids.length) {
    return {
      kind: "projection-only",
      summary:
        "Inverse map projection from WGS84 projected coordinates to WGS84 longitude/latitude.",
      operation: `${inverse}; the parsed source and target use the WGS84 datum and ellipsoid.`,
      limitations: ["No datum or coordinate-epoch adjustment is applied."],
    };
  }

  const limitations = [
    "Datum transformation accuracy and coordinate epoch are not verified. No survey-grade or RTK precision is guaranteed.",
  ];
  let operation: string;
  if (nonnullGrids.length) {
    operation = `${inverse}; datum grid operation using ${grids.map((grid) => `${grid.name}${grid.isNull ? " (null shift)" : grid.mandatory ? " (required)" : " (optional)"}`).join(", ")}.`;
    if (nonzeroParameters) {
      operation += ` The grid operation takes precedence over towgs84=${parameters.join(",")}.`;
    }
  } else if (
    nonzeroParameters &&
    [1, 2].includes(projection.datum.datum_type)
  ) {
    const sevenParameter = projection.datum.datum_type === 2;
    operation = `${inverse}; ${sevenParameter ? "7" : "3"}-parameter Helmert datum operation with towgs84=${parameters.join(",")} (translations in metres${sevenParameter ? ", rotations in arcseconds, scale in ppm" : ""}).`;
  } else if (parameters.length || nullShift) {
    operation = `${inverse}; ${nullShift ? "null grid shift" : `towgs84=${parameters.join(",")}`}.`;
    if (nonzeroParameters) {
      operation +=
        " The specified Helmert parameters are not applied by the parsed datum operation.";
    } else {
      limitations.unshift(
        "No nonzero datum shift is specified in the bundled definition; this does not establish equivalence to precise WGS84.",
      );
    }
  } else {
    operation = `${inverse}; no explicit datum correction is specified in the bundled definition.`;
    limitations.unshift(
      "No explicit datum correction is specified; the source reference frame is not established as equivalent to precise WGS84.",
    );
  }
  limitations.push("No coordinate-epoch adjustment is applied.");
  return {
    kind: "datum-operation",
    summary:
      "Conversion to WGS84 longitude/latitude using the bundled definition; precise reference-frame equivalence is not established.",
    operation,
    limitations,
  };
}

function inBounds(
  point: Position,
  bounds: NonNullable<Crs["bounds"]>,
): boolean {
  const [west, south, east, north] = bounds;
  const longitudeFits =
    west <= east
      ? point[0] >= west && point[0] <= east
      : point[0] >= west || point[0] <= east;
  return longitudeFits && point[1] >= south && point[1] <= north;
}

export function transformDrawing(drawing: Drawing, crs: Crs): Drawing {
  const projection = metreProjection(crs.definition);
  const warnings = [...drawing.warnings];
  const grids = projection.datum.grids ?? [];
  const missingRequired = grids.filter(
    (grid) => grid.mandatory && !grid.isNull && !grid.grid,
  );
  if (missingRequired.length) {
    throw new Error(
      `Missing required datum transformation grids: ${missingRequired.map((grid) => grid.name).join(", ")}.`,
    );
  }
  if (/\+geoidgrids=(?!@?null(?:\s|$))\S+/i.test(crs.definition)) {
    throw new Error(
      "Required vertical grids are not supported by this 2D transformation.",
    );
  }
  const missingOptional = grids.filter(
    (grid) => !grid.mandatory && !grid.isNull && !grid.grid,
  );
  if (missingOptional.length) {
    warnings.push(
      `Optional datum grids unavailable (${missingOptional.map((grid) => grid.name).join(", ")}); a fallback datum operation may be used.`,
    );
  }
  let outside = 0;
  const converter = proj4(projection, "EPSG:4326");
  const entities = drawing.entities.map((entity) => {
    if (
      (entity.type !== "LINE" && entity.type !== "POINT") ||
      entity.coordinates.length !== (entity.type === "LINE" ? 2 : 1)
    ) {
      throw new Error(`Invalid geometry for entity ${entity.id}.`);
    }
    const coordinates = entity.coordinates.map((point) => {
      if (point.length !== 2 || !point.every(Number.isFinite))
        throw new Error(`Nonfinite source coordinate in entity ${entity.id}.`);
      let result: number[];
      try {
        result = converter.forward([...point]);
      } catch {
        throw new Error(
          `Coordinate transformation failed for entity ${entity.id}.`,
        );
      }
      if (
        !result ||
        !Number.isFinite(result[0]) ||
        !Number.isFinite(result[1]) ||
        Math.abs(result[0]) > 180 ||
        Math.abs(result[1]) > 90
      ) {
        throw new Error(
          `Nonfinite or out-of-range transformed coordinate in entity ${entity.id}.`,
        );
      }
      const geographic: Position = [result[0], result[1]];
      if (crs.bounds && !inBounds(geographic, crs.bounds)) outside++;
      return geographic;
    });
    if (
      entity.type === "LINE" &&
      coordinates[0][0] === coordinates[1][0] &&
      coordinates[0][1] === coordinates[1][1]
    ) {
      throw new Error(
        `Transformation collapsed line ${entity.id} to zero length.`,
      );
    }
    return { ...entity, coordinates };
  });
  if (outside)
    warnings.push(
      `${outside} transformed positions are outside the CRS area of use (${crs.area || crs.name}); verify the selected CRS.`,
    );
  if (!crs.bounds)
    warnings.push(
      "CRS area-of-use bounds are unavailable; location plausibility could not be checked.",
    );
  return { ...drawing, entities, warnings, skipped: { ...drawing.skipped } };
}
