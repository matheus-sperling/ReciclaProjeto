import { defineConfig } from "@playwright/test";
process.env.RECICLA_TEST_SETUP_TOKEN ??= `${Date.now() + 3600000}.${"c".repeat(64)}`;
export default defineConfig({
  testDir: "tests/browser",
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://127.0.0.1:5173", trace: "retain-on-failure" },
  webServer: {
    env: { ADMIN_SETUP_TOKEN: process.env.RECICLA_TEST_SETUP_TOKEN },
    command: "node --import tsx server/local.ts --preview",
    url: "http://127.0.0.1:5173/api/recicla?action=status",
    reuseExistingServer: !process.env.CI,
  },
});
