import {defineConfig, devices} from '../ui/node_modules/@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  outputDir: './test-results',
  workers: 1,
  use: {baseURL: 'http://127.0.0.1:4177', ...devices['Desktop Chrome']},
  webServer: {
    command: 'node serve.mjs',
    cwd: __dirname,
    url: 'http://127.0.0.1:4177',
    reuseExistingServer: !process.env.CI,
  },
});
