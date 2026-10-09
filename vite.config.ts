import { readFile } from "node:fs/promises";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  optimizeDeps: { include: ["dxf-parser", "proj4", "leaflet", "lucide"] },
  plugins: [
    {
      name: "compact-epsg-catalogue",
      enforce: "pre",
      async load(id) {
        if (!id.replaceAll("\\", "/").endsWith("/epsg-index/all.json")) return;
        const records = JSON.parse(await readFile(id, "utf8")) as Record<
          string,
          Record<string, unknown>
        >;
        return JSON.stringify(
          Object.fromEntries(
            Object.entries(records)
              .filter(
                ([, record]) =>
                  record.kind === "CRS-PROJCRS" &&
                  record.unit === "metre" &&
                  record.proj4,
              )
              .map(([code, record]) => [
                code,
                {
                  code,
                  kind: record.kind,
                  unit: record.unit,
                  name: record.name,
                  proj4: record.proj4,
                  bbox: record.bbox,
                  area: record.area,
                },
              ]),
          ),
        );
      },
    },
  ],
});
