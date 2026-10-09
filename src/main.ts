import "@fontsource/poppins/latin-400.css";
import "@fontsource/poppins/latin-600.css";
import "@fontsource/poppins/latin-700.css";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import {
  createIcons,
  Upload,
  Download,
  MoveUpRight,
  MapPin,
  Scan,
  RotateCcw,
  ShieldCheck,
  Layers,
  FileCheck2,
  ExternalLink,
  Trash2,
} from "lucide";
import { loadCatalogue, searchCatalogue } from "./crs/catalogue";
import { conversionDetails } from "./crs/transform";
import { exportLine, uniqueFilename } from "./export/geojson";
import { MapView } from "./map/MapView";
import { selectPoint, selectionLine } from "./selection/selection";
import {
  getSavedDrawing,
  saveDrawing,
  forgetDrawing,
  loadRecentCrs,
  rememberCrs,
  type StoredDrawing,
} from "./storage/browser";
import type { Crs, Drawing, Line, Position } from "./types";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <main>
    <div class="page-top">
    <header class="intro" aria-labelledby="title"><div class="intro-content"><h1 id="title"><img class="brand-icon" src="${import.meta.env.BASE_URL}favicon.svg" alt="" />FieldBee <span class="wordmark-light">Lines</span></h1><p class="independent">An unaffiliated vibe project</p><p class="intro-copy">Turn a surveyed DXF line into a named A–B GeoJSON for FieldBee. Free, local processing. No account. No drawing uploads.</p><p class="disclaimer">Not affiliated with, sponsored by, or endorsed by FieldBee.</p><a class="external-link" href="https://www.fieldbee.com/" target="_blank" rel="noopener noreferrer">FieldBee website <i data-lucide="external-link"></i></a></div><div class="intro-art"><svg class="intro-diagram" viewBox="0 0 440 200" role="img" aria-label="Map grid with a straight guidance line between point A and point B"><path class="diagram-guide" d="M95 150 L345 50"/><circle class="diagram-point" cx="95" cy="150" r="17"/><circle class="diagram-point" cx="345" cy="50" r="17"/><text x="95" y="150">A</text><text x="345" y="50">B</text></svg></div></header>
    <ol class="steps" aria-label="How to use"><li><span>01</span><div><strong>Upload your DXF</strong><p>Use metre-based LINEs and POINTs.</p></div></li><li><span>02</span><div><strong>Confirm the EPSG</strong><p>Choose the survey’s source CRS.</p></div></li><li><span>03</span><div><strong>Select A & B</strong><p>Pick a line or two imported points.</p></div></li><li><span>04</span><div><strong>Name & download</strong><p>One straight line per GeoJSON.</p></div></li></ol>
    <div id="status" class="status" role="status" aria-live="polite">Ready when you are. Upload your DXF drawing to begin.</div>
    </div>
    <section class="workspace" aria-label="Line converter">
      <aside class="controls">
        <section class="control-section"><div class="section-title"><span class="step-number">1</span><h2>Source drawing</h2></div>
          <label class="upload-zone" id="dropzone"><i data-lucide="upload"></i><strong id="file-label">Choose or drop a DXF</strong><span>ASCII DXF · metres · no file-size cap</span><input id="file" type="file" accept=".dxf" aria-label="Upload DXF drawing" /></label>
          <p id="storage-status" class="hint" aria-live="polite">The latest drawing is saved only in this browser.</p>
          <button id="forget-drawing" class="text-button" disabled><i data-lucide="trash-2"></i>Forget saved drawing</button>
          <div id="drawing-summary" class="summary" hidden></div>
          <label class="check-row" id="units-row" hidden><input id="units-confirm" type="checkbox" /> I confirm this DXF uses metres.</label>
        </section>
        <section class="control-section"><div class="section-title"><span class="step-number">2</span><h2>Coordinate system</h2></div>
          <label for="crs-search">Source EPSG code or name</label><input id="crs-search" placeholder="e.g. 28354, NAD83, ETRS89" autocomplete="off" disabled aria-describedby="crs-hint" />
          <p class="hint" id="crs-hint">Choose the CRS used to create your drawing. It cannot be guessed reliably.</p>
          <div id="recent-crs-section" hidden><label>Recent coordinate systems</label><div id="recent-crs" class="recent-crs" aria-label="Recent coordinate systems"></div></div>
          <div id="crs-results" class="crs-results" aria-label="Coordinate system search results"></div>
          <div id="crs-detail" class="crs-detail" hidden></div>
          <button id="project" class="button button-primary" disabled><i data-lucide="map-pin"></i>Plot in WGS84</button>
        </section>
        <section class="control-section"><div class="section-title"><span class="step-number">3</span><h2>Select your line</h2></div>
          <div class="segmented" aria-label="Selection mode"><button id="mode-line" aria-pressed="true"><i data-lucide="move-up-right"></i>One line</button><button id="mode-points" aria-pressed="false"><i data-lucide="map-pin"></i>Two points</button></div>
          <p class="hint" id="selection-hint">Click a surveyed line on the map, or select it from the list below.</p>
          <div id="selection-summary" class="selection-summary">No line selected</div>
          <div class="selection-actions"><button id="clear" class="text-button" disabled><i data-lucide="rotate-ccw"></i>Clear</button><button id="reverse" class="text-button" disabled><i data-lucide="move-up-right"></i>Swap A & B</button></div>
        </section>
        <section class="control-section export-section"><div class="section-title"><span class="step-number">4</span><h2>Export one line</h2></div>
          <label for="filename">Filename</label><div class="filename-field"><input id="filename" value="my-ab-line" maxlength="120" /><span>.geojson</span></div>
          <p class="hint">Before first use, check the exported line against known surveyed marks using your intended RTK correction source. Background imagery is not survey control.</p>
          <button id="download" class="button button-primary" disabled><i data-lucide="download"></i>Download GeoJSON</button>
          <p class="hint">One LineString. Two positions. EPSG:4326 coordinates. Matches your supplied FieldBee file structure.</p>
        </section>
      </aside>
      <div class="map-column"><div class="map-frame"><div class="map-toolbar"><div><span class="live-dot"></span><strong>Drawing preview</strong><span class="map-crs" id="map-crs">WGS84 · EPSG:4326</span></div><button class="icon-button" id="fit" title="Fit drawing to map" aria-label="Fit drawing to map"><i data-lucide="scan"></i></button></div>
        <div class="map-container"><div id="map" aria-label="Map of imported DXF lines and points"></div><div id="map-empty" class="map-empty"><i data-lucide="file-check-2"></i><strong>Your drawing belongs here.</strong><p>Upload a DXF and confirm its EPSG to see your survey on the map.</p></div><div class="map-legend"><span class="legend-line"></span>Survey<span class="legend-line selected"></span>Selected A–B</div></div>
        </div><div id="tile-warning" class="notice" hidden>Background tiles are unavailable. Your geometry and downloads still work.</div>
        <section class="drawing-details"><div class="details-heading"><h2><i data-lucide="layers"></i>Drawing objects</h2><span id="object-count">No drawing loaded</span></div><div class="selection-actions" aria-label="Layer visibility"><button id="select-all" class="text-button" title="Show objects on all layers" disabled>Select All</button><button id="select-none" class="text-button" title="Hide objects on all layers" disabled>Select None</button></div><div id="layer-controls" class="layer-controls"></div><label class="sr-only" for="entity-search">Filter drawing objects</label><input id="entity-search" placeholder="Filter by layer or object ID" /><div id="entity-list" class="entity-list"><p class="hint">Imported lines and points will appear here.</p></div><p id="list-count" class="hint"></p></section>
        <section id="conversion-details" class="conversion-details" hidden><h2>Conversion details</h2><p id="conversion-reference" class="hint"></p><p id="conversion-summary"></p></section>
        <div id="conversion-warnings" class="notice" role="alert" hidden></div>
        <details class="import-notes"><summary>Import report</summary><ul id="warnings"><li>Coordinates are processed on this device. Map tiles are requested from OpenStreetMap.</li></ul></details>
        <details class="import-notes"><summary>Advanced precision notes</summary><p id="conversion-operation" class="hint">Choose a source CRS to see the conversion operation.</p><ul id="precision-notes"><li>Check the exported line against surveyed marks using your intended correction source. Satellite imagery is not survey control.</li></ul></details>
      </div>
    </section>
  </main><footer><div class="footer-inner"><span><i data-lucide="shield-check"></i>Your DXF stays on your device.</span><p>Free community tool supporting FieldBee workflows. Not an official FieldBee service.</p><a href="https://www.fieldbee.com/" target="_blank" rel="noopener noreferrer">Visit FieldBee</a></div></footer>`;

const icons = {
  Upload,
  Download,
  MoveUpRight,
  MapPin,
  Scan,
  RotateCcw,
  ShieldCheck,
  Layers,
  FileCheck2,
  ExternalLink,
  Trash2,
};
createIcons({ icons });
const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const input = (id: string) => element<HTMLInputElement>(id);
const button = (id: string) => element<HTMLButtonElement>(id);
let sourceText = "";
let sourceName = "";
let source: Drawing | null = null;
let geographic: Drawing | null = null;
let catalogue: Crs[] = [];
let selectedCrs: Crs | null = null;
let mode: "line" | "points" = "line";
let points: Position[] = [];
let selectedId: string | null = null;
let hiddenLayers = new Set<string>();
let busy = true;
let storagePending = 0;
let hasSavedDrawing = false;
let recentCodes = loadRecentCrs();
let requestId = 0;
let worker: Worker | null = null;
const usedNames = new Set<string>();
let storageWrites: Promise<void> = Promise.resolve();
type ResumePlot = { crs: Crs; unitsConfirmed: boolean };

const map = new MapView(element("map"), chooseLine, choosePoint, () => {
  element("tile-warning").hidden = false;
}, undoPoint);

function status(message: string, error = false) {
  element("status").textContent = message;
  element("status").classList.toggle("error", error);
}

function resetSelection() {
  points = [];
  selectedId = null;
  updateSelection();
}

function updateEnabled() {
  const unitsReady =
    source?.units === 6 ||
    ((source?.units === undefined || source.units === 0) &&
      input("units-confirm").checked);
  button("project").disabled =
    busy || !source?.entities.length || !selectedCrs || !unitsReady;
  button("download").disabled =
    busy ||
    !selectionLine(points) ||
    !geographic ||
    !input("filename").value.trim();
  input("crs-search").disabled = busy || !source || !catalogue.length;
  input("file").disabled = busy;
  button("clear").disabled = busy || !points.length;
  button("reverse").disabled = busy || points.length !== 2;
  button("select-all").disabled = busy || !geographic;
  button("select-none").disabled = busy || !geographic;
  button("forget-drawing").disabled =
    busy || storagePending > 0 || !hasSavedDrawing;
  element("recent-crs")
    .querySelectorAll<HTMLButtonElement>("button")
    .forEach((control) => {
      control.disabled = busy;
    });
}

function updateSelection() {
  map.highlight(points);
  const summary = element("selection-summary");
  summary.replaceChildren();
  if (!points.length) summary.textContent = "No line selected";
  else
    points.forEach((point, index) => {
      const row = document.createElement("div");
      row.className = "coordinate-row";
      const label = document.createElement("strong");
      label.textContent = index === 0 ? "A" : "B";
      const coordinates = document.createElement("span");
      coordinates.textContent = `${point[0].toFixed(8)}, ${point[1].toFixed(8)}`;
      row.append(label, coordinates);
      summary.append(row);
    });
  if (points.length === 1)
    status("Point A selected. Pick a different imported point for B.");
  else if (points.length === 2)
    status(
      "A–B line selected. Check its location, give it a name, and download.",
    );
  updateEnabled();
  renderEntities();
}

function chooseLine(line: Line, id: string) {
  if (busy || mode !== "line" || !geographic) return;
  points = [...line];
  selectedId = id;
  updateSelection();
}

function choosePoint(point: Position) {
  if (busy || mode !== "points" || !geographic) return;
  points = selectPoint(points, point);
  selectedId = null;
  updateSelection();
}

function undoPoint() {
  if (busy || mode !== "points" || !geographic || !points.length) return;
  points = points.slice(0, -1);
  selectedId = null;
  updateSelection();
  if (!points.length) status("Point selection cleared. Choose a point for A.");
}

function renderEntities() {
  const list = element("entity-list");
  list.replaceChildren();
  if (!geographic) {
    const message = document.createElement("p");
    message.className = "hint";
    message.textContent = source
      ? "Confirm your EPSG and plot the drawing to select objects."
      : "Imported lines and points will appear here.";
    list.append(message);
    element("list-count").textContent = "";
    return;
  }
  const query = input("entity-search").value.trim().toLowerCase();
  const items = geographic.entities.filter(
    (entity) =>
      !hiddenLayers.has(entity.layer) &&
      `${entity.id} ${entity.layer} ${entity.type}`
        .toLowerCase()
        .includes(query),
  );
  const selectable = items.filter(
    (entity) => mode === "points" || entity.type === "LINE",
  );
  for (const entity of selectable.slice(0, 150)) {
    const positions =
      mode === "line" ? [entity.coordinates[0]] : entity.coordinates;
    positions.forEach((point, index) => {
      const control = document.createElement("button");
      control.className = "entity-button";
      const active =
        mode === "line"
          ? selectedId === entity.id
          : points.some(
              (selected) =>
                selected[0] === point[0] && selected[1] === point[1],
            );
      control.setAttribute("aria-pressed", String(active));
      const title = document.createElement("strong");
      title.textContent = `${entity.type === "LINE" ? "Line" : "Point"} ${entity.id}${mode === "points" && entity.type === "LINE" ? ` · endpoint ${index + 1}` : ""}`;
      const layer = document.createElement("span");
      layer.textContent = entity.layer;
      control.append(title, layer);
      control.addEventListener("click", () =>
        mode === "line"
          ? chooseLine(entity.coordinates as Line, entity.id)
          : choosePoint(point),
      );
      list.append(control);
    });
  }
  element("list-count").textContent =
    selectable.length > 150
      ? `Showing the first 150 of ${selectable.length} matching objects. Filter to find more.`
      : `${selectable.length} matching objects. Coordinates shown as longitude, latitude.`;
  if (!selectable.length)
    list.textContent = "No matching objects in this mode.";
}

function renderLayers() {
  const container = element("layer-controls");
  container.replaceChildren();
  for (const layer of new Set(
    geographic?.entities.map((entity) => entity.layer) ?? [],
  )) {
    const label = document.createElement("label");
    label.className = "layer-toggle";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !hiddenLayers.has(layer);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) hiddenLayers.delete(layer);
      else hiddenLayers.add(layer);
      resetSelection();
      map.show(geographic, mode, hiddenLayers);
      renderEntities();
    });
    label.append(checkbox, document.createTextNode(layer));
    container.append(label);
  }
}

function setAllLayersVisible(visible: boolean) {
  if (busy || !geographic) return;
  hiddenLayers = visible
    ? new Set()
    : new Set(geographic.entities.map((entity) => entity.layer));
  resetSelection();
  map.show(geographic, mode, hiddenLayers);
  renderLayers();
  status(
    visible
      ? "All layers shown. Choose one line or two points to export."
      : "All layers hidden. Select All to show your drawing again.",
  );
}

button("select-all").addEventListener("click", () => setAllLayersVisible(true));
button("select-none").addEventListener("click", () =>
  setAllLayersVisible(false),
);

function renderWarnings(drawing: Drawing) {
  const list = element("warnings");
  list.replaceChildren();
  const warnings = [
    ...drawing.warnings,
    "The basemap is a visual check, not a surveyed reference. Confirm the line in FieldBee before using autosteering.",
  ];
  for (const warning of warnings) {
    const item = document.createElement("li");
    item.textContent = warning;
    list.append(item);
  }
  const actionable = drawing.warnings.filter((warning) =>
    /units|outside|grids|fallback|bounds/i.test(warning),
  );
  element("conversion-warnings").hidden = !actionable.length;
  element("conversion-warnings").textContent = actionable.join(" ");
}

function renderConversion(crs: Crs) {
  const details = conversionDetails(crs);
  element("conversion-details").hidden = false;
  element("conversion-reference").textContent =
    `${crs.code} · ${crs.name} → EPSG:4326 · WGS84 longitude/latitude`;
  element("conversion-summary").textContent =
    details.summary +
    (details.kind === "projection-only"
      ? " No datum or coordinate-epoch adjustment is applied."
      : "");
  element("conversion-operation").textContent = details.operation;
  const list = element("precision-notes");
  list.replaceChildren();
  for (const text of [
    ...details.limitations,
    "Matching survey and driving correction references matters. Verify against known surveyed marks; imagery is not survey control.",
  ]) {
    const item = document.createElement("li");
    item.textContent = text;
    list.append(item);
  }
}

function clearProjection() {
  geographic = null;
  hiddenLayers = new Set();
  resetSelection();
  map.show(null, mode, hiddenLayers);
  element("map-empty").hidden = false;
  element("map-crs").textContent = "WGS84 · EPSG:4326";
  element("conversion-details").hidden = true;
  element("conversion-warnings").hidden = true;
  element("conversion-operation").textContent =
    "Choose and plot a source CRS to see the conversion operation.";
  element("precision-notes").replaceChildren();
  renderLayers();
}

function cacheDrawing(drawing: StoredDrawing) {
  storagePending++;
  element("storage-status").textContent =
    "Saving the latest drawing in this browser…";
  storageWrites = storageWrites
    .catch(() => {})
    .then(() => saveDrawing(drawing));
  void storageWrites
    .then(() => {
      hasSavedDrawing = true;
      if (sourceName === drawing.name && sourceText === drawing.text)
        element("storage-status").textContent = drawing.plot
          ? "Latest drawing saved; plotted CRS will be restored automatically next time."
          : "Latest drawing saved in this browser for next time.";
    })
    .catch(() => {
      if (sourceName === drawing.name && sourceText === drawing.text)
        element("storage-status").textContent =
          "Browser storage is unavailable or full. This drawing still works, but could not be saved; an older saved drawing may remain.";
    })
    .finally(() => {
      storagePending--;
      updateEnabled();
    });
}

function runWorker(
  text: string,
  crs?: Crs,
  persist = true,
  resumePlot?: ResumePlot,
) {
  worker?.terminate();
  worker = new Worker(new URL("./workers/import.worker.ts", import.meta.url), {
    type: "module",
  });
  const id = ++requestId;
  const name = sourceName;
  busy = true;
  updateEnabled();
  status(
    crs
      ? `Transforming ${sourceName} from ${crs.code} to WGS84…`
      : `Reading ${sourceName}…`,
  );
  const finish = () => {
    worker?.terminate();
    worker = null;
    busy = false;
    updateEnabled();
  };
  worker.onmessage = (
    event: MessageEvent<{ id: number; drawing?: Drawing; error?: string }>,
  ) => {
    if (event.data.id !== requestId) return;
    if (event.data.error || !event.data.drawing) {
      finish();
      status(event.data.error ?? "Could not read this drawing.", true);
      return;
    }
    const drawing = event.data.drawing;
    if (!crs) {
      source = drawing;
      input("units-confirm").checked = resumePlot?.unitsConfirmed ?? false;
      element("units-row").hidden =
        drawing.units !== undefined && drawing.units !== 0;
      element("drawing-summary").hidden = false;
      const lines = drawing.entities.filter(
        (entity) => entity.type === "LINE",
      ).length;
      element("drawing-summary").textContent =
        `${lines} lines · ${drawing.entities.length - lines} points · ${Object.values(drawing.skipped).reduce((sum, count) => sum + count, 0)} skipped`;
      element("object-count").textContent =
        `${drawing.entities.length} imported objects`;
      renderWarnings(drawing);
      if (persist) cacheDrawing({ name, text });
      finish();
      if (
        drawing.units !== undefined &&
        drawing.units !== 0 &&
        drawing.units !== 6
      )
        status(
          `This DXF declares non-metre units (INSUNITS ${drawing.units}). Re-export it in metres before continuing.`,
          true,
        );
      else if (!drawing.entities.length)
        status(
          "No supported LINEs or POINTs were found. See the import report.",
          true,
        );
      else
        status(
          "Drawing read locally. Choose its source EPSG, then plot it on the map.",
        );
      renderEntities();
      const unitsReady =
        drawing.units === 6 ||
        ((drawing.units === undefined || drawing.units === 0) &&
          resumePlot?.unitsConfirmed);
      if (resumePlot && drawing.entities.length && unitsReady) {
        chooseCrs(resumePlot.crs, false);
        runWorker(text, resumePlot.crs, false);
      }
    } else {
      geographic = drawing;
      renderConversion(crs);
      renderWarnings(drawing);
      element("map-empty").hidden = true;
      element("map-crs").textContent = `${crs.code} → EPSG:4326`;
      map.show(geographic, mode, hiddenLayers);
      map.fit();
      renderLayers();
      renderEntities();
      if (persist)
        cacheDrawing({
          name,
          text,
          plot: {
            crsCode: crs.code,
            unitsConfirmed: input("units-confirm").checked,
          },
        });
      else
        element("storage-status").textContent =
          `Saved drawing replotted using ${crs.code}.`;
      finish();
      status(
        drawing.warnings.some((warning) => warning.includes("outside"))
          ? "Drawing plotted, but some positions are outside the CRS area of use. Check the import report and source EPSG."
          : "Drawing plotted. Select one line, or switch to two points.",
      );
    }
  };
  worker.onerror = () => {
    finish();
    status(
      "The drawing worker failed. Try an ASCII DXF with fewer entities.",
      true,
    );
  };
  worker.postMessage({ id, text, crs });
}

async function importFile(
  file: File,
  restoring = false,
  resumePlot?: ResumePlot,
) {
  if (busy) return;
  if (!file.name.toLowerCase().endsWith(".dxf"))
    return status("Choose an ASCII .dxf file.", true);
  busy = true;
  updateEnabled();
  try {
    const text = await file.text();
    source = null;
    sourceName = file.name;
    sourceText = text;
    clearProjection();
    element("crs-results").replaceChildren();
    if (selectedCrs) chooseCrs(selectedCrs, false);
    else {
      input("crs-search").value = "";
      element("crs-detail").hidden = true;
    }
    element("drawing-summary").hidden = true;
    element("units-row").hidden = true;
    element("object-count").textContent = "Reading drawing";
    element("file-label").textContent = file.name;
    input("filename").value = `${file.name.replace(/\.dxf$/i, "")}-ab-line`;
    runWorker(text, undefined, !restoring, resumePlot);
  } catch {
    busy = false;
    updateEnabled();
    status("Could not read that file. Try selecting it again.", true);
  } finally {
    input("file").value = "";
  }
}

input("file").addEventListener("change", () => {
  const file = input("file").files?.[0];
  if (file) void importFile(file);
});
const dropzone = element("dropzone");
dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzone.classList.add("dragging");
});
dropzone.addEventListener("dragleave", () =>
  dropzone.classList.remove("dragging"),
);
dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("dragging");
  const file = event.dataTransfer?.files[0];
  if (file) void importFile(file);
});
function renderRecentCrs() {
  const container = element("recent-crs");
  container.replaceChildren();
  for (const code of recentCodes) {
    const crs = catalogue.find((candidate) => candidate.code === code);
    if (!crs) continue;
    const control = document.createElement("button");
    control.className = "text-button recent-crs-button";
    control.textContent = crs.code;
    control.title = crs.name;
    control.setAttribute("aria-label", `Use ${crs.code} ${crs.name}`);
    control.setAttribute("aria-pressed", String(selectedCrs?.code === code));
    control.disabled = busy;
    control.addEventListener("click", () => chooseCrs(crs));
    container.append(control);
  }
  element("recent-crs-section").hidden = !container.childElementCount;
}

function chooseCrs(crs: Crs, remember = true) {
  if (selectedCrs?.code !== crs.code) clearProjection();
  selectedCrs = crs;
  input("crs-search").value = `${crs.code} · ${crs.name}`;
  element("crs-results").replaceChildren();
  element("crs-detail").hidden = false;
  element("crs-detail").textContent =
    `${crs.name}. Metres. Area of use: ${crs.area || "not provided"}.`;
  if (remember) {
    recentCodes = [
      crs.code,
      ...recentCodes.filter((code) => code !== crs.code),
    ].slice(0, 8);
    try {
      recentCodes = rememberCrs(crs.code);
    } catch {
      element("storage-status").textContent =
        "Recent CRS choices could not be saved. The current conversion is still available.";
    }
  }
  renderRecentCrs();
  updateEnabled();
}

input("crs-search").addEventListener("input", () => {
  selectedCrs = null;
  clearProjection();
  renderRecentCrs();
  element("crs-detail").hidden = true;
  const results = element("crs-results");
  results.replaceChildren();
  const query = input("crs-search").value;
  if (!query.trim()) return;
  const matches = searchCatalogue(catalogue, query);
  for (const crs of matches.slice(0, 30)) {
    const control = document.createElement("button");
    control.className = "crs-result";
    const code = document.createElement("strong");
    code.textContent = crs.code;
    const name = document.createElement("span");
    name.textContent = crs.name;
    control.append(code, name);
    control.addEventListener("click", () => chooseCrs(crs));
    results.append(control);
  }
  if (!matches.length)
    results.textContent =
      "No eligible metre-based projected CRS found. Check the code; geographic and feet-based CRSs are excluded.";
  updateEnabled();
});
button("project").addEventListener("click", () => {
  if (selectedCrs && !button("project").disabled) {
    clearProjection();
    runWorker(sourceText, selectedCrs);
  }
});
input("units-confirm").addEventListener("change", () => {
  if (!input("units-confirm").checked) {
    clearProjection();
    if (source && hasSavedDrawing)
      cacheDrawing({ name: sourceName, text: sourceText });
  }
  updateEnabled();
});

function setMode(next: "line" | "points") {
  mode = next;
  button("mode-line").setAttribute("aria-pressed", String(mode === "line"));
  button("mode-points").setAttribute("aria-pressed", String(mode === "points"));
  element("selection-hint").textContent =
    mode === "line"
      ? "Click a surveyed line on the map, or select it from the list below."
      : "Choose two imported POINTs or line endpoints. A third point starts a new pair.";
  resetSelection();
  map.show(geographic, mode, hiddenLayers);
}
button("mode-line").addEventListener("click", () => setMode("line"));
button("mode-points").addEventListener("click", () => setMode("points"));
button("clear").addEventListener("click", () => {
  resetSelection();
  status("Selection cleared. Choose your next line.");
});
button("reverse").addEventListener("click", () => {
  points.reverse();
  updateSelection();
});
button("fit").addEventListener("click", () => map.fit());
input("entity-search").addEventListener("input", renderEntities);
input("filename").addEventListener("input", updateEnabled);
button("download").addEventListener("click", () => {
  const line = selectionLine(points);
  if (!line || button("download").disabled) return;
  try {
    const filename = uniqueFilename(input("filename").value, usedNames);
    const content = exportLine(filename.slice(0, -8), line);
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(content, null, 2) + "\n"], {
        type: "application/geo+json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    usedNames.add(filename.toLowerCase());
    status(
      `Downloaded ${filename}. Only the selected A–B line is included. Choose another line to export again.`,
    );
  } catch (error) {
    status(error instanceof Error ? error.message : "Download failed.", true);
  }
});

button("forget-drawing").addEventListener("click", async () => {
  if (button("forget-drawing").disabled) return;
  storagePending++;
  updateEnabled();
  try {
    await forgetDrawing();
    hasSavedDrawing = false;
    element("storage-status").textContent =
      "Saved drawing removed from this browser. The currently open drawing remains available until you close the page.";
  } catch {
    element("storage-status").textContent =
      "Could not remove the saved drawing. Try again or clear this site's browser data.";
  } finally {
    storagePending--;
    updateEnabled();
  }
});

async function restoreSession() {
  updateEnabled();
  const saved = getSavedDrawing().catch(() => {
    element("storage-status").textContent =
      "Browser drawing storage is unavailable. You can still upload and convert DXFs.";
    return null;
  });
  try {
    catalogue = await loadCatalogue();
    const last = recentCodes
      .map((code) => catalogue.find((crs) => crs.code === code))
      .find((crs) => crs !== undefined);
    if (last) chooseCrs(last, false);
    renderRecentCrs();
  } catch {
    status(
      "Could not load the bundled EPSG catalogue. Refresh this page.",
      true,
    );
  }
  const drawing = await saved;
  busy = false;
  updateEnabled();
  if (drawing) {
    hasSavedDrawing = true;
    const plottedCrs =
      drawing.plot &&
      catalogue.find((crs) => crs.code === drawing.plot!.crsCode);
    element("storage-status").textContent = plottedCrs
      ? "Restoring the latest drawing and its saved plot reference."
      : "Restored the latest drawing from this browser. Check the selected CRS before plotting.";
    if (drawing.plot && !plottedCrs)
      element("storage-status").textContent =
        "Saved drawing restored, but its plotted CRS is unavailable. Choose a supported CRS and plot again.";
    await importFile(
      new File([drawing.text], drawing.name),
      true,
      plottedCrs
        ? { crs: plottedCrs, unitsConfirmed: drawing.plot!.unitsConfirmed }
        : undefined,
    );
  }
}

void restoreSession();
