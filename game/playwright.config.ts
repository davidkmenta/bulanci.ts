import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  use: { baseURL: 'http://localhost:4173' },
  webServer: [
    { command: 'npm run build -- --outDir dist-e2e && npx vite preview --outDir dist-e2e --port 4173 --strictPort', url: 'http://localhost:4173', timeout: 180_000, reuseExistingServer: false,
      env: { VITE_NET_URL: 'ws://localhost:8788' } },
    { command: 'node ../server/index.ts', port: 8788, env: { PORT: '8788' }, reuseExistingServer: false },
  ],
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'], viewport: { width: 915, height: 412 } } },
  ],
});
