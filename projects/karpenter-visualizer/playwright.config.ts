import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the Karpenter Visualizer end-to-end suite.
 *
 * Strategy:
 *   - Start the Express backend with `MOCK_K8S=true` on a dedicated
 *     port (3101) so we never collide with a developer's local server
 *     on 3001.
 *   - Serve the pre-built Vite frontend from a static server on 5103.
 *     Building once keeps tests reproducible and avoids racing Vite's
 *     cold start.
 *   - Run all specs serially against the shared mock cluster.
 */

const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT ?? 3101);
const FRONTEND_PORT = Number(process.env.E2E_FRONTEND_PORT ?? 5103);
const HOST = '127.0.0.1';

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://${HOST}:${FRONTEND_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    headless: true,
    ignoreHTTPSErrors: true,
  },
  webServer: {
    // Single command starts the backend (MOCK_K8S) and the static
    // frontend server. We delegate to a small launcher script so
    // we can wire up port forwarding + cleanup.
    command: `node test/e2e/start-servers.mjs ${BACKEND_PORT} ${FRONTEND_PORT}`,
    url: `http://${HOST}:${FRONTEND_PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
