import { test, expect } from "@playwright/test";

test("chart, modes, URL state, theme, copy and download", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/?packages=demo,other&start=2026-01-01&end=2026-06-30");
  await expect(page.locator("#status")).toContainText("Updated");
  await expect(page.locator("#chart-image")).toBeVisible();
  await expect(page.locator("#summary tbody tr")).toHaveCount(2);
  await page.getByLabel("Daily", { exact: true }).check();
  await expect(page).toHaveURL(/mode=daily/);
  await expect(page.locator("#status")).toContainText("Updated");
  await page.getByRole("button", { name: "Dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Copy share link" }).click();
  await expect(page.locator("#notice")).toHaveText("Share link copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "packages=demo%2Cother",
  );
  await page.getByRole("button", { name: "Embed chart" }).click();
  const embed = page.getByLabel("Markdown embed");
  await expect(embed).toHaveValue(/\/svg\?/);
  expect(await embed.inputValue()).not.toContain("end=");
  await page.getByRole("button", { name: "Close embed" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download SVG" }).click();
  expect((await download).suggestedFilename()).toBe("npm-history.svg");
  await page.getByLabel("Inspect date").focus();
  await page.keyboard.press("Home");
  await expect(page.locator("#readout")).toContainText("2026-01-01");
  expect(errors).toEqual([]);
});

for (const width of [1440, 768, 390, 320]) {
  test(`renders without page overflow at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 950 });
    await page.goto("/?packages=demo,other&start=2026-01-01&end=2026-06-30");
    await expect(page.locator("#status")).toContainText("Updated");
    const pixels = await page.locator("#chart-image").evaluate((element) => {
      const image = element as HTMLImageElement;
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(
        54,
        112,
        image.naturalWidth - 90,
        278,
      ).data;
      let colored = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if (
          Math.max(pixels[index]!, pixels[index + 1]!, pixels[index + 2]!) -
            Math.min(pixels[index]!, pixels[index + 1]!, pixels[index + 2]!) >
          60
        )
          colored++;
      }
      return colored;
    });
    expect(pixels).toBeGreaterThan(500);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await page
        .locator("#chart-frame")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`workspace-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
  });
}

test("errors, retry and empty data never leave stale exports enabled", async ({
  page,
}) => {
  await page.goto("/?packages=missing-package");
  await expect(page.locator("#status")).toContainText("no download history");
  await expect(
    page.getByRole("button", { name: "Download SVG" }),
  ).toBeDisabled();
  await page.getByLabel("Packages").fill("zero-package");
  await page.getByRole("button", { name: "Plot downloads" }).click();
  await expect(page.locator("#status")).toContainText("No downloads reported");
  await expect(
    page.getByRole("button", { name: "Download SVG" }),
  ).toBeEnabled();
  await page.getByLabel("Packages").fill("demo");
  await page.getByRole("button", { name: "Plot downloads" }).click();
  await expect(page.locator("#status")).toContainText("Updated");
});

test("invalid history navigation clears the previous chart and export state", async ({
  page,
}) => {
  await page.goto("/?packages=demo");
  await expect(page.locator("#status")).toContainText("Updated");
  await page.evaluate(() => {
    window.history.pushState(null, "", "/?mode=invalid");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.locator("#status")).toContainText("Invalid chart URL");
  await expect(
    page.getByRole("button", { name: "Download SVG" }),
  ).toBeDisabled();
  await expect(page.locator("#chart-image")).toBeHidden();
});
