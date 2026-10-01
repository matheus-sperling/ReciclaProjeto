import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://127.0.0.1:5173", trace: "retain-on-failure" },
  webServer: {
    command: "node --import tsx server/local.ts --preview",
    url: "http://127.0.0.1:5173/api/recicla?action=status",
    reuseExistingServer: !process.env.CI,
  },
});
