import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const fixture = fileURLToPath(new URL("../fixtures/demo.dxf", import.meta.url));

test("installs at the repository subpath and converts a drawing offline", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./");
  await expect(page.getByLabel("Upload DXF drawing")).toBeEnabled();

  const manifestUrl = await page.locator('link[rel="manifest"]').evaluate(
    (element: HTMLLinkElement) => element.href,
  );
  const response = await page.request.get(manifestUrl);
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest.name).toBe("FieldBee Lines");
  expect(manifest.display).toBe("standalone");
  const startUrl = new URL(manifest.start_url, manifestUrl);
  const appId = new URL(manifest.id, startUrl.origin);
  expect(manifest.id).toBe("/FieldBeeLines/");
  expect(appId.href).toBe(`${startUrl.origin}/FieldBeeLines/`);
  expect(appId.href).not.toBe(new URL("./", startUrl.origin).href);
  for (const key of ["start_url", "scope"]) {
    expect(new URL(manifest[key], manifestUrl).pathname).toBe("/FieldBeeLines/");
  }
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ sizes: "192x192", type: "image/png", purpose: "any" }),
    expect.objectContaining({ sizes: "512x512", type: "image/png", purpose: "any" }),
    expect.objectContaining({ sizes: "512x512", type: "image/png", purpose: "maskable" }),
  ]));
  for (const icon of manifest.icons) {
    const iconResponse = await page.request.get(new URL(icon.src, manifestUrl).href);
    expect(iconResponse.ok()).toBe(true);
    const bytes = await iconResponse.body();
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`).toBe(icon.sizes);
  }
  const appleIcon = await page.locator('link[rel="apple-touch-icon"]').evaluate(
    (element: HTMLLinkElement) => element.href,
  );
  expect((await page.request.get(appleIcon)).ok()).toBe(true);

  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(new URL(scope).pathname).toBe("/FieldBeeLines/");
  await context.setOffline(true);
  await page.reload();
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await expect(page.getByLabel("Upload DXF drawing")).toBeEnabled();
  await page.getByLabel("Upload DXF drawing").setInputFiles(fixture);
  await expect(page.getByRole("status")).toContainText("Drawing read locally");
  await page.getByLabel("Source EPSG code or name").fill("28354");
  await page.getByRole("button", { name: /^EPSG:28354\s*GDA94 \/ MGA zone 54$/ }).click();
  await page.getByRole("button", { name: "Plot in WGS84", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Drawing plotted");
  await page.locator("#entity-list").getByRole("button", { name: /^Line / }).first().click();
  const pendingDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download GeoJSON", exact: true }).click();
  const download = await pendingDownload;
  expect(await download.failure()).toBeNull();
  const output = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(output.features).toHaveLength(1);
  expect(output.features[0].geometry.type).toBe("LineString");
  expect(output.features[0].geometry.coordinates).toHaveLength(2);
  expect(errors).toEqual([]);
});