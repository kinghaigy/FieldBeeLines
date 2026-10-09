import { parseDrawing } from "../dxf/parse";
import { transformDrawing } from "../crs/transform";
import type { Crs, Drawing } from "../types";

export type ImportRequest = { id: number; text: string; crs?: Crs };
export type ImportResponse =
  { id: number; drawing: Drawing } | { id: number; error: string };

const worker = globalThis as unknown as DedicatedWorkerGlobalScope;

worker.onmessage = (event: MessageEvent<ImportRequest>): void => {
  const { id, text, crs } = event.data;
  let response: ImportResponse;
  try {
    const drawing = parseDrawing(text);
    response = { id, drawing: crs ? transformDrawing(drawing, crs) : drawing };
  } catch (error) {
    response = {
      id,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  worker.postMessage(response);
};
