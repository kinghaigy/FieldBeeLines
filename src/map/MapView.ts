import L from "leaflet";
import type { Drawing, Line, Position } from "../types";

export class MapView {
  private map: L.Map;
  private drawing = L.layerGroup();
  private selection = L.layerGroup();
  private data: Drawing | null = null;
  private hidden = new Set<string>();
  private mode: "line" | "points" = "line";

  constructor(
    element: HTMLElement,
    private onLine: (line: Line, id: string) => void,
    private onPoint: (point: Position) => void,
    onTileError: () => void,
    onUndoPoint: () => void,
  ) {
    this.map = L.map(element, {
      preferCanvas: true,
      zoomControl: false,
    }).setView([-30, 135], 4);
    L.control.zoom({ position: "bottomright" }).addTo(this.map);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 20,
      maxNativeZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    })
      .on("tileerror", onTileError)
      .addTo(this.map);
    this.drawing.addTo(this.map);
    this.selection.addTo(this.map);
    element.addEventListener("contextmenu", (event) => {
      if (this.mode !== "points") return;
      event.preventDefault();
      event.stopPropagation();
      onUndoPoint();
    }, { capture: true });
    new ResizeObserver(() => {
      this.map.invalidateSize();
      if (this.data) this.fit();
    }).observe(element);
  }

  show(data: Drawing | null, mode: "line" | "points", hidden: Set<string>) {
    this.data = data;
    this.mode = mode;
    this.hidden = hidden;
    this.drawing.clearLayers();
    if (!data) return;
    for (const entity of data.entities) {
      if (hidden.has(entity.layer)) continue;
      const label = document.createElement("span");
      label.textContent = `${entity.type} · ${entity.layer} · ${entity.id}`;
      if (entity.type === "LINE") {
        const line = entity.coordinates as Line;
        const layer = L.polyline(
          line.map((point) => this.latLng(point)),
          {
            color: "#007a73",
            weight: 5,
            opacity: 0.85,
            interactive: mode === "line",
          },
        );
        layer
          .bindTooltip(label)
          .on("click", () => this.onLine(line, entity.id));
        if (mode === "line") {
          layer
            .on("mouseover", () => layer.setStyle({ weight: 8 }))
            .on("mouseout", () => layer.setStyle({ weight: 5 }));
        }
        layer.addTo(this.drawing);
      }
      if (entity.type === "POINT" || mode === "points") {
        for (const point of entity.coordinates) {
          L.circleMarker(this.latLng(point), {
            radius: 7,
            color: "#fff",
            weight: 2,
            fillColor: "#007a73",
            fillOpacity: 1,
            interactive: mode === "points",
          })
            .bindTooltip(label)
            .on("click", () => this.onPoint(point))
            .addTo(this.drawing);
        }
      }
    }
  }

  highlight(points: Position[]) {
    this.selection.clearLayers();
    if (points.length === 2)
      L.polyline(
        points.map((point) => this.latLng(point)),
        { color: "#ffce1f", weight: 7 },
      ).addTo(this.selection);
    points.forEach((point, index) => {
      L.marker(this.latLng(point), {
        interactive: false,
        icon: L.divIcon({
          className: "ab-marker",
          html: index === 0 ? "A" : "B",
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        }),
      }).addTo(this.selection);
    });
  }

  fit() {
    const positions =
      this.data?.entities
        .filter((entity) => !this.hidden.has(entity.layer))
        .flatMap((entity) => entity.coordinates) ?? [];
    if (positions.length)
      this.map.fitBounds(
        L.latLngBounds(positions.map((point) => this.latLng(point))),
        { padding: [40, 40], maxZoom: 18 },
      );
  }

  private latLng(point: Position): L.LatLngTuple {
    return [point[1], point[0]];
  }
}
