import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  testMatch: [
    "browser.spec.ts",
    "stock.browser.spec.ts",
    "sales.browser.spec.ts",
    "operations.browser.spec.ts",
    "credits.browser.spec.ts",
    "events.browser.spec.ts",
    "purchases.browser.spec.ts",
    "payables.browser.spec.ts",
    "receivables.browser.spec.ts",
  ],
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://localhost:5173", trace: "retain-on-failure" },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1050 },
      },
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
});
