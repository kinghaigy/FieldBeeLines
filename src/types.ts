export type Position = [number, number];
export type Line = [Position, Position];

export interface DrawingEntity {
  id: string;
  layer: string;
  type: "LINE" | "POINT";
  coordinates: Position[];
}

export interface Drawing {
  entities: DrawingEntity[];
  units: number | undefined;
  warnings: string[];
  skipped: Record<string, number>;
}

export interface Crs {
  code: string;
  name: string;
  definition: string;
  area: string;
  bounds: [number, number, number, number] | null;
}
