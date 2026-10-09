export interface StoredDrawing {
  name: string;
  text: string;
  plot?: { crsCode: string; unitsConfirmed: boolean };
}

const DATABASE_NAME = "fieldbee-lines";
const STORE_NAME = "session";
const DRAWING_KEY = "drawing";
const RECENT_CRS_KEY = "fieldbee-lines:recent-crs";
const CRS_PATTERN = /^EPSG:\d+$/;

function isStoredPlot(
  value: unknown,
): value is NonNullable<StoredDrawing["plot"]> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const plot = value as Record<string, unknown>;
  return (
    typeof plot.crsCode === "string" &&
    CRS_PATTERN.test(plot.crsCode) &&
    typeof plot.unitsConfirmed === "boolean"
  );
}

function isStoredDrawing(value: unknown): value is StoredDrawing {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const drawing = value as Record<string, unknown>;
  return (
    typeof drawing.name === "string" &&
    drawing.name.trim().length > 0 &&
    /\.dxf$/i.test(drawing.name) &&
    typeof drawing.text === "string" &&
    drawing.text.trim().length > 0
  );
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let rejected = false;
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onerror = () => {
      rejected = true;
      reject(request.error ?? new Error("Unable to open drawing storage."));
    };
    request.onblocked = () => {
      rejected = true;
      reject(new Error("Drawing storage is blocked by another connection."));
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      if (rejected) {
        database.close();
      } else {
        resolve(database);
      }
    };
  });
}

async function drawingTransaction(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest,
): Promise<unknown> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    let result: unknown;
    try {
      const transaction = database.transaction(STORE_NAME, mode);
      transaction.oncomplete = () => {
        database.close();
        resolve(result);
      };
      const fail = () => {
        database.close();
        reject(
          transaction.error ?? new Error("Drawing storage transaction failed."),
        );
      };
      transaction.onabort = fail;
      transaction.onerror = fail;
      const request = operation(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => {
        result = request.result;
      };
    } catch (error) {
      database.close();
      reject(error);
    }
  });
}

export async function getSavedDrawing(): Promise<StoredDrawing | null> {
  const value = await drawingTransaction("readonly", (store) =>
    store.get(DRAWING_KEY),
  );
  if (!isStoredDrawing(value)) return null;
  return {
    name: value.name,
    text: value.text,
    ...(isStoredPlot(value.plot) ? { plot: { ...value.plot } } : {}),
  };
}

export async function saveDrawing(drawing: StoredDrawing): Promise<void> {
  if (
    !isStoredDrawing(drawing) ||
    (drawing.plot !== undefined && !isStoredPlot(drawing.plot))
  ) {
    throw new TypeError(
      "A drawing must have a DXF filename and nonempty text.",
    );
  }
  await drawingTransaction("readwrite", (store) =>
    store.put(
      {
        name: drawing.name,
        text: drawing.text,
        ...(drawing.plot ? { plot: { ...drawing.plot } } : {}),
      },
      DRAWING_KEY,
    ),
  );
}

export async function forgetDrawing(): Promise<void> {
  await drawingTransaction("readwrite", (store) => store.delete(DRAWING_KEY));
}

function sanitizeRecentCrs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const codes: string[] = [];
  for (const code of value) {
    if (
      typeof code === "string" &&
      CRS_PATTERN.test(code) &&
      !codes.includes(code)
    ) {
      codes.push(code);
      if (codes.length === 8) break;
    }
  }
  return codes;
}

export function loadRecentCrs(): string[] {
  try {
    const stored = localStorage.getItem(RECENT_CRS_KEY);
    return stored === null ? [] : sanitizeRecentCrs(JSON.parse(stored));
  } catch {
    return [];
  }
}

export function rememberCrs(code: string): string[] {
  if (typeof code !== "string" || !CRS_PATTERN.test(code)) {
    throw new TypeError("A CRS code must match EPSG:<digits>.");
  }
  const codes = sanitizeRecentCrs([code, ...loadRecentCrs()]);
  localStorage.setItem(RECENT_CRS_KEY, JSON.stringify(codes));
  return codes;
}

export function clearRecentCrs(): void {
  localStorage.removeItem(RECENT_CRS_KEY);
}
