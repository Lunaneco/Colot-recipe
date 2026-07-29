import { defineConfig, devices } from "@playwright/test";

const staticPreview = process.env.PLAYWRIGHT_STATIC === "true";
const localBaseUrl = staticPreview
  ? "http://127.0.0.1:4176/Colot-recipe/"
  : "http://127.0.0.1:3002/";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? localBaseUrl;

export default defineConfig({
  testDir: "./tests",
  testMatch: ["**/e2e.spec.ts", "**/*.e2e.spec.ts"],
  // Tests deliberately exercise the same browser origin and clear all of its
  // client-side stores. Keep them sequential so one reset cannot race another
  // test that is validating persistence across a reload.
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: "**/mobile-touch-regressions.e2e.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
    {
      name: "android-chromium",
      testMatch: "**/mobile-touch-regressions.e2e.spec.ts",
      use: {
        ...devices["Pixel 5"],
      },
    },
    {
      name: "iphone-webkit",
      testMatch: "**/mobile-touch-regressions.e2e.spec.ts",
      use: {
        ...devices["iPhone 13"],
      },
    },
    {
      name: "iphone-se-webkit",
      testMatch: "**/mobile-touch-regressions.e2e.spec.ts",
      use: {
        ...devices["iPhone SE"],
      },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: staticPreview
          ? "npm run preview -- --host 127.0.0.1 --port 4176 --strictPort"
          : "npm run dev -- --host 127.0.0.1 --port 3002",
        url: localBaseUrl,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
