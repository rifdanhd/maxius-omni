import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'backend-regressions.spec.ts',
  timeout: 120_000,
  fullyParallel: true,
  workers: 2,
  reporter: [['list'], ['json', { outputFile: '.next-e2e/qa/backend-results.json' }]],
  outputDir: '.next-e2e/qa/backend-artifacts',
});
