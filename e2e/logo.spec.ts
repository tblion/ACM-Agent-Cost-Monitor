import { expect, test } from "@playwright/test";

test("displays the application logo in the header", async ({ page }) => {
  await page.goto("/");

  const logo = page.locator(".header-logo");
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute("alt", "");
  await expect.poll(() => logo.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
});
