import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: "list",
  expect: {
    timeout: 30_000,
  },
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        locale: "zh-TW",
        launchOptions: process.env.WORDCLOUD_CHROME_PATH
          ? { executablePath: process.env.WORDCLOUD_CHROME_PATH }
          : undefined,
      },
    },
  ],
  webServer: {
    command: "pnpm run dev -- --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
