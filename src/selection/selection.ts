import type { Line, Position } from "../types";

const samePoint = (first: Position, second: Position): boolean =>
  first[0] === second[0] && first[1] === second[1];

export function selectPoint(current: Position[], point: Position): Position[] {
  if (current.some((selected) => samePoint(selected, point))) return current;
  return current.length >= 2 ? [] : [...current, [...point] as Position];
}

export function selectionLine(points: Position[]): Line | null {
  if (points.length !== 2 || samePoint(points[0], points[1])) return null;
  if (!points.every((point) => point.every(Number.isFinite))) return null;
  return [[...points[0]], [...points[1]]];
}
