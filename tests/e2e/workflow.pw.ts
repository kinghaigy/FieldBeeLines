import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test, type Download, type Page } from "@playwright/test";

const fixture = fileURLToPath(new URL("../fixtures/demo.dxf", import.meta.url));
const runtimeErrors = new WeakMap<Page, string[]>();

async function upload(page: Page, buffer?: Buffer) {
  await expect(page.getByLabel("Upload DXF drawing")).toBeEnabled();
  await page
    .getByLabel("Upload DXF drawing")
    .setInputFiles(
      buffer
        ? { name: "modified.dxf", mimeType: "application/dxf", buffer }
        : fixture,
    );
  await expect(page.getByRole("status")).toContainText("Drawing read locally");
}

async function chooseCrs(page: Page, code = "28354") {
  await page.getByLabel("Source EPSG code or name").fill(code);
  await page
    .getByRole("button", {
      name: new RegExp(`^EPSG:${code}\\s*GDA94 / MGA zone ${code.slice(-2)}$`),
    })
    .click();
}

async function plot(page: Page) {
  await chooseCrs(page);
  await page
    .getByRole("button", { name: "Plot in WGS84", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Drawing plotted");
}

async function selectLine(page: Page) {
  await page
    .locator("#entity-list")
    .getByRole("button", { name: /^Line / })
    .first()
    .click();
  await expect(page.locator("#selection-summary .coordinate-row")).toHaveCount(
    2,
  );
}

async function downloadJson(page: Page, filename: string) {
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download GeoJSON", exact: true })
    .click();
  const download: Download = await pending;
  expect(download.suggestedFilename()).toBe(filename);
  expect(await download.failure()).toBeNull();
  const path = await download.path();
  expect(path).not.toBeNull();
  const content = JSON.parse(await readFile(path!, "utf8"));
  expect(content.type).toBe("FeatureCollection");
  expect(content.name).toBe(filename.slice(0, -8));
  expect(content.crs).toEqual({
    type: "name",
    properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" },
  });
  expect(content.features).toHaveLength(1);
  expect(content.features[0].type).toBe("Feature");
  expect(content.features[0].properties).toEqual({ begin: "1", end: "2" });
  expect(content.features[0].geometry.type).toBe("LineString");
  const coordinates = content.features[0].geometry.coordinates as number[][];
  expect(coordinates).toHaveLength(2);
  for (const position of coordinates) {
    expect(position).toHaveLength(2);
    expect(position.every(Number.isFinite)).toBe(true);
    expect(position[0]).toBeGreaterThan(140);
    expect(position[0]).toBeLessThan(142);
    expect(position[1]).toBeGreaterThan(-35);
    expect(position[1]).toBeLessThan(-33);
  }
  expect(coordinates[0]).not.toEqual(coordinates[1]);
  return coordinates;
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  runtimeErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://*.tile.openstreetmap.org/**", (route) =>
    route.abort(),
  );
  await page.goto("./");
  await expect(page.getByLabel("Upload DXF drawing")).toBeEnabled();
});

test.afterEach(async ({ page }) => {
  expect(runtimeErrors.get(page), "Uncaught browser JavaScript errors").toEqual(
    [],
  );
  const overflow = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(
    overflow.content,
    "Page must not overflow horizontally",
  ).toBeLessThanOrEqual(overflow.viewport + 1);
});

test("imports a DXF larger than 20 MB without an application size cap", async ({
  page,
}) => {
  const text = await readFile(fixture, "utf8");
  const buffer = Buffer.from(`${" ".repeat(21 * 1024 * 1024)}${text}`);
  expect(buffer.byteLength).toBeGreaterThan(20 * 1024 * 1024);
  await upload(page, buffer);
  await expect(page.locator("#drawing-summary")).toContainText("3 lines");
});

test("uploads, plots, selects and downloads one strict JSON line", async ({
  page,
}, testInfo) => {
  await upload(page);
  await expect(
    page.getByRole("button", { name: "Download GeoJSON", exact: true }),
  ).toBeDisabled();
  await plot(page);
  await selectLine(page);
  await page.getByLabel("Filename", { exact: true }).fill("north-row");
  await expect(
    page.getByRole("button", { name: "Download GeoJSON", exact: true }),
  ).toBeEnabled();
  await downloadJson(page, "north-row.geojson");
  await page.locator("#map").scrollIntoViewIfNeeded();
  const screenshot = testInfo.outputPath(
    `${testInfo.project.name}-workflow.png`,
  );
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach("workflow", {
    path: screenshot,
    contentType: "image/png",
  });
});

test("map canvas renders geometry and clicking a surveyed line selects it", async ({
  page,
  isMobile,
}) => {
  await upload(page);
  await plot(page);
  await page.locator("#map").scrollIntoViewIfNeeded();
  const canvas = page.locator("#map canvas");
  await expect(canvas).toBeVisible();
  const hit = await canvas.evaluate((element: HTMLCanvasElement) => {
    const context = element.getContext("2d")!;
    const pixels = context.getImageData(
      0,
      0,
      element.width,
      element.height,
    ).data;
    const bounds = element.getBoundingClientRect();
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const pixel = offset / 4;
      const column = pixel % element.width;
      if (column < element.width * 0.4 || column > element.width * 0.6)
        continue;
      if (
        pixels[offset] < 15 &&
        pixels[offset + 1] >= 110 &&
        pixels[offset + 1] <= 135 &&
        pixels[offset + 2] >= 100 &&
        pixels[offset + 2] <= 125 &&
        pixels[offset + 3] > 180
      ) {
        return {
          x:
            bounds.left +
            ((pixel % element.width) * bounds.width) / element.width,
          y:
            bounds.top +
            (Math.floor(pixel / element.width) * bounds.height) /
              element.height,
        };
      }
    }
    return null;
  });
  expect(
    hit,
    "Survey geometry must produce nonblank teal canvas pixels",
  ).not.toBeNull();
  if (isMobile) await page.touchscreen.tap(hit!.x, hit!.y);
  else await page.mouse.click(hit!.x, hit!.y);
  await expect(page.locator("#selection-summary .coordinate-row")).toHaveCount(
    2,
  );
  await expect(page.locator("#map .ab-marker")).toHaveCount(2);
});

test("uploads and bundled assets work under the GitHub Pages repository path without sample options", async ({
  page,
}, testInfo) => {
  expect(new URL(page.url()).pathname).toBe("/FieldBeeLines/");
  await expect(page.locator(".page-top > header")).toHaveCount(1);
  await expect(page.locator(".page-top > .steps")).toHaveCount(1);
  await expect(page.locator(".page-top > #status")).toHaveCount(1);
  await expect(page.getByText("An unaffiliated vibe project", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Map grid with a straight guidance line between point A and point B" })).toBeVisible();
  await expect(page.locator(".intro .diagram-point")).toHaveCount(2);
  await expect(page.locator(".diagram-survey, .site-header")).toHaveCount(0);
  await expect(page.locator("header")).toHaveCount(1);
  await expect(page.locator(".intro .brand-icon")).toBeVisible();
  const favicon = await page.request.get("./favicon.svg");
  expect(favicon.ok()).toBe(true);
  expect(favicon.headers()["content-type"]).toContain("image/svg+xml");
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", /favicon\.svg$/);
  await expect(page.locator(".intro")).not.toContainText("PLAN WITH PRECISION");
  await expect(page.locator(".intro")).not.toContainText("FROM YOUR SURVEY TO YOUR NEXT PASS");
  await page.screenshot({ path: testInfo.outputPath("grid-introduction.png"), fullPage: true });
  await expect(
    page.getByRole("button", { name: /sample drawing/i }),
  ).toHaveCount(0);
  await expect(page.getByRole("status")).not.toContainText("demo");
  await upload(page);
  await plot(page);
  await selectLine(page);
  await downloadJson(page, "demo-ab-line.geojson");
});

test("workbench sections and framed controls have consistent layout", async ({ page }, testInfo) => {
  const styles = await page.evaluate(() => {
    const style = (selector: string) => getComputedStyle(document.querySelector(selector)!);
    return {
      controlsBorder: style('.controls').borderTopWidth,
      controlsRadius: style('.controls').borderTopLeftRadius,
      sections: ['.drawing-details', '.conversion-details', '.import-notes'].map(selector => ({
        spacing: style(selector).paddingTop,
        border: style(selector).borderTopWidth,
      })),
      radii: ['.map-frame', '.icon-button', '.segmented button', '#filename', '#download'].map(selector => style(selector).borderTopLeftRadius),
      mapBorders: style('.map-container').borderTopWidth,
      warningBorder: style('.notice').borderLeftWidth,
    };
  });
  expect(styles.controlsBorder).toBe('0px');
  expect(styles.controlsRadius).toBe('0px');
  expect(styles.sections).toEqual(Array(3).fill({ spacing: '20px', border: '1px' }));
  expect(styles.radii).toEqual(Array(5).fill('6px'));
  expect(styles.mapBorders).toBe('0px');
  expect(styles.warningBorder).toBe('3px');
  await upload(page);
  await plot(page);
  await selectLine(page);
  await page.screenshot({ path: testInfo.outputPath('workbench-layout.png'), fullPage: true });
});

test("footer content aligns with the body at wide, tablet and mobile widths", async ({ page }, testInfo) => {
  for (const width of [1920, 1000, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const alignment = await page.evaluate(() => {
      const main = document.querySelector("main")!;
      const footer = document.querySelector(".footer-inner")!;
      const bodyBounds = main.getBoundingClientRect();
      const footerBounds = footer.getBoundingClientRect();
      const mainStyle = getComputedStyle(main);
      const footerStyle = getComputedStyle(footer);
      return {
        bodyLeft: bodyBounds.left + parseFloat(mainStyle.paddingLeft),
        bodyRight: bodyBounds.right - parseFloat(mainStyle.paddingRight),
        footerLeft: footerBounds.left + parseFloat(footerStyle.paddingLeft),
        footerRight: footerBounds.right - parseFloat(footerStyle.paddingRight),
        footerWidth: footerBounds.width,
      };
    });
    expect(Math.abs(alignment.bodyLeft - alignment.footerLeft)).toBeLessThan(1);
    expect(Math.abs(alignment.bodyRight - alignment.footerRight)).toBeLessThan(1);
    expect(alignment.footerWidth).toBeLessThanOrEqual(1440);
  }
  await page.screenshot({ path: testInfo.outputPath("footer-alignment.png"), fullPage: true });
});

test("suffixes duplicate filenames and exports selected line endpoints in order", async ({
  page,
}) => {
  await upload(page);
  await plot(page);
  await selectLine(page);
  await page.getByLabel("Filename", { exact: true }).fill("repeat");
  const line = await downloadJson(page, "repeat.geojson");
  expect(await downloadJson(page, "repeat-2.geojson")).toEqual(line);
  await page.getByRole("button", { name: "Two points", exact: true }).click();
  const endpoints = page
    .locator("#entity-list")
    .getByRole("button", { name: /^Line .*endpoint / });
  await endpoints.nth(0).click();
  await expect(
    page.getByRole("button", { name: "Download GeoJSON", exact: true }),
  ).toBeDisabled();
  await endpoints.nth(1).click();
  expect(await downloadJson(page, "repeat-3.geojson")).toEqual(line);
  await page.getByRole("button", { name: "Swap A & B", exact: true }).click();
  expect(await downloadJson(page, "repeat-4.geojson")).toEqual(
    [...line].reverse(),
  );
});

test("right-click on the preview removes B then A in two-point mode only", async ({ page }) => {
  await upload(page);
  await plot(page);
  await page.getByRole("button", { name: "Two points", exact: true }).click();
  const endpoints = page.locator("#entity-list").getByRole("button", { name: /^Line .*endpoint / });
  await endpoints.nth(0).click();
  const first = await page.locator("#selection-summary .coordinate-row").textContent();
  await endpoints.nth(1).click();
  await expect(page.locator("#map .ab-marker")).toHaveText(["A", "B"]);
  await expect(page.locator("#download")).toBeEnabled();
  await page.locator("#map").click({ button: "right", position: { x: 30, y: 30 } });
  await expect(page.locator("#map .ab-marker")).toHaveText(["A"]);
  await expect(page.locator("#selection-summary .coordinate-row")).toHaveText([first!]);
  await expect(page.locator("#download")).toBeDisabled();
  await expect(page.locator("#reverse")).toBeDisabled();
  const marker = page.locator("#map .ab-marker");
  const bounds = await marker.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2, { button: "right" });
  await expect(page.locator("#map .ab-marker")).toHaveCount(0);
  await expect(page.locator("#selection-summary")).toHaveText("No line selected");
  await expect(page.locator("#clear")).toBeDisabled();
  await page.locator("#map").click({ button: "right", position: { x: 30, y: 30 } });
  await expect(page.locator("#selection-summary")).toHaveText("No line selected");
  await page.getByRole("button", { name: "One line", exact: true }).click();
  await selectLine(page);
  await page.locator("#map").click({ button: "right", position: { x: 30, y: 30 } });
  await expect(page.locator("#map .ab-marker")).toHaveText(["A", "B"]);
});

test("changing CRS invalidates geometry, selection and conversion details", async ({
  page,
}) => {
  await upload(page);
  await plot(page);
  await selectLine(page);
  await expect(
    page.getByRole("button", { name: "Download GeoJSON", exact: true }),
  ).toBeEnabled();
  await chooseCrs(page, "28355");
  await expect(page.locator("#selection-summary")).toHaveText(
    "No line selected",
  );
  await expect(page.locator("#conversion-details")).toBeHidden();
  await expect(page.locator("#map-empty")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download GeoJSON", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Plot in WGS84", exact: true }),
  ).toBeEnabled();
});

test("unknown units require metre confirmation and revoking it invalidates export", async ({
  page,
}) => {
  const text = (await readFile(fixture, "utf8")).replace(
    /9\r?\n\$INSUNITS\r?\n70\r?\n6\r?\n/,
    "",
  );
  await upload(page, Buffer.from(text));
  await chooseCrs(page);
  await expect(
    page.getByRole("button", { name: "Plot in WGS84", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("I confirm this DXF uses metres.", { exact: true })
    .check();
  await page
    .getByRole("button", { name: "Plot in WGS84", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Drawing plotted");
  await selectLine(page);
  await downloadJson(page, "modified-ab-line.geojson");
  await page
    .getByLabel("I confirm this DXF uses metres.", { exact: true })
    .uncheck();
  await expect(page.locator("#selection-summary")).toHaveText(
    "No line selected",
  );
  await expect(
    page.getByRole("button", { name: "Download GeoJSON", exact: true }),
  ).toBeDisabled();
});

test("declared millimetres cannot be mistaken for metres", async ({ page }) => {
  const text = (await readFile(fixture, "utf8")).replace(
    /(\$INSUNITS\r?\n70\r?\n)6/,
    (_match, header: string) => `${header}4`,
  );
  await page.getByLabel("Upload DXF drawing").setInputFiles({
    name: "millimetres.dxf",
    mimeType: "application/dxf",
    buffer: Buffer.from(text),
  });
  await expect(page.getByRole("status")).toContainText(
    "non-metre units (INSUNITS 4)",
  );
  await chooseCrs(page);
  await expect(page.locator("#units-row")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Plot in WGS84", exact: true }),
  ).toBeDisabled();
});

test("Select All and Select None control layer visibility without selecting export lines", async ({
  page,
}) => {
  await expect(
    page.getByRole("button", { name: "Select All", exact: true }),
  ).toBeDisabled();
  await upload(page);
  await plot(page);
  await selectLine(page);
  await page.getByRole("button", { name: "Select None", exact: true }).click();
  for (const checkbox of await page.locator("#layer-controls input").all())
    await expect(checkbox).not.toBeChecked();
  await expect(page.locator("#entity-list button")).toHaveCount(0);
  await expect(page.locator("#selection-summary")).toHaveText(
    "No line selected",
  );
  await expect(page.locator("#download")).toBeDisabled();
  await page.getByRole("button", { name: "Select All", exact: true }).click();
  for (const checkbox of await page.locator("#layer-controls input").all())
    await expect(checkbox).toBeChecked();
  await expect(page.locator("#entity-list button")).toHaveCount(3);
  await expect(page.locator("#download")).toBeDisabled();
});

test("declared feet cannot be confirmed or plotted", async ({ page }) => {
  const text = (await readFile(fixture, "utf8")).replace(
    /(\$INSUNITS\r?\n70\r?\n)6/,
    "$12",
  );
  await page.getByLabel("Upload DXF drawing").setInputFiles({
    name: "feet.dxf",
    mimeType: "application/dxf",
    buffer: Buffer.from(text),
  });
  await expect(page.getByRole("status")).toContainText(
    "non-metre units (INSUNITS 2)",
  );
  await chooseCrs(page);
  await expect(page.locator("#units-row")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Plot in WGS84", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Download GeoJSON", exact: true }),
  ).toBeDisabled();
});

test("remembers latest DXF and recent CRS choices across browser pages and can forget the drawing", async ({
  page,
  context,
}) => {
  await upload(page);
  await expect(page.locator("#storage-status")).toContainText(
    "Latest drawing saved",
  );
  await chooseCrs(page, "28354");
  await chooseCrs(page, "28355");
  await page.reload();
  await expect(page.getByRole("status").first()).toContainText(
    "Drawing read locally",
  );
  await expect(page.locator("#file-label")).toHaveText("demo.dxf");
  await expect(page.locator("#crs-search")).toHaveValue(
    "EPSG:28355 · GDA94 / MGA zone 55",
  );
  await expect(page.locator("#project")).toBeEnabled();
  await expect(page.locator("#download")).toBeDisabled();
  await expect(page.locator("#recent-crs button")).toHaveText([
    "EPSG:28355",
    "EPSG:28354",
  ]);
  await page
    .getByRole("button", { name: "Use EPSG:28354 GDA94 / MGA zone 54" })
    .click();
  await page.locator("#project").click();
  await expect(page.getByRole("status").first()).toContainText(
    "Drawing plotted",
  );
  await selectLine(page);
  await downloadJson(page, "demo-ab-line.geojson");
  await expect(page.locator("#storage-status")).toContainText(
    "plotted CRS will be restored",
  );
  const reopened = await context.newPage();
  await reopened.goto(page.url());
  await expect(reopened.getByRole("status").first()).toContainText(
    "Drawing plotted",
  );
  await expect(reopened.locator("#map-empty")).toBeHidden();
  await expect(reopened.locator("#entity-list button")).toHaveCount(3);
  await expect(reopened.locator("#download")).toBeDisabled();
  await expect(reopened.locator("#crs-search")).toHaveValue(
    "EPSG:28354 · GDA94 / MGA zone 54",
  );
  await reopened.close();
  await page.getByRole("button", { name: "Forget saved drawing" }).click();
  await expect(page.locator("#storage-status")).toContainText(
    "Saved drawing removed",
  );
  await page.reload();
  await expect(page.locator("#file-label")).toHaveText("Choose or drop a DXF");
  await expect(page.locator("#project")).toBeDisabled();
  await expect(page.locator("#recent-crs button")).toHaveCount(2);
});

test("refresh replots using the last successful CRS rather than a later unplotted choice", async ({
  page,
}) => {
  await upload(page);
  await plot(page);
  await expect(page.locator("#storage-status")).toContainText(
    "plotted CRS will be restored",
  );
  await chooseCrs(page, "28355");
  await expect(page.locator("#map-empty")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("status")).toContainText("Drawing plotted");
  await expect(page.locator("#crs-search")).toHaveValue(
    "EPSG:28354 · GDA94 / MGA zone 54",
  );
  await expect(page.locator("#map-empty")).toBeHidden();
  await expect(page.locator("#entity-list button")).toHaveCount(3);
  await expect(page.locator("#selection-summary")).toHaveText(
    "No line selected",
  );
  await expect(page.locator("#download")).toBeDisabled();
});

test("saved metre confirmation permits automatic replotting but revocation clears it", async ({
  page,
}) => {
  const text = (await readFile(fixture, "utf8")).replace(
    /9\r?\n\$INSUNITS\r?\n70\r?\n6\r?\n/,
    "",
  );
  await upload(page, Buffer.from(text));
  await expect(page.locator("#storage-status")).toContainText(
    "Latest drawing saved",
  );
  await chooseCrs(page);
  await page
    .getByLabel("I confirm this DXF uses metres.", { exact: true })
    .check();
  await page.locator("#project").click();
  await expect(page.getByRole("status")).toContainText("Drawing plotted");
  await expect(page.locator("#storage-status")).toContainText(
    "plotted CRS will be restored",
  );
  await page.reload();
  await expect(page.getByRole("status")).toContainText("Drawing plotted");
  await expect(page.locator("#units-confirm")).toBeChecked();
  await expect(page.locator("#map-empty")).toBeHidden();
  await page.locator("#units-confirm").uncheck();
  await expect(page.locator("#storage-status")).toContainText(
    "Latest drawing saved in this browser",
  );
  await page.reload();
  await expect(page.getByRole("status")).toContainText("Drawing read locally");
  await expect(page.locator("#units-confirm")).not.toBeChecked();
  await expect(page.locator("#project")).toBeDisabled();
  await expect(page.locator("#map-empty")).toBeVisible();
});

test("a new unplotted DXF does not inherit the previous drawing's automatic plot", async ({
  page,
}) => {
  await upload(page);
  await plot(page);
  await expect(page.locator("#storage-status")).toContainText(
    "plotted CRS will be restored",
  );
  await upload(page, await readFile(fixture));
  await expect(page.locator("#storage-status")).toContainText(
    "Latest drawing saved in this browser",
  );
  await page.reload();
  await expect(page.getByRole("status")).toContainText("Drawing read locally");
  await expect(page.locator("#file-label")).toHaveText("modified.dxf");
  await expect(page.locator("#map-empty")).toBeVisible();
  await expect(page.locator("#project")).toBeEnabled();
});

test("blocked tiles still allow export and malicious layer labels remain literal text", async ({
  page,
}) => {
  const layer = '<img src=x onerror="window.layerInjected=true">';
  const text = (await readFile(fixture, "utf8")).replaceAll("Rows", layer);
  await upload(page, Buffer.from(text));
  await plot(page);
  await expect(page.locator("#tile-warning")).toBeVisible();
  await expect(page.locator("#tile-warning")).toContainText(
    "Your geometry and downloads still work",
  );
  await expect(page.locator("#layer-controls")).toContainText(layer);
  await expect(page.locator("#entity-list")).toContainText(layer);
  await expect(
    page.locator("#layer-controls img, #entity-list img"),
  ).toHaveCount(0);
  expect(await page.evaluate(() => "layerInjected" in window)).toBe(false);
  await selectLine(page);
  await downloadJson(page, "modified-ab-line.geojson");
});

test("WGS84 UTM explains projection-only conversion and exports without an accuracy checkbox", async ({
  page,
}) => {
  await upload(page);
  await page.getByLabel("Source EPSG code or name").fill("32754");
  await page
    .getByRole("button", { name: /^EPSG:32754 WGS 84 \/ UTM zone 54S$/ })
    .click();
  await page.locator("#project").click();
  await expect(page.getByRole("status")).toContainText("Drawing plotted");
  await expect(page.locator("#conversion-reference")).toContainText(
    "EPSG:32754",
  );
  await expect(page.locator("#conversion-summary")).toContainText(
    "No datum or coordinate-epoch adjustment is applied.",
  );
  await expect(page.locator("#warnings")).not.toContainText(
    "No survey-grade or RTK precision",
  );
  await expect(page.locator("#accuracy")).toHaveCount(0);
  await selectLine(page);
  await expect(page.locator("#download")).toBeEnabled();
  await downloadJson(page, "demo-ab-line.geojson");
});

test("non-WGS84 conversions expose actual bundled datum operation in advanced notes", async ({
  page,
}) => {
  await upload(page);
  await plot(page);
  await expect(page.locator("#conversion-summary")).toContainText(
    "precise reference-frame equivalence is not established",
  );
  await expect(page.locator("#conversion-operation")).toContainText(
    "towgs84=0,0,0,0,0,0,0",
  );
  await expect(page.locator("#precision-notes")).toContainText(
    "No nonzero datum shift",
  );
  await expect(page.locator("#precision-notes")).toContainText(
    "No survey-grade or RTK precision is guaranteed",
  );
});

test("a replacement DXF is saved while an invalid upload leaves the last valid drawing intact", async ({
  page,
}) => {
  await upload(page);
  await expect(page.locator("#storage-status")).toContainText(
    "Latest drawing saved",
  );
  const text = (await readFile(fixture, "utf8")).replaceAll(
    "Rows",
    "Replacement rows",
  );
  await page.getByLabel("Upload DXF drawing").setInputFiles({
    name: "replacement.dxf",
    mimeType: "application/dxf",
    buffer: Buffer.from(text),
  });
  await expect(page.getByRole("status")).toContainText("Drawing read locally");
  await expect(page.locator("#storage-status")).toContainText(
    "Latest drawing saved",
  );
  await page.getByLabel("Upload DXF drawing").setInputFiles({
    name: "broken.dxf",
    mimeType: "application/dxf",
    buffer: Buffer.from("not a DXF"),
  });
  await expect(page.locator("#status")).toHaveClass(/error/);
  await page.reload();
  await expect(page.getByRole("status")).toContainText("Drawing read locally");
  await expect(page.locator("#file-label")).toHaveText("replacement.dxf");
  await plot(page);
  await expect(page.locator("#layer-controls")).toContainText(
    "Replacement rows",
  );
});

test("storage failures do not prevent conversion or export", async ({
  page,
}) => {
  await page.addInitScript(() => {
    IDBObjectStore.prototype.put = () => {
      throw new DOMException("Storage quota exceeded", "QuotaExceededError");
    };
    Storage.prototype.setItem = () => {
      throw new DOMException("Storage disabled", "SecurityError");
    };
  });
  await page.reload();
  await upload(page);
  await expect(page.locator("#storage-status")).toContainText(
    "could not be saved",
  );
  await plot(page);
  await selectLine(page);
  await downloadJson(page, "demo-ab-line.geojson");
});
