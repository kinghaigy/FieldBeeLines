import { readFile } from "node:fs/promises";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "./",
  optimizeDeps: { include: ["dxf-parser", "proj4", "leaflet", "lucide"] },
  plugins: [
    VitePWA({
      injectRegister: "script",
      registerType: "prompt",
      includeAssets: ["favicon.svg", "apple-touch-icon-180x180.png"],
      manifest: {
        id: "./",
        name: "FieldBee Lines",
        short_name: "FieldBee Lines",
        description: "Convert metre-based DXF survey lines into FieldBee A-B GeoJSON guidance lines on your device.",
        start_url: "./",
        scope: "./",
        display: "standalone",
        theme_color: "#ffce1f",
        background_color: "#ffffff",
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff,woff2}"],
        navigateFallback: "index.html",
        cleanupOutdatedCaches: true,
      },
    }),
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
