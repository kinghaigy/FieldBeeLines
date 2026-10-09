# FieldBee Lines

[Try it here!](https://kinghaigy.github.io/FieldBeeLines/)

A browser tool for converting lines, or two imported points/endpoints grom a georeferenced DXF, into a FieldBee-accepted GeoJSON. Not affiliated with, sponsored by, or endorsed by FieldBee. Final compatibility and location checks require an import on your actual FieldBee device/version before use.

You can only import guidance lines on the app, not the web interface for now. It has been that way for years.

Fieldbee guidance lines are all saved with endpoints of lat/long. If your fieldbee and your surveying setup both share the same basestation, and your drawings are referenced to real world objects surveyed with the same base station, you'll have the most success. Your DXF file needs to have coordinates for its objects in the projection you need to convert from. A typical workflow is like follows:

1) Survey fixed points on your farm with something like an Emlid RTK reciever. Make sure you set your project to use a projection local to your area. This converts angles (lat and long) to x and y positions that are only map-accurate the closer you are the the middle of your projection. 
2) Import those points into something like BricsCAD or Autocad. Your units must be metres. They will be far off in the positive X and Y. Using the 'PLAN' command in either CAD can fit the objects in. 
3) Optional, but if you have higher tiers of cad, you can georeference your drawing which allows you to draw basemaps under your drawing. They're nice to see that you're in the right location but not accurate enough. Still, they can help with things like looking at established fence lines and making a parallel line. 
4) Do your drawings. Make your lines. 
5) Export the file as an ASCII DXF. See [BakeToDXF.lsp](BakeToDXF.lsp), which binds loaded XREF files and excludes geometry on globally off or frozen layers. Geometry on on/thawed locked layers is included. The revised routine needs a first test on a copy of your drawing in BricsCAD; it has not been runtime-tested in CAD here.

All AI Vibes (except the written instructions above).

## CAD Export Routine

Load [BakeToDXF.lsp](BakeToDXF.lsp) and run `BAKETODXF`. Layer inclusion uses global on/thawed states, including inside ordinary and bound XREF blocks. It does not reproduce the exact screen view: viewport-specific freezing, clipping, isolation, dynamic-block visibility and the current zoom extent are not export filters. On/thawed geometry in both model and paper space may be written; the converter imports model space only. Hatches are stripped, blocks preserved, and retained text resized to 0.15 drawing units (0.15 m for metre-based drawings), as in the original routine.

The routine temporarily unlocks layers so locked visible geometry can be processed. It requires full UNDO and no active UNDO group. On normal completion, errors or cancellation, it attempts to undo back to its mark and restore `FILEDIA`/`CMDDIA`, including layer locks and temporary drawing changes. A rollback failure is reported: inspect the drawing, undo manually if needed, and do not save temporary changes. This is undo-based cleanup, not a substitute for a saved drawing/backup.

DXF output is staged in a temporary file in the destination directory. An existing destination is backed up and replaced only after a nonempty export and drawing rollback. If replacement fails, cleanup attempts to restore the original filename; if that cannot be done, the backup path is printed. Keep any reported backup until you verify your original DXF. The routine does not intentionally delete the previous destination before export succeeds.

Before using this revision on a working drawing, test a copy containing on, off, frozen and locked layers, a block with hidden-layer geometry, and a bound XREF. Check the DXF contents, then verify the source geometry, XREF status, layer locks and dialog settings were restored. Also test Escape during processing and an unwritable destination, confirming an existing DXF remains intact. Automated tests evaluate the actual Lisp layer helpers with mocked CAD records and check syntax/cleanup structure; they cannot validate BricsCAD commands, ActiveX deletion, or UNDO at runtime.

Preserving blocks does not expand them into top-level lines: the converter currently skips `INSERT` content. Export the guidance lines and points as top-level model-space geometry if they need to be selectable in this app.

## Supported Input

- ASCII DXF with no application file-size cap. Large drawings are limited by available browser memory and processing capacity. Only top-level model-space WCS `LINE` and `POINT` geometry is supported.
- Curves, polylines, blocks/INSERT, text, paper-space, unsupported OCS/extrusion and nonplanar geometry are not converted into guidance lines. Read the import report for skipped objects and elevation warnings.
- DXF coordinates must be metres: `$INSUNITS=6` is accepted. Code `4` means millimetres, not metres. Missing/unknown units require explicit metre confirmation; declared non-metre units, including feet and millimetres, are rejected rather than scaled automatically.
- Source CRS is never guessed. Select the correct metre-based projected CRS; geographic/angular and feet-based CRSs are excluded. Missing or unsupported CRS definitions cannot be used.
- The searchable catalogue comes from the version 2 `epsg-index` package, whose dated EPSG dataset is a snapshot, not a live registry or universal certification of every code or datum operation. Eligible definitions are bundled into the application; search presence is not proof of survey accuracy.

## Precision and Privacy

All drawing parsing and coordinate transformations run locally on your device, with bundled EPSG definitions. Drawings and coordinates are not uploaded for conversion. No analytics are included.

The latest successfully parsed DXF, including its filename and original text, is saved locally in IndexedDB and restored when you reopen this site in the same browser/profile. Each new parsed upload replaces the saved drawing; malformed uploads do not. Use **Forget saved drawing** to delete the stored copy (the currently open drawing remains available in memory). Browser data clearing or eviction, private browsing, and storage quotas can prevent retention. Storage failures are shown separately and do not block conversion; an older stored drawing may remain if a replacement cannot be saved. There is no application file-size cap, including for storage.

The eight most recent source CRS choices are remembered in localStorage, without duplicates. The last available choice is selected for a new upload: always confirm it matches that drawing. Quick-pick buttons select recent CRSs. After a successful plot, its exact CRS and any metre confirmation are saved with that DXF. Refreshing or reopening automatically reparses and replots that drawing using its saved successful CRS, even if a different CRS was subsequently chosen without plotting. No export line is preselected. A newly uploaded or older saved drawing without successful-plot metadata still needs **Plot in WGS84** once. Revoking unknown-unit confirmation removes its automatic-plot metadata. Missing/unavailable CRSs and invalid units do not trigger automatic plotting. Storage is specific to the browser and site origin, so localhost, 127.0.0.1, and a future GitHub Pages site do not share it. Clear the site's browser data to remove both drawing and CRS history.

**Select All** and **Select None** in Drawing objects show or hide all layers. They do not select multiple export lines. Changing layer visibility clears the A-B selection; each download still contains one line only.

In **Two points** mode, right-click anywhere in the drawing preview to remove the last selected point: A/B becomes A, then a second right-click clears A. This does not change a selection in **One line** mode.

OpenStreetMap background tiles need internet access and receive ordinary map requests, including the viewed tile area. The grid-and-A-B illustration, fonts, and EPSG definitions render locally. Tile failure displays a notice but does not block geometry selection or download. This is not a claim of fully offline maps. External FieldBee links open the FieldBee website.

The single header fades from white into an original map grid with a straight line and A/B endpoints. Its yellow route icon and browser favicon share `public/favicon.svg`, using the Lucide Route geometry (ISC licensed). No FieldBee logo or proprietary website photography is used. Visual tokens use the site's verified Poppins typography, yellow `#ffce1f`, and charcoal `#212a33`; reusable controls and layout rules live in `src/styles.css`.

Workspace sections are unframed and separated by subtle dividers, using the shared `--section-space` token. Inputs, buttons and framed tools use the shared `--radius` token (6 px). The map toolbar and canvas form one bordered tool; warning strips use a coloured left border. A/B markers and step numbers remain circular. Keep these distinctions when adding UI rather than wrapping ordinary sections in additional cards.

Poppins fonts are served locally via `@fontsource/poppins`, licensed under the SIL Open Font License 1.1. Retain dependency font license information when redistributing. OpenStreetMap attribution remains on the map; map data is available under the ODbL.

Conversion details identify the source, target, and operation from the parsed CRS definition. WGS84 projected sources such as EPSG:32754 reverse the projection into longitude/latitude without a datum or coordinate-epoch adjustment. Other sources show the bundled Helmert parameters, grid operation, or absence of an explicit/nonzero datum correction under Advanced precision notes; a zero shift does not certify precise WGS84 equivalence. Required missing datum grids and unsupported required vertical grids fail instead of silently proceeding; missing optional grids may use a fallback with a prominent warning. Unit issues and area-of-use problems are also prominent. The export has a first-use verification reminder rather than an accuracy checkbox: the app cannot certify a user's RTK setup. WGS84 coordinates, many decimal places and a visually aligned basemap do not establish centimetre, survey-grade or RTK accuracy. Check the first line against known surveyed marks, accounting for antenna offsets and the intended correction source.

## Output Contract

Each download is strict JSON containing exactly one FeatureCollection feature, one straight LineString and two distinct `[longitude, latitude]` positions in WGS84 (EPSG:4326). Properties are the strings `begin: "1"` and `end: "2"`.

Downloads contain valid JSON without comments. The legacy `crs` member uses CRS84 to match the format successfully imported into FieldBee; this is intentionally not strict RFC 7946 GeoJSON, which removed the `crs` member.

```json
{
  "type": "FeatureCollection",
  "name": "north-row",
  "crs": {
    "type": "name",
    "properties": { "name": "urn:ogc:def:crs:OGC:1.3:CRS84" }
  },
  "features": [{
    "type": "Feature",
    "properties": { "begin": "1", "end": "2" },
    "geometry": {
      "type": "LineString",
      "coordinates": [[141.0, -34.3413], [141.0033, -34.3413]]
    }
  }]
}
```

Filenames are sanitized and repeated downloads get suffixes such as `-2` within the current page session. This local uniqueness tracking cannot inspect your disk, prevent filesystem collisions or survive a reload; your browser controls the final saved filename.


## Install the App

Open https://kinghaigy.github.io/FieldBeeLines/ while connected to the internet. In Chrome or Edge on desktop, use the address-bar install icon or the browser menu's **Install FieldBee Lines** option. On Android, use Chrome's **Install app** or **Add to Home screen** menu. On iPhone or iPad, open the site in Safari, choose **Share > Add to Home Screen**, and enable **Open as Web App** if offered. Installation options depend on your browser and device; no account is needed.

After the first successful online load finishes caching, the app can reopen offline and still import DXF files, search the bundled CRS catalogue, plot survey geometry and download GeoJSON. OpenStreetMap background tiles and external links still need internet access; map tiles are not cached for offline use. Saved drawings remain subject to the browser storage limits described above. Updates are downloaded when online and become active after all open app windows/tabs are closed and the app is reopened, without forcing a reload while you work.

PWA installation requires HTTPS (as provided by GitHub Pages) or localhost. The service worker is generated only for production builds; use `npm run build` and `npm run preview` to test it locally.

The app's stable manifest ID is `/FieldBeeLines/`. Manifest IDs resolve against the site origin, unlike the manifest-relative launch URL and scope, so `id: "./"` would collide with other apps using that ID on the same GitHub Pages domain. If Chrome previously treated this app as another installed app, refresh the site and install it again after the corrected manifest is deployed. An old installation may remain under the shared root ID; remove that obsolete installation only if you no longer need it. Do not choose to clear site data when uninstalling if you need to retain saved drawings or data belonging to other apps on the same origin.

## Local Setup

Use Node.js 22.12 or newer and npm. From this directory:

```sh
npm ci
npm run dev
```

Open http://localhost:5173 (Vite reports another port if it is occupied). Upload an ASCII DXF, choose or confirm the source EPSG, plot, select one line or two distinct imported points/endpoints, name the output, and download. Check the first exported line against known surveyed marks using the intended RTK correction source before operating machinery.

```sh
npm run build
npm run preview
npm test
npx playwright install chromium
npm run test:e2e
```

The production build is written to `dist`; serve it over HTTP rather than opening it directly as a local file. Playwright builds the app and starts a dedicated production preview on http://127.0.0.1:5181/FieldBeeLines/ to verify GitHub Pages-style paths; keep that port free while running the suite. On Linux, missing Chromium system dependencies may require `npx playwright install --with-deps chromium` with appropriate administrator permissions.

The end-to-end suite runs actual uploads, CRS searches, selections and downloaded-file validation on desktop Chromium and Chromium emulating Pixel 5. It covers duplicate names, ordered endpoints, CRS invalidation, units guards, unavailable tiles, safe layer labels, uncaught JavaScript errors and horizontal overflow. Screenshots and failure traces go into `test-results`. Workflow tests use `.pw.ts` and Playwright's explicit `testMatch`, so Vitest's default `.test`/`.spec` discovery does not collect them.

## GitHub Pages

The [Deploy GitHub Pages workflow](.github/workflows/pages.yml) runs on pushes to `main` and can be started manually from the repository's **Actions** tab: choose **Deploy GitHub Pages**, click **Run workflow**, and select `main`.

Keep **Settings > Pages > Source** set to **GitHub Actions**. The workflow installs locked dependencies with `npm ci`, runs unit tests, builds the Vite app, and deploys only `dist` after validation passes. Source files, test fixtures, and the Lisp routine are not part of the deployed site. No hosting credentials or custom secrets are required.

Published site: https://kinghaigy.github.io/FieldBeeLines/
